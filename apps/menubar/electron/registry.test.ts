/**
 * Stale registry cleanup: pruneStaleRegistryEntries removes entries whose process is no longer running.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { DEFAULT_HTTP_PORT } from "@steward/contracts/runtime-defaults";
import { RegistryFileSchema } from "@steward/contracts/schemas";
import { readRegistry, pruneStaleRegistryEntries } from "./registry.js";

describe("pruneStaleRegistryEntries", () => {
  it("removes entry for dead pid and keeps entry for live pid", async () => {
    const deadChild = spawn("node", ["-e", "setTimeout(() => {}, 60000)"], {
      stdio: "ignore",
    });
    const deadPid = deadChild.pid!;
    deadChild.kill("SIGKILL");
    // Wait for process to be reaped so kill(deadPid, 0) throws
    const waitExit = new Promise<void>((resolve) => deadChild.on("exit", () => resolve()));
    await waitExit;

    const tmp = mkdtempSync(join(tmpdir(), "cto-registry-test-"));
    process.env.CTO_APP_DATA = tmp;
    try {
      const registryPath = join(tmp, "registry.json");
      const livePid = process.pid!;
      const now = Date.now();
      writeFileSync(
        registryPath,
        JSON.stringify({
          entries: {
            dead: {
              projectKey: "dead",
              projectRoot: "/fake/dead",
              pid: deadPid,
              endpoint: { host: "127.0.0.1", port: DEFAULT_HTTP_PORT },
              lastSeenAt: now,
            },
            live: {
              projectKey: "live",
              projectRoot: "/fake/live",
              pid: livePid,
              endpoint: { host: "127.0.0.1", port: 7712 },
              lastSeenAt: now,
            },
          },
        }),
        "utf-8"
      );
      pruneStaleRegistryEntries();
      const raw = readFileSync(registryPath, "utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        assert.fail("registry.json invalid JSON");
      }
      const result = RegistryFileSchema.safeParse(parsed);
      if (!result.success) assert.fail("registry schema invalid");
      const data = result.data;
      assert.ok(!("dead" in data.entries));
      assert.strictEqual(data.entries.live?.pid, livePid);
    } finally {
      delete process.env.CTO_APP_DATA;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("readRegistry returns empty when file missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cto-registry-read-"));
    process.env.CTO_APP_DATA = tmp;
    try {
      const entries = readRegistry();
      assert.strictEqual(entries.length, 0);
    } finally {
      delete process.env.CTO_APP_DATA;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
