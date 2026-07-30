import { type NextFunction, type Request, type Response, type Router } from "express";
import { describe, expect, it, vi } from "vitest";
import { DOCUMENTATION_REFRESH_CATEGORY_ID, STATUS } from "@steward/contracts/schemas";
import { ROUTES } from "@steward/contracts/routes";
import { inboxRoutes, type IInboxRouteDeps } from "./inbox.routes.js";

vi.mock("../../core/project-root.js", () => ({
  getProjectRoot: (): string => "/tmp/documentation-inbox-route-test",
}));

type IRouteHandler = (req: Request, res: Response, next: NextFunction) => unknown;
type IRouteLayer = {
  route?: {
    path: string;
    methods: { get?: boolean };
    stack: Array<{ handle: IRouteHandler }>;
  };
};

function findGetHandler(router: Router, path: string): IRouteHandler {
  const route = (router as unknown as { stack: IRouteLayer[] }).stack.find(
    (layer) => layer.route?.path === path && layer.route.methods.get === true
  );
  const handler = route?.route?.stack.at(-1)?.handle;
  if (handler === undefined) throw new Error(`GET route for ${path} was not found`);
  return handler;
}

describe("documentation report inbox serialization", () => {
  it("returns one complete recommendation without fabricating a second option", async () => {
    const deps: IInboxRouteDeps = {
      listFindingsByStatuses: vi.fn(() => [
        {
          id: "documentation-report",
          categoryId: DOCUMENTATION_REFRESH_CATEGORY_ID,
          status: STATUS.NEEDS_REVIEW,
          createdAt: 1,
          problem: {
            title: "README command drift",
            locations: ["README.md", "package.json"],
            technicalFinding: "README references an absent start script.",
            humanSummary: "The documented start command no longer exists.",
            humanCurrentBehavior: "package.json exposes pnpm dev, while README says npm start.",
            humanWhyItMatters: "Contributors cannot follow the documented setup path.",
            humanEvidence: ["README.md and package.json disagree."],
            humanDecisionQuestion: "Should the README command be corrected?",
          },
          decision: {
            options: [
              {
                id: "A",
                name: "Correct README command",
                technicalPlan: "Replace only the obsolete README command.",
                ruleConsideration: "The recommendation is minimal and report-only.",
                humanSummary: "Use the current command in the README.",
                humanChooseThisIf: "Choose this when the package script is authoritative.",
                humanTradeoff: "The report does not authorize the edit.",
              },
            ],
          },
        },
      ]),
      listReviewRules: vi.fn(() => []),
    };
    const router = inboxRoutes(deps);
    const req = { requestId: "request-1" } as Request;
    let responseStatus = 0;
    let responseBody: unknown;
    const res = {
      setHeader: vi.fn(),
      status(code: number): Response {
        responseStatus = code;
        return this as Response;
      },
      json(payload: unknown): Response {
        responseBody = payload;
        return this as Response;
      },
    } as unknown as Response;

    await findGetHandler(router, ROUTES.INBOX_FINDINGS.path)(req, res, () => undefined);

    expect(responseStatus).toBe(200);
    expect(responseBody).toEqual({
      items: [
        expect.objectContaining({
          categoryId: DOCUMENTATION_REFRESH_CATEGORY_ID,
          decision: expect.objectContaining({
            options: [expect.objectContaining({ id: "A" })],
          }),
        }),
      ],
    });
  });
});
