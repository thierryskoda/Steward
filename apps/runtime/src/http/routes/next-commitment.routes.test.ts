import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response, Router } from "express";
import { ROUTES } from "@steward/contracts/routes";
import type { INextCommitmentRun } from "../../features/next-commitment/next-commitment.schemas.js";
import { nextCommitmentRoutes, type INextCommitmentRouteDeps } from "./next-commitment.routes.js";

vi.mock("../middleware/auth.js", () => ({
  requireAuth:
    () =>
    (_req: Request, _res: Response, next: NextFunction): void =>
      next(),
}));

type IRouteHandler = (req: Request, res: Response, next: NextFunction) => unknown;
type IRouteLayer = {
  route?: {
    path: string;
    methods: { get?: boolean; post?: boolean };
    stack: Array<{ handle: IRouteHandler }>;
  };
};

function getHandler(router: Router, method: "get" | "post"): IRouteHandler {
  const stack = (router as unknown as { stack: IRouteLayer[] }).stack;
  const routeSpec = method === "get" ? ROUTES.NEXT_COMMITMENT_STATUS : ROUTES.NEXT_COMMITMENT_RUNS;
  const route = stack.find(
    (layer) => layer.route?.path === routeSpec.path && layer.route.methods[method] === true
  )?.route;
  const handler = route?.stack.at(-1)?.handle;
  if (handler === undefined) throw new Error(`Next commitment ${method} route was not mounted`);
  return handler;
}

async function invoke(args: {
  deps: INextCommitmentRouteDeps;
  method: "get" | "post";
}): Promise<{ status: number; body: unknown; cacheControl: string | null }> {
  let status = 0;
  let body: unknown;
  let cacheControl: string | null = null;
  const response = {
    set(name: string, value: string): Response {
      if (name === "Cache-Control") cacheControl = value;
      return this as unknown as Response;
    },
    status(code: number): Response {
      status = code;
      return this as unknown as Response;
    },
    json(value: unknown): Response {
      body = value;
      return this as unknown as Response;
    },
  } as Response;
  await getHandler(nextCommitmentRoutes(args.deps), args.method)(
    {} as Request,
    response,
    () => undefined
  );
  return { status, body, cacheControl };
}

const queuedRun: INextCommitmentRun = {
  id: "6ecbf0f1-3ae8-45ee-a1fc-c257aa7cfcec",
  projectSnapshotHash: "snapshot",
  headSha: null,
  status: "queued",
  result: null,
  stopReason: null,
  startedAt: null,
  completedAt: null,
  createdAt: 1_000,
  updatedAt: 1_000,
};

const recommendationRun: INextCommitmentRun = {
  ...queuedRun,
  status: "recommendation",
  result: {
    status: "recommendation",
    summary: "Finish the partially shipped retailer matching flow.",
    inspectedProjectPaths: ["README.md", "src/offers.ts"],
    inspectedTaskIds: ["task-grocery"],
    evidence: [
      {
        source: "project-file",
        location: "README.md",
        finding: "The documented target requires all six retailers.",
      },
      {
        source: "codex-task",
        location: "task-grocery",
        finding: "The latest task reports that streaming results remain incomplete.",
      },
    ],
    uncertainties: [],
    commitment: {
      title: "Stream retailer matches as each store completes",
      whyNow: "It is the remaining gap in the active end-to-end flow.",
      expectedOutcome: "Users see useful matches before the full batch finishes.",
      definitionOfDone: ["Each retailer result renders independently."],
      firstAction: "Trace the response boundary and write the failing UI test.",
    },
    whyThisWins: "It completes active work tied directly to the product goal.",
    strongestCounterargument: "The batch flow works and another gap may have more impact.",
    alternatives: [],
  },
  completedAt: 1_200,
  updatedAt: 1_200,
};

describe("next commitment routes", () => {
  it("returns a no-cache never-run response before the first manual review", async () => {
    const result = await invoke({
      method: "get",
      deps: { getLatestRun: () => null, startRun: () => queuedRun },
    });

    expect(result).toEqual({
      status: 200,
      body: { status: "never-run" },
      cacheControl: "no-store",
    });
  });

  it("accepts a queued run without waiting for its background agent", async () => {
    const startRun = vi.fn(() => queuedRun);
    const result = await invoke({
      method: "post",
      deps: { getLatestRun: () => null, startRun },
    });

    expect(startRun).toHaveBeenCalledOnce();
    expect(result).toEqual({
      status: 202,
      body: {
        status: "queued",
        runId: queuedRun.id,
        createdAt: 1_000,
        startedAt: null,
        completedAt: null,
        result: null,
        stopReason: null,
      },
      cacheControl: "no-store",
    });
  });

  it("returns the complete validated recommendation for human review", async () => {
    const result = await invoke({
      method: "get",
      deps: { getLatestRun: () => recommendationRun, startRun: () => queuedRun },
    });

    expect(result.status).toBe(200);
    expect(result.cacheControl).toBe("no-store");
    expect(result.body).toMatchObject({
      status: "recommendation",
      runId: recommendationRun.id,
      completedAt: 1_200,
      result: {
        status: "recommendation",
        commitment: { title: "Stream retailer matches as each store completes" },
      },
    });
  });
});
