import { Router, type Request, type Response } from "express";
import {
  ApproveFindingBodySchema,
  OkResponseSchema,
  parseRejectBody,
  STATUS,
} from "@steward/contracts/schemas";
import { ROUTES } from "@steward/contracts/routes";
import { getProjectRoot } from "../../core/project-root.js";
import { requireAuth } from "../middleware/auth.js";
import { sendApiError } from "../api-response.js";
import { getRuntimeLogger } from "../../core/logger.js";
import type { IRouteIdParams } from "../validation-helpers.js";
import {
  OPTION_HINT_CANDIDATE_CREATED,
  OPTION_HINT_CANDIDATE_SKIPPED,
  OPTION_HINTS_DISABLED_BY_CONFIG,
} from "../../features/categories/categories-log-events.js";

export const MOUNTED_ROUTE_KEYS: (keyof typeof ROUTES)[] = [
  "FINDINGS_APPROVE",
  "FINDINGS_REJECT",
  "FINDINGS_UNDO",
];

/** Option id shape for transitionFindingStatus; type from deps, not feature import. */
type IOptionId = "A" | "B" | "C";

export type IFindingsRouteDeps = {
  getActionableCategories: () => Array<{ categoryId: string }>;
  getFindingByIdAcrossCategories: (
    projectRoot: string,
    categoryIds: string[],
    id: string
  ) => {
    categoryId: string;
    item: {
      status: string;
      hasBeenReverted?: boolean;
      decision?: { options: Array<{ id: string }> };
    };
  } | null;
  transitionFindingStatus: (
    projectRoot: string,
    categoryId: string,
    id: string,
    status: import("@steward/contracts/schemas").IItemStatus,
    opts?: { selectedOptionId?: IOptionId; rejectedReason?: string }
  ) => boolean;
  shouldLearnFromRejectedFinding: (projectRoot: string) => boolean;
  processUndoCategory: (args: {
    projectRoot: string;
    categoryId: string;
    itemId: string;
  }) => Promise<{ ok: boolean }>;
  captureOptionHintOnFindingReject: (args: {
    projectRoot: string;
    categoryId: string;
    itemId: string;
    rejectedReason: string;
  }) =>
    | { outcome: "disabled" }
    | { outcome: "created"; hintId: string; trigger: string }
    | { outcome: "duplicate"; hintId: string; trigger: string }
    | { outcome: "skipped"; reason: string };
};

export function findingsRoutes(deps: IFindingsRouteDeps): Router {
  const router = Router();
  const log = getRuntimeLogger();

  router[ROUTES.FINDINGS_APPROVE.method](
    ROUTES.FINDINGS_APPROVE.path,
    requireAuth(),
    (req: Request<IRouteIdParams>, res: Response) => {
      const id = req.params.id;
      const projectRoot = getProjectRoot();
      const categoryIds = deps.getActionableCategories().map((e) => e.categoryId);
      const found = deps.getFindingByIdAcrossCategories(projectRoot, categoryIds, id);
      const okStatus =
        found?.item.status === STATUS.NEEDS_REVIEW || found?.item.status === STATUS.APPROVED;
      if (!found || !okStatus) {
        const allow = [STATUS.NEEDS_REVIEW, STATUS.APPROVED].join("/");
        sendApiError(res, 404, "NOT_FOUND", `Finding not found or not ${allow}`);
        return;
      }
      if (found.item.status === STATUS.APPROVED) {
        res.status(200).json(OkResponseSchema.parse({ ok: true }));
        return;
      }
      const body = ApproveFindingBodySchema.parse(req.body ?? {});
      const options = found.item.decision?.options ?? [];
      const selectedOptionId =
        body.selectedOptionId ?? (options.length === 1 ? options[0]!.id : undefined);
      if (options.length > 1 && !selectedOptionId) {
        sendApiError(res, 400, "SELECTION_REQUIRED", "Finding has multiple options; select one");
        return;
      }
      const ok = deps.transitionFindingStatus(
        projectRoot,
        found.categoryId,
        id,
        STATUS.APPROVED,
        selectedOptionId != null ? { selectedOptionId: selectedOptionId as IOptionId } : undefined
      );
      if (!ok) {
        sendApiError(res, 500, "UPDATE_FAILED", "Failed to approve finding");
        return;
      }
      res.status(200).json(OkResponseSchema.parse({ ok: true }));
    }
  );

  router[ROUTES.FINDINGS_REJECT.method](
    ROUTES.FINDINGS_REJECT.path,
    requireAuth(),
    (req: Request<IRouteIdParams>, res: Response) => {
      const id = req.params.id;
      const projectRoot = getProjectRoot();
      const categoryIds = deps.getActionableCategories().map((e) => e.categoryId);
      const found = deps.getFindingByIdAcrossCategories(projectRoot, categoryIds, id);
      if (!found) {
        sendApiError(res, 404, "NOT_FOUND", "Finding not found");
        return;
      }
      const okRejectStatus =
        found.item.status === STATUS.NEEDS_REVIEW || found.item.status === STATUS.APPROVED;
      if (!okRejectStatus) {
        const statuses = [STATUS.NEEDS_REVIEW, STATUS.APPROVED];
        const allow = statuses.join(" or ");
        sendApiError(res, 409, "INVALID_STATE", `Finding not ${allow}`);
        return;
      }
      const rejectedReason = parseRejectBody(req.body);
      const targetStatus =
        rejectedReason && deps.shouldLearnFromRejectedFinding(projectRoot)
          ? STATUS.LEARNING_FROM_REJECTION
          : STATUS.REJECTED;
      const ok = deps.transitionFindingStatus(projectRoot, found.categoryId, id, targetStatus, {
        rejectedReason: rejectedReason || undefined,
      });
      if (!ok) {
        sendApiError(res, 500, "UPDATE_FAILED", "Failed to reject finding");
        return;
      }
      if (rejectedReason.length > 0) {
        const hintResult = deps.captureOptionHintOnFindingReject({
          projectRoot,
          categoryId: found.categoryId,
          itemId: id,
          rejectedReason,
        });
        if (hintResult.outcome === "disabled") {
          log.info({
            event: OPTION_HINTS_DISABLED_BY_CONFIG,
            categoryId: found.categoryId,
            itemId: id,
          });
        } else if (hintResult.outcome === "created") {
          log.info({
            event: OPTION_HINT_CANDIDATE_CREATED,
            categoryId: found.categoryId,
            itemId: id,
            hintId: hintResult.hintId,
            trigger: hintResult.trigger,
          });
        } else {
          log.info({
            event: OPTION_HINT_CANDIDATE_SKIPPED,
            categoryId: found.categoryId,
            itemId: id,
            ...(hintResult.outcome === "duplicate"
              ? {
                  reason: "duplicate",
                  hintId: hintResult.hintId,
                  trigger: hintResult.trigger,
                }
              : { reason: hintResult.reason }),
          });
        }
      }
      res.status(200).json(OkResponseSchema.parse({ ok: true }));
    }
  );

  router[ROUTES.FINDINGS_UNDO.method](
    ROUTES.FINDINGS_UNDO.path,
    requireAuth(),
    async (req: Request<IRouteIdParams>, res: Response) => {
      const id = req.params.id;
      const projectRoot = getProjectRoot();
      const categoryIds = deps.getActionableCategories().map((e) => e.categoryId);
      const found = deps.getFindingByIdAcrossCategories(projectRoot, categoryIds, id);
      if (!found) {
        sendApiError(res, 404, "NOT_FOUND", "Finding not found");
        return;
      }
      if (found.item.status !== STATUS.IMPLEMENTED) {
        sendApiError(
          res,
          409,
          "INVALID_STATE",
          "Finding is not implemented; only implemented items can be undone"
        );
        return;
      }
      if (found.item.hasBeenReverted === true) {
        sendApiError(res, 409, "INVALID_STATE", "Finding was already reverted");
        return;
      }
      const result = await deps.processUndoCategory({
        projectRoot,
        categoryId: found.categoryId,
        itemId: id,
      });
      if (!result.ok) {
        sendApiError(res, 500, "UPDATE_FAILED", "Failed to undo finding");
        return;
      }
      res.status(200).json(OkResponseSchema.parse({ ok: true }));
    }
  );

  return router;
}
