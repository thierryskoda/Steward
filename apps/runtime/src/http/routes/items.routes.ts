import { ROUTES } from "@steward/contracts/routes";
import {
  CtoItemSchema,
  CtoItemsResponseSchema,
  ItemStatusSchema,
} from "@steward/contracts/schemas";
import { Router, type Request, type Response } from "express";
import { CTO_ITEMS_RESPONSE_OK } from "../../core/runtime-log-events.js";
import { getRuntimeLogger } from "../../core/logger.js";
import { getProjectRoot } from "../../core/project-root.js";
import { sanitizeCollection } from "../validation-helpers.js";

export const MOUNTED_ROUTE_KEYS: (keyof typeof ROUTES)[] = ["ITEMS"];

export type IItemsRouteDeps = {
  loadCategoryRegistry: () => Array<{ categoryId: string }>;
  listAllRules: (projectRoot: string) => unknown[];
  listAllFindingsForCategory: (projectRoot: string, categoryId: string) => unknown[];
};

const VALID_STATUSES = new Set<string>(ItemStatusSchema.options);

export function normalizeStatus(
  status: unknown,
  log: ReturnType<typeof getRuntimeLogger>,
  context: { type: string; id: string }
): string | null {
  if (typeof status === "string" && VALID_STATUSES.has(status)) return status;
  log.error({
    event: "items_route_status_invalid_skipped",
    ...context,
    received: status,
  });
  return null;
}

export function itemsRoutes(deps: IItemsRouteDeps): Router {
  const router = Router();
  const log = getRuntimeLogger();

  router[ROUTES.ITEMS.method](ROUTES.ITEMS.path, (req: Request, res: Response) => {
    const projectRoot = getProjectRoot();
    const registry = deps.loadCategoryRegistry();
    const categoryIds = registry.map((entry) => entry.categoryId);

    const ruleItems = deps
      .listAllRules(projectRoot)
      .map((r) => {
        const rule = r as {
          id: string;
          status: string;
          title: string;
          ruleText: string;
          rationale: string;
          createdAt: number;
          updatedAt: number;
          activities?: unknown[];
        };
        const status = normalizeStatus(rule.status, log, { type: "rule", id: rule.id });
        if (!status) return null;
        return {
          type: "rule" as const,
          id: rule.id,
          status,
          title: rule.title,
          ruleText: rule.ruleText,
          rationale: rule.rationale,
          createdAt: rule.createdAt,
          updatedAt: rule.updatedAt,
          ...(rule.activities?.length ? { activities: rule.activities } : {}),
        };
      })
      .filter((r): r is Exclude<typeof r, null> => r !== null);

    const findingItems = categoryIds.flatMap((categoryId) =>
      deps
        .listAllFindingsForCategory(projectRoot, categoryId)
        .filter((raw): raw is Record<string, unknown> & { problem: unknown; decision: unknown } => {
          const r = raw as Record<string, unknown>;
          return r.problem != null && r.decision != null;
        })
        .map((item) => {
          const i = item as Record<string, unknown> & {
            id: string;
            status: string;
            createdAt: number;
            updatedAt: number;
            problem: {
              title: string;
              locations: string[];
              technicalFinding: string;
              humanSummary?: string;
              humanCurrentBehavior?: string;
              humanWhyItMatters?: string;
              humanEvidence?: string[];
              humanDecisionQuestion?: string;
            };
            decision: {
              options: unknown[];
              selectedOptionId?: string;
            };
            activities?: unknown[];
            lastImplementationResult?: unknown;
            hasBeenReverted?: boolean;
            lastUndoResult?: unknown;
          };
          const status = normalizeStatus(i.status, log, {
            type: "finding",
            id: i.id,
          });
          if (!status) return null;
          return {
            type: "finding" as const,
            categoryId,
            id: i.id,
            status,
            problem: i.problem,
            decision: i.decision,
            createdAt: i.createdAt,
            updatedAt: i.updatedAt,
            ...(i.activities?.length ? { activities: i.activities } : {}),
            ...(i.lastImplementationResult != null
              ? { lastImplementationResult: i.lastImplementationResult }
              : {}),
            ...(i.hasBeenReverted === true ? { hasBeenReverted: true } : {}),
            ...(i.lastUndoResult != null ? { lastUndoResult: i.lastUndoResult } : {}),
          };
        })
        .filter((f): f is Exclude<typeof f, null> => f !== null)
    );

    const rawItems = [...ruleItems, ...findingItems].sort(
      (a, b) => (a.createdAt as number) - (b.createdAt as number)
    );
    const items = sanitizeCollection({
      route: ROUTES.ITEMS.path,
      requestId: req.requestId,
      rawItems,
      itemSchema: CtoItemSchema,
      getItemId: (raw) => (raw as { id?: string }).id,
    });
    const payload = CtoItemsResponseSchema.parse({ items });
    const typeCounts: Record<string, number> = {};
    for (const it of items as Array<{ type: string }>) {
      typeCounts[it.type] = (typeCounts[it.type] ?? 0) + 1;
    }
    log.info({
      event: CTO_ITEMS_RESPONSE_OK,
      itemCount: items.length,
      typeCounts,
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(payload);
  });

  return router;
}
