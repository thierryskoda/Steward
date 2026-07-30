import { type NextFunction, type Request, type Response, type Router } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENTATION_REFRESH_CATEGORY_ID, STATUS } from "@steward/contracts/schemas";
import { ROUTES } from "@steward/contracts/routes";
import { findingsRoutes, type IFindingsRouteDeps } from "./findings.routes.js";

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../../core/project-root.js", () => ({
  getProjectRoot: (): string => "/tmp/documentation-findings-route-test",
}));

type IRouteHandler = (req: Request, res: Response, next: NextFunction) => unknown;
type IRouteLayer = {
  route?: {
    path: string;
    methods: { post?: boolean };
    stack: Array<{ handle: IRouteHandler }>;
  };
};

function findPostHandler(router: Router, path: string): IRouteHandler {
  const route = (router as unknown as { stack: IRouteLayer[] }).stack.find(
    (layer) => layer.route?.path === path && layer.route.methods.post === true
  );
  const handler = route?.route?.stack.at(-1)?.handle;
  if (handler === undefined) throw new Error(`POST route for ${path} was not found`);
  return handler;
}

async function runPost(
  router: Router,
  path: string,
  args: { id: string; body?: unknown }
): Promise<{ status: number; body: unknown }> {
  let responseStatus = 0;
  let responseBody: unknown;
  const req = { params: { id: args.id }, body: args.body ?? {} } as unknown as Request;
  const res = {
    status(code: number): Response {
      responseStatus = code;
      return this as Response;
    },
    json(payload: unknown): Response {
      responseBody = payload;
      return this as Response;
    },
  } as Response;
  await findPostHandler(router, path)(req, res, () => undefined);
  return { status: responseStatus, body: responseBody };
}

function createDeps(): IFindingsRouteDeps {
  return {
    getFindingById: vi.fn(() => ({
      categoryId: DOCUMENTATION_REFRESH_CATEGORY_ID,
      item: {
        status: STATUS.NEEDS_REVIEW,
        decision: { options: [{ id: "A" }] },
      },
    })),
    transitionFindingStatus: vi.fn(() => true),
    shouldLearnFromRejectedFinding: vi.fn(() => true),
    processUndoCategory: vi.fn(async () => ({ ok: true })),
    captureOptionHintOnFindingReject: vi.fn(() => ({
      outcome: "created" as const,
      hintId: "hint-1",
      trigger: "rejection",
    })),
  };
}

describe("documentation report finding routes", () => {
  let deps: IFindingsRouteDeps;

  beforeEach((): void => {
    deps = createDeps();
  });

  it("rejects approval with the stable NOT_IMPLEMENTABLE contract", async () => {
    const response = await runPost(findingsRoutes(deps), ROUTES.FINDINGS_APPROVE.path, {
      id: "documentation-report",
    });

    expect(response).toEqual({
      status: 409,
      body: {
        error: {
          code: "NOT_IMPLEMENTABLE",
          message: "Documentation refresh reports are review-only and cannot be approved",
        },
      },
    });
    expect(deps.transitionFindingStatus).not.toHaveBeenCalled();
  });

  it("dismisses directly without rejection learning or option-hint side effects", async () => {
    const response = await runPost(findingsRoutes(deps), ROUTES.FINDINGS_REJECT.path, {
      id: "documentation-report",
      body: { rejectReason: "Reviewed and dismissed." },
    });

    expect(response).toEqual({ status: 200, body: { ok: true } });
    expect(deps.transitionFindingStatus).toHaveBeenCalledWith(
      "/tmp/documentation-findings-route-test",
      DOCUMENTATION_REFRESH_CATEGORY_ID,
      "documentation-report",
      STATUS.REJECTED,
      { rejectedReason: "Reviewed and dismissed." }
    );
    expect(deps.shouldLearnFromRejectedFinding).not.toHaveBeenCalled();
    expect(deps.captureOptionHintOnFindingReject).not.toHaveBeenCalled();
  });

  it("rejects undo before any implementation worker can be invoked", async () => {
    const response = await runPost(findingsRoutes(deps), ROUTES.FINDINGS_UNDO.path, {
      id: "documentation-report",
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: "NOT_IMPLEMENTABLE",
        message: "Documentation refresh reports are review-only and cannot be undone",
      },
    });
    expect(deps.processUndoCategory).not.toHaveBeenCalled();
  });
});
