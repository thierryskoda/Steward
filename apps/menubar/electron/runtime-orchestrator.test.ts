import assert from "node:assert";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { writeAppPreferences } from "./app-preferences.js";
import { getProjectKey } from "./project-key.js";
import { startKnownProjects } from "./runtime-orchestrator.js";

describe("startKnownProjects — bounded startup for every persisted project", () => {
  const testRoot = mkdtempSync(join(tmpdir(), "steward-start-known-projects-"));
  const appDataRoot = join(testRoot, "app-data");
  const projectRoots = ["failed", "needs-config", "running"].map((name) => join(testRoot, name));
  const requests: string[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const token = request.headers.authorization?.replace("Bearer ", "") ?? "missing";
    requests.push(`${token}:${request.method}:${request.url}`);

    if (request.method === "GET" && request.url === "/v1/runtime/status") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          pid: process.pid,
          state: token === "needs-config" ? "needs-config" : "running",
          startedAt: 1,
          lastHeartbeatAt: 1,
          lastError: null,
        })
      );
      return;
    }

    if (request.method === "POST" && request.url === "/v1/scanning/resume") {
      if (token === "failed") {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "resume failed" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "active" }));
      return;
    }

    response.writeHead(404).end();
  });

  before(async () => {
    process.env.CTO_APP_DATA = appDataRoot;
    process.env.CTO_LOGS_ROOT = join(testRoot, "logs");
    process.env.CTO_RUNTIME_MAIN_PATH = process.execPath;
    for (const projectRoot of projectRoots) mkdirSync(projectRoot, { recursive: true });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") assert.fail("Expected TCP test server");

    writeAppPreferences({
      knownProjectRoots: projectRoots,
      selectedProjectRoot: projectRoots[2] ?? null,
      cliProviderByProjectRoot: {},
    });

    const entries = Object.fromEntries(
      projectRoots.map((projectRoot) => {
        const projectKey = getProjectKey(projectRoot);
        const token = projectRoot.split("/").at(-1);
        if (!token) assert.fail("Expected project token");
        const tokenDir = join(appDataRoot, "projects", projectKey);
        mkdirSync(tokenDir, { recursive: true });
        writeFileSync(join(tokenDir, "http-token"), token, "utf8");
        return [
          projectKey,
          {
            projectKey,
            projectRoot,
            pid: process.pid,
            endpoint: { host: "127.0.0.1", port: address.port },
            lastSeenAt: Date.now(),
          },
        ];
      })
    );
    writeFileSync(join(appDataRoot, "registry.json"), JSON.stringify({ entries }), "utf8");
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    delete process.env.CTO_APP_DATA;
    delete process.env.CTO_LOGS_ROOT;
    delete process.env.CTO_RUNTIME_MAIN_PATH;
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("continues sequentially after failure and reports needs-config distinctly", async () => {
    const results = await startKnownProjects();

    assert.deepStrictEqual(
      results.map((result) => result.status),
      ["failed", "needs-config", "running"]
    );
    assert.deepStrictEqual(
      results.map((result) => result.projectRoot),
      projectRoots
    );
    const failed = results[0];
    assert.strictEqual(failed?.status, "failed");
    assert.match(failed?.status === "failed" ? failed.message : "", /resume failed/i);
    assert.deepStrictEqual(requests, [
      "failed:GET:/v1/runtime/status",
      "failed:POST:/v1/scanning/resume",
      "needs-config:GET:/v1/runtime/status",
      "needs-config:POST:/v1/scanning/resume",
      "running:GET:/v1/runtime/status",
      "running:POST:/v1/scanning/resume",
    ]);
  });
});
