import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { acquirePidLock, releasePidLock } from "./status-store.js";
import { ensureProjectDir, getProjectDir } from "./project-key.js";

describe("status-store", () => {
  let projectRootA: string;
  let projectRootB: string;

  beforeAll(() => {
    const tempDir = mkdtempSync(join(tmpdir(), "cto-status-store-"));
    projectRootA = join(tempDir, "projA");
    projectRootB = join(tempDir, "projB");
  });

  afterAll(() => {
    rmSync(join(projectRootA, ".."), { recursive: true, force: true });
  });

  describe("acquirePidLock", () => {
    it("returns true when no pid file exists", () => {
      const result = acquirePidLock(projectRootA);
      assert.strictEqual(result, true);
      const pidPath = join(getProjectDir(projectRootA), "pid");
      assert.strictEqual(existsSync(pidPath), true);
      releasePidLock(projectRootA);
    });

    it("returns false when pid file exists and process is alive", () => {
      acquirePidLock(projectRootA);
      const result = acquirePidLock(projectRootA);
      assert.strictEqual(result, false);
      releasePidLock(projectRootA);
    });

    it("returns true when pid file exists but process is stale", () => {
      const dir = ensureProjectDir(projectRootB);
      const pidPath = join(dir, "pid");
      writeFileSync(pidPath, "99999999", "utf-8");
      const result = acquirePidLock(projectRootB);
      assert.strictEqual(result, true);
      releasePidLock(projectRootB);
    });
  });

  describe("releasePidLock", () => {
    it("removes pid file when pid matches", () => {
      acquirePidLock(projectRootA);
      const pidPath = join(getProjectDir(projectRootA), "pid");
      assert.strictEqual(existsSync(pidPath), true);
      releasePidLock(projectRootA);
      assert.strictEqual(existsSync(pidPath), false);
    });
  });
});
