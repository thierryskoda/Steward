/**
 * HTTP server lifecycle: create app, mount routes, listen, heartbeat, cleanup registration.
 * Route-level deps are passed from composition root so this module does not wire features.
 */
import { loadEnv } from "../core/env.js";
import { getProjectRoot } from "../core/project-root.js";
import { getRuntimeState, updateRuntimeState } from "../core/state.js";
import { getRuntimeLogger } from "../core/logger.js";
import { createCleanup, type ICleanupRefs } from "../core/runtime-cleanup.js";
import { createExpressApp } from "../http/app.js";
import { createHttpServer } from "../http/server.js";
import { runtimeRoutes } from "../http/routes/runtime.routes.js";
import { inboxRoutes, type IInboxRouteDeps } from "../http/routes/inbox.routes.js";
import { itemsRoutes, type IItemsRouteDeps } from "../http/routes/items.routes.js";
import { rulesRoutes, type IRulesRouteDeps } from "../http/routes/rules.routes.js";
import { findingsRoutes, type IFindingsRouteDeps } from "../http/routes/findings.routes.js";
import { type IConfigRouteDeps } from "../http/routes/config.routes.js";
import { scanningRoutes, type IScanningRouteDeps } from "../http/routes/scanning.routes.js";
import { writeEndpointFile } from "../core/endpoint-file.js";
import { registerRuntime, heartbeatRuntime } from "../core/runtime-registry.js";
import { RUNTIME_LIFECYCLE_HEARTBEAT, HTTP_SERVER_LISTENING } from "../core/runtime-log-events.js";

const HEARTBEAT_MS = 5000;
const HEARTBEAT_LOG_INTERVAL_MS = 60000;

export type IHttpServerDeps = {
  cleanupRefs: ICleanupRefs;
};

export function startHttpServer(
  inboxDeps: IInboxRouteDeps,
  itemsDeps: IItemsRouteDeps,
  rulesDeps: IRulesRouteDeps,
  findingsDeps: IFindingsRouteDeps,
  configDeps: IConfigRouteDeps,
  serverDeps: IHttpServerDeps,
  scanningDeps: IScanningRouteDeps
): ReturnType<typeof createHttpServer> {
  const cleanupRef = { current: null as (() => void) | null };
  const runtimeRouter = runtimeRoutes({
    getRuntimeStatus: getRuntimeState,
    onShutdownRequest: () => cleanupRef.current?.(),
  });
  const inboxRouter = inboxRoutes(inboxDeps);
  const itemsRouter = itemsRoutes(itemsDeps);
  const rulesRouter = rulesRoutes(rulesDeps);
  const findingsRouter = findingsRoutes(findingsDeps);
  const scanningRouter = scanningRoutes(scanningDeps);
  const app = createExpressApp({
    getRuntimeStatus: getRuntimeState,
    routers: {
      runtimeRouter,
      inboxRouter,
      itemsRouter,
      rulesRouter,
      findingsRouter,
      scanningRouter,
    },
    configDeps,
  });
  const httpServer = createHttpServer(getProjectRoot(), app);
  let lastHeartbeatLogAt = 0;
  const heartbeatInterval = setInterval(() => {
    updateRuntimeState({ lastHeartbeatAt: Date.now() });
    heartbeatRuntime();
    const now = Date.now();
    if (now - lastHeartbeatLogAt >= HEARTBEAT_LOG_INTERVAL_MS) {
      lastHeartbeatLogAt = now;
      getRuntimeLogger().info({
        event: RUNTIME_LIFECYCLE_HEARTBEAT,
        throttle: { intervalMs: HEARTBEAT_LOG_INTERVAL_MS, lastEmittedAt: now },
      });
    }
  }, HEARTBEAT_MS);
  const cleanup = createCleanup({
    httpServer,
    heartbeatInterval,
    refs: serverDeps.cleanupRefs,
  });
  cleanupRef.current = cleanup;
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  const host = "127.0.0.1";
  const requestedPort = loadEnv().CTO_HTTP_PORT;
  httpServer.listen(requestedPort, host, () => {
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr && "port" in addr ? addr.port : requestedPort;
    const endpoint = { host, port };
    getRuntimeLogger().info({ event: HTTP_SERVER_LISTENING, port });
    writeEndpointFile(endpoint);
    registerRuntime({
      pid: process.pid,
      endpoint,
    });
  });
  return httpServer;
}
