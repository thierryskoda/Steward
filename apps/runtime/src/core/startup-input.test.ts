import { describe, it, afterEach } from "vitest";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getProjectRootFromStartupInput } from "./startup-input.js";

describe("getProjectRootFromStartupInput", () => {
  const realArgv = process.argv.slice();
  const realEnv = { ...process.env };

  afterEach(() => {
    process.argv.length = 0;
    realArgv.forEach((a, i) => (process.argv[i] = a));
    process.argv.length = realArgv.length;
    Object.keys(process.env).forEach((k) => delete process.env[k]);
    Object.assign(process.env, realEnv);
  });

  it("returns resolved path when env CTO_TARGET_PROJECT_ROOT is set to existing directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "cto-startup-"));
    try {
      process.env.CTO_TARGET_PROJECT_ROOT = dir;
      const out = getProjectRootFromStartupInput(
        process.env as { CTO_TARGET_PROJECT_ROOT?: string }
      );
      assert.ok(out.includes(dir) || out === join(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when env and argv lack project root", () => {
    process.argv = ["node", "main.js", "--runtime"];
    assert.throws(() => getProjectRootFromStartupInput({}), /Project root required/);
  });

  it("throws when path does not exist", () => {
    assert.throws(
      () =>
        getProjectRootFromStartupInput({ CTO_TARGET_PROJECT_ROOT: "/nonexistent/path/cto-test" }),
      /invalid or not accessible|not a directory/
    );
  });
});
