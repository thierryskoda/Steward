import { describe, expect, it, vi } from "vitest";
import { type NextFunction, type Request, type Response, type Router } from "express";
import { ROUTES } from "@steward/contracts/routes";
import type { IDocumentationRefreshStatus } from "@steward/contracts/schemas";
import {
  documentationRefreshRoutes,
  type IDocumentationRefreshRouteDeps,
} from "./documentation-refresh.routes.js";

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
    methods: { get?: boolean };
    stack: Array<{ handle: IRouteHandler }>;
  };
};

function getHandler(router: Router): IRouteHandler {
  const stack = (router as unknown as { stack: IRouteLayer[] }).stack;
  const route = stack.find(
    (layer) =>
      layer.route?.path === ROUTES.DOCUMENTATION_REFRESH_STATUS.path &&
      layer.route.methods.get === true
  )?.route;
  const handler = route?.stack.at(-1)?.handle;
  if (handler === undefined) throw new Error("Documentation refresh status route was not mounted");
  return handler;
}

async function invoke(deps: IDocumentationRefreshRouteDeps): Promise<{
  status: number;
  body: unknown;
  cacheControl: string | null;
}> {
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
  await getHandler(documentationRefreshRoutes(deps))({} as Request, response, () => undefined);
  return { status, body, cacheControl };
}

describe("documentation refresh status route", () => {
  it("returns never-checked with no-store when the project has no runs", async () => {
    const result = await invoke({
      getLatestRun: () => null,
      getLastCheckedAt: () => null,
    });

    expect(result).toEqual({
      status: 200,
      body: { status: "never-checked", lastCheckedAt: null, findingId: null },
      cacheControl: "no-store",
    });
  });

  it("returns every current and terminal state through the canonical response", async () => {
    const statuses: IDocumentationRefreshStatus[] = [
      "queued",
      "running",
      "clean",
      "needs-review",
      "blocked",
      "failed",
      "superseded",
    ];
    for (const status of statuses) {
      const findingId = status === "needs-review" || status === "blocked" ? "finding-1" : null;
      const result = await invoke({
        getLatestRun: () => ({ status, findingId }),
        getLastCheckedAt: () => 2_000,
      });
      expect(result.body).toEqual({ status, lastCheckedAt: 2_000, findingId });
      expect(result.cacheControl).toBe("no-store");
    }
  });
});
