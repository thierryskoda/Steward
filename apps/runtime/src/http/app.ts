import { ROUTES, ROUTES_KEYS_SKIP_STARTUP_ASSERTION } from "@steward/contracts/routes";
import express, { type Express, type Router } from "express";
import { AppError } from "../core/app-error.js";
import { ERR_ROUTE_DRIFT } from "../core/error-codes.js";
import { corsMiddleware } from "./middleware/cors.js";
import { requestTimeoutMiddleware } from "./middleware/request-timeout.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requestLogMiddleware } from "./middleware/request-log.js";
import { errorHandlerMiddleware } from "./middleware/error-handler.js";
import { createReadinessGate } from "./middleware/readiness-gate.js";
import { sendApiError } from "./api-response.js";
import { healthRoutes, MOUNTED_ROUTE_KEYS as HEALTH_MOUNTED } from "./routes/health.routes.js";
import { MOUNTED_ROUTE_KEYS as RUNTIME_MOUNTED } from "./routes/runtime.routes.js";
import { MOUNTED_ROUTE_KEYS as INBOX_MOUNTED } from "./routes/inbox.routes.js";
import { MOUNTED_ROUTE_KEYS as ITEMS_MOUNTED } from "./routes/items.routes.js";
import { MOUNTED_ROUTE_KEYS as RULES_MOUNTED } from "./routes/rules.routes.js";
import { MOUNTED_ROUTE_KEYS as FINDINGS_MOUNTED } from "./routes/findings.routes.js";
import {
  configRoutes,
  type IConfigRouteDeps,
  MOUNTED_ROUTE_KEYS as CONFIG_MOUNTED,
} from "./routes/config.routes.js";
import { MOUNTED_ROUTE_KEYS as SCANNING_MOUNTED } from "./routes/scanning.routes.js";

const BODY_LIMIT = 64 * 1024;
const REQUEST_TIMEOUT_MS = 30000;

export type IGetRuntimeStatus = () => {
  pid: number;
  state: string;
  startedAt: number;
  lastHeartbeatAt: number;
  lastError: string | null;
};

export type ICreateExpressAppRouters = {
  runtimeRouter: Router;
  inboxRouter: Router;
  itemsRouter: Router;
  rulesRouter: Router;
  findingsRouter: Router;
  scanningRouter: Router;
};

export function createExpressApp(args: {
  getRuntimeStatus: IGetRuntimeStatus;
  routers: ICreateExpressAppRouters;
  configDeps: IConfigRouteDeps;
}): Express {
  const app = express();
  app.set("etag", false);

  app.use(corsMiddleware);
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(requestTimeoutMiddleware(REQUEST_TIMEOUT_MS));
  app.use(requestIdMiddleware());
  app.use(requestLogMiddleware());

  app.options("/{*splat}", (req, res) => {
    void req;
    res.status(204).end();
  });

  app.use(healthRoutes());
  app.use(args.routers.runtimeRouter);
  app.use(args.routers.scanningRouter);
  app.use(createReadinessGate(args.getRuntimeStatus));
  app.use(args.routers.inboxRouter);
  app.use(args.routers.itemsRouter);
  app.use(args.routers.rulesRouter);
  app.use(args.routers.findingsRouter);
  app.use(configRoutes(args.configDeps));

  const mountedKeys = new Set<keyof typeof ROUTES>([
    ...HEALTH_MOUNTED,
    ...RUNTIME_MOUNTED,
    ...SCANNING_MOUNTED,
    ...INBOX_MOUNTED,
    ...ITEMS_MOUNTED,
    ...RULES_MOUNTED,
    ...FINDINGS_MOUNTED,
    ...CONFIG_MOUNTED,
  ]);
  const requiredKeys = (Object.keys(ROUTES) as (keyof typeof ROUTES)[]).filter(
    (k) => !ROUTES_KEYS_SKIP_STARTUP_ASSERTION.includes(k)
  );
  for (const key of requiredKeys) {
    if (!mountedKeys.has(key)) {
      const spec = ROUTES[key];
      throw new AppError(
        `Route drift: ${key} has no mounted handler; add to a route module and export in MOUNTED_ROUTE_KEYS.`,
        ERR_ROUTE_DRIFT,
        { routeKey: key, path: spec.path }
      );
    }
  }

  app.use((req, res) => {
    sendApiError(res, 404, "NOT_FOUND", `Unknown route: ${req.method} ${req.path}`);
  });

  app.use(errorHandlerMiddleware());

  return app;
}
