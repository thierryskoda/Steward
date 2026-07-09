import { describe, expect, it, vi } from "vitest";
import { type NextFunction, type Request, type Response, type Router } from "express";
import { scanningRoutes, type IScanningRouteDeps } from "./scanning.routes.js";
import { ROUTES } from "@steward/contracts/routes";

// Mock the auth middleware so we don't need real tokens for this test
vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

type IRouteHandler = (req: Request, res: Response, next: NextFunction) => unknown;
type IRouteLayer = {
  route?: {
    path: string;
    methods: {
      get?: boolean;
      post?: boolean;
    };
    stack: Array<{ handle: IRouteHandler }>;
  };
};
type IRouteTestResponse = {
  status: number;
  body: unknown;
};

function findRouteHandler(router: Router, path: string, method: "get" | "post"): IRouteHandler {
  const route = (router as unknown as { stack: IRouteLayer[] }).stack.find(
    (layer) => layer.route?.path === path && layer.route?.methods[method] === true
  );
  if (!route?.route) throw new Error(`${method.toUpperCase()} route for path ${path} not found`);
  const handler = route.route.stack.at(-1)?.handle;
  if (!handler) throw new Error(`${method.toUpperCase()} route for path ${path} has no handler`);
  return handler;
}

async function runRouteHandler(handler: IRouteHandler): Promise<IRouteTestResponse> {
  let responseStatus = 0;
  let responseJson: unknown = null;
  const req = {} as Request;
  const res = {
    status(code: number): Response {
      responseStatus = code;
      return this as unknown as Response;
    },
    json(payload: unknown): Response {
      responseJson = payload;
      return this as unknown as Response;
    },
  } as Response;

  await handler(req, res, () => undefined);
  return { status: responseStatus, body: responseJson };
}

// Helper to construct request and response mock objects and invoke route handler
function createRouteTester(router: Router) {
  return {
    runGet(path: string): Promise<IRouteTestResponse> {
      return runRouteHandler(findRouteHandler(router, path, "get"));
    },

    runPost(path: string): Promise<IRouteTestResponse> {
      return runRouteHandler(findRouteHandler(router, path, "post"));
    },
  };
}

describe("scanning.routes", () => {
  it("GET /v1/scanning/status returns the current scanning status", async () => {
    let currentStatus: "active" | "paused" = "active";
    const deps: IScanningRouteDeps = {
      getScanningStatus: () => currentStatus,
      resumeScanning: vi.fn(),
      pauseScanning: vi.fn(),
    };

    const router = scanningRoutes(deps);
    const tester = createRouteTester(router);

    const res1 = await tester.runGet(ROUTES.SCANNING_STATUS.path);
    expect(res1.status).toBe(200);
    expect(res1.body).toEqual({ status: "active" });

    currentStatus = "paused";
    const res2 = await tester.runGet(ROUTES.SCANNING_STATUS.path);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ status: "paused" });
  });

  it("POST /v1/scanning/resume triggers resume and returns active", async () => {
    let currentStatus: "active" | "paused" = "paused";
    const resumeScanning = vi.fn().mockImplementation(async () => {
      currentStatus = "active";
    });

    const deps: IScanningRouteDeps = {
      getScanningStatus: () => currentStatus,
      resumeScanning,
      pauseScanning: vi.fn(),
    };

    const router = scanningRoutes(deps);
    const tester = createRouteTester(router);

    const res = await tester.runPost(ROUTES.SCANNING_RESUME.path);
    expect(resumeScanning).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "active" });
  });

  it("POST /v1/scanning/pause triggers pause and returns paused", async () => {
    let currentStatus: "active" | "paused" = "active";
    const pauseScanning = vi.fn().mockImplementation(async () => {
      currentStatus = "paused";
    });

    const deps: IScanningRouteDeps = {
      getScanningStatus: () => currentStatus,
      resumeScanning: vi.fn(),
      pauseScanning,
    };

    const router = scanningRoutes(deps);
    const tester = createRouteTester(router);

    const res = await tester.runPost(ROUTES.SCANNING_PAUSE.path);
    expect(pauseScanning).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "paused" });
  });

  it("returns 500 INTERNAL_ERROR on resume failure", async () => {
    const deps: IScanningRouteDeps = {
      getScanningStatus: () => "paused",
      resumeScanning: vi.fn().mockRejectedValue(new Error("Database write locked")),
      pauseScanning: vi.fn(),
    };

    const router = scanningRoutes(deps);
    const tester = createRouteTester(router);

    const res = await tester.runPost(ROUTES.SCANNING_RESUME.path);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Database write locked",
      },
    });
  });
});
