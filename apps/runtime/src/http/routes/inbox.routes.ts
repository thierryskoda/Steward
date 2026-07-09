import { Router, type Request, type Response } from "express";
import {
  InboxFindingItemSchema,
  InboxFindingsResponseSchema,
  InboxRuleItemSchema,
  InboxRulesResponseSchema,
} from "@steward/contracts/schemas";
import { ROUTES } from "@steward/contracts/routes";
import { getProjectRoot } from "../../core/project-root.js";
import { sanitizeCollection } from "../validation-helpers.js";

export const MOUNTED_ROUTE_KEYS: (keyof typeof ROUTES)[] = ["INBOX_FINDINGS", "INBOX_RULES"];

export type IInboxRouteDeps = {
  loadCategoryRegistry: () => Array<{ categoryId: string }>;
  listReviewFindingsForCategory: (projectRoot: string, categoryId: string) => unknown[];
  listApprovedFindingsForCategory: (projectRoot: string, categoryId: string) => unknown[];
  listReviewRules: (projectRoot: string) => Array<{
    id: string;
    title: string;
    ruleText: string;
    rationale: string;
    createdAt: number;
  }>;
};

export function inboxRoutes(deps: IInboxRouteDeps): Router {
  const router = Router();

  router[ROUTES.INBOX_FINDINGS.method](
    ROUTES.INBOX_FINDINGS.path,
    (req: Request, res: Response) => {
      const projectRoot = getProjectRoot();
      const registry = deps.loadCategoryRegistry();
      const categoryIds = registry.map((entry) => entry.categoryId);
      const items = categoryIds
        .flatMap((categoryId) => {
          const pending = deps.listReviewFindingsForCategory(projectRoot, categoryId);
          const ready = deps.listApprovedFindingsForCategory(projectRoot, categoryId);
          return [...pending, ...ready].flatMap((rawItem) => {
            const item = rawItem as {
              id: string;
              categoryId: string;
              createdAt: number;
              problem?: {
                title: string;
                locations: string[];
                technicalFinding: string;
                humanSummary?: string;
                humanCurrentBehavior?: string;
                humanWhyItMatters?: string;
                humanEvidence?: string[];
                humanDecisionQuestion?: string;
              };
              decision?: {
                options: Array<{
                  id: string;
                  name: string;
                  technicalPlan: string;
                  ruleConsideration: string;
                  humanSummary?: string;
                  humanChooseThisIf?: string;
                  humanTradeoff?: string;
                }>;
                selectedOptionId?: string;
              };
            };
            if (!item.problem) {
              throw new Error(`Inbox finding ${item.id}: problem is required`);
            }
            if (!item.decision) {
              throw new Error(`Inbox finding ${item.id}: decision is required`);
            }
            if (item.decision.options.length < 2) {
              throw new Error(`Inbox finding ${item.id}: at least two options are required`);
            }
            const problem = item.problem;
            if (
              !problem.humanSummary?.trim() ||
              !problem.humanCurrentBehavior?.trim() ||
              !problem.humanWhyItMatters?.trim() ||
              !problem.humanDecisionQuestion?.trim() ||
              !Array.isArray(problem.humanEvidence) ||
              problem.humanEvidence.length < 1
            ) {
              throw new Error(
                `Inbox finding ${item.id}: decision-card problem fields are required`
              );
            }
            const options = item.decision.options;
            const inboxOptions = options.map((option) => {
              const humanSummary = option.humanSummary?.trim();
              const humanChooseThisIf = option.humanChooseThisIf?.trim();
              const humanTradeoff = option.humanTradeoff?.trim();
              if (!humanSummary || !humanChooseThisIf || !humanTradeoff) {
                throw new Error(
                  `Inbox finding ${item.id} option ${option.id}: decision-card option fields are required`
                );
              }
              return {
                id: option.id,
                name: option.name,
                technicalPlan: option.technicalPlan,
                ruleConsideration: option.ruleConsideration?.trim() ?? "",
                humanSummary,
                humanChooseThisIf,
                humanTradeoff,
              };
            });
            return [
              {
                type: "finding" as const,
                categoryId,
                id: item.id,
                problem: item.problem,
                decision: {
                  options: inboxOptions,
                  ...(item.decision.selectedOptionId
                    ? { selectedOptionId: item.decision.selectedOptionId }
                    : {}),
                },
                createdAt: item.createdAt,
              },
            ];
          });
        })
        .sort((a, b) => a.createdAt - b.createdAt);
      const validItems = sanitizeCollection({
        route: ROUTES.INBOX_FINDINGS.path,
        requestId: req.requestId,
        rawItems: items,
        itemSchema: InboxFindingItemSchema,
        getItemId: (raw) => (raw as { id?: string }).id,
      });
      const payload = InboxFindingsResponseSchema.parse({ items: validItems });
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(payload);
    }
  );

  router[ROUTES.INBOX_RULES.method](ROUTES.INBOX_RULES.path, (req: Request, res: Response) => {
    const projectRoot = getProjectRoot();
    const rawItems = deps
      .listReviewRules(projectRoot)
      .map((r) => ({
        type: "rule" as const,
        id: r.id,
        title: r.title,
        ruleText: r.ruleText,
        rationale: r.rationale,
        createdAt: r.createdAt,
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
    const items = sanitizeCollection({
      route: ROUTES.INBOX_RULES.path,
      requestId: req.requestId,
      rawItems,
      itemSchema: InboxRuleItemSchema,
      getItemId: (raw) => (raw as { id?: string }).id,
    });
    const payload = InboxRulesResponseSchema.parse({ items });
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(payload);
  });

  return router;
}
