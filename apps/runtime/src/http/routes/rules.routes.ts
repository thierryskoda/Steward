import { Router, type Request, type Response } from "express";
import {
  OkResponseSchema,
  RulesSnapshotCategoryEntrySchema,
  RulesSnapshotResponseSchema,
  STATUS,
} from "@steward/contracts/schemas";
import { ROUTES } from "@steward/contracts/routes";
import { getProjectRoot } from "../../core/project-root.js";
import { requireAuth } from "../middleware/auth.js";
import { sendApiError } from "../api-response.js";
import { sanitizeCollection, type IRouteIdParams } from "../validation-helpers.js";

export const MOUNTED_ROUTE_KEYS: (keyof typeof ROUTES)[] = [
  "RULES_SNAPSHOT",
  "RULES_APPROVE",
  "RULES_REJECT",
];

export type IRulesRouteDeps = {
  findRuleById: (projectRoot: string, id: string) => { rule: { status: string } } | null;
  transitionRuleStatus: (
    projectRoot: string,
    id: string,
    status: import("@steward/contracts/schemas").IItemStatus
  ) => boolean;
  loadSnapshot: (projectRoot: string) => { categories: unknown[] } | null;
};

function handleImplementRule(
  req: Request<IRouteIdParams>,
  res: Response,
  deps: IRulesRouteDeps
): void {
  const id = req.params.id;
  const projectRoot = getProjectRoot();
  const found = deps.findRuleById(projectRoot, id);
  if (!found || found.rule.status !== STATUS.NEEDS_REVIEW) {
    sendApiError(res, 404, "NOT_FOUND", "Rule not found or not pending");
    return;
  }
  const ok = deps.transitionRuleStatus(projectRoot, id, STATUS.APPROVED);
  if (!ok) {
    sendApiError(res, 500, "UPDATE_FAILED", "Failed to implement rule");
    return;
  }
  res.status(200).json(OkResponseSchema.parse({ ok: true }));
}

function handleRejectRule(
  req: Request<IRouteIdParams>,
  res: Response,
  deps: IRulesRouteDeps
): void {
  const id = req.params.id;
  const projectRoot = getProjectRoot();
  const found = deps.findRuleById(projectRoot, id);
  if (!found) {
    sendApiError(res, 404, "NOT_FOUND", "Rule not found");
    return;
  }
  const okRejectStatus =
    found.rule.status === STATUS.NEEDS_REVIEW ||
    found.rule.status === STATUS.APPROVED ||
    found.rule.status === STATUS.CLAIMED ||
    found.rule.status === STATUS.AGENT_RUNNING;
  if (!okRejectStatus) {
    const statuses = [STATUS.NEEDS_REVIEW, STATUS.APPROVED, STATUS.CLAIMED, STATUS.AGENT_RUNNING];
    const allow =
      statuses.length > 1
        ? statuses.slice(0, -1).join(", ") + ", or " + statuses[statuses.length - 1]
        : statuses[0];
    sendApiError(res, 409, "INVALID_STATE", `Rule not ${allow}`);
    return;
  }
  const ok = deps.transitionRuleStatus(projectRoot, id, STATUS.REJECTED);
  if (!ok) {
    sendApiError(res, 500, "UPDATE_FAILED", "Failed to reject rule");
    return;
  }
  res.status(200).json(OkResponseSchema.parse({ ok: true }));
}

export function rulesRoutes(deps: IRulesRouteDeps): Router {
  const router = Router();

  router[ROUTES.RULES_SNAPSHOT.method](
    ROUTES.RULES_SNAPSHOT.path,
    (req: Request, res: Response) => {
      const projectRoot = getProjectRoot();
      const snapshot = deps.loadSnapshot(projectRoot);
      const rawCategories = snapshot?.categories ?? [];
      const categories = sanitizeCollection({
        route: ROUTES.RULES_SNAPSHOT.path,
        requestId: req.requestId,
        rawItems: rawCategories,
        itemSchema: RulesSnapshotCategoryEntrySchema,
        getItemId: (raw) => (raw as { categoryId?: string }).categoryId,
      });
      const payload = RulesSnapshotResponseSchema.parse({ categories });
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(payload);
    }
  );

  router[ROUTES.RULES_APPROVE.method](
    ROUTES.RULES_APPROVE.path,
    requireAuth(),
    (req: Request<IRouteIdParams>, res: Response) => handleImplementRule(req, res, deps)
  );

  router[ROUTES.RULES_REJECT.method](
    ROUTES.RULES_REJECT.path,
    requireAuth(),
    (req: Request<IRouteIdParams>, res: Response) => handleRejectRule(req, res, deps)
  );

  return router;
}
