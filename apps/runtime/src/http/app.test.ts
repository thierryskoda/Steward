import { createServer, type Server } from "node:http";
import { Router } from "express";
import { describe, expect, it } from "vitest";
import { createExpressApp, type ICreateExpressAppRouters } from "./app.js";
import { type IConfigRouteDeps } from "./routes/config.routes.js";

function createRouters(): ICreateExpressAppRouters {
  return {
    runtimeRouter: Router(),
    inboxRouter: Router(),
    itemsRouter: Router(),
    rulesRouter: Router(),
    findingsRouter: Router(),
    scanningRouter: Router(),
    documentationRefreshRouter: Router(),
    nextCommitmentRouter: Router(),
  };
}

function createConfigDeps(): IConfigRouteDeps {
  return {
    getRuntimeStatus: () => ({ state: "needs-config" }),
    runActivation: async () => undefined,
    readConfig: () => null,
    writeConfig: () => undefined,
    configSchemaVersion: 1,
    featureFlagsDefaults: {},
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected HTTP server to listen on a TCP port");
  }
  return address.port;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe("createExpressApp", () => {
  it("starts under Express 5 and handles preflight OPTIONS requests across routes", async () => {
    const app = createExpressApp({
      getRuntimeStatus: () => ({
        pid: process.pid,
        state: "needs-config",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        lastError: null,
      }),
      routers: createRouters(),
      configDeps: createConfigDeps(),
    });
    const server = createServer(app);

    try {
      const port = await listen(server);
      const response = await fetch(`http://127.0.0.1:${port}/v1/example`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:1420",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,content-type,x-request-id",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
      expect(response.headers.get("access-control-allow-methods")).toBe(
        "GET, POST, PATCH, OPTIONS"
      );
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "Authorization, Content-Type, X-Request-Id"
      );
    } finally {
      await close(server);
    }
  });

  it("accepts the complete canonical router set including manual review routes", () => {
    const app = createExpressApp({
      getRuntimeStatus: () => ({
        pid: 1,
        state: "running",
        startedAt: 1,
        lastHeartbeatAt: 1,
        lastError: null,
      }),
      routers: createRouters(),
      configDeps: createConfigDeps(),
    });

    expect(app).toBeDefined();
  });
});
