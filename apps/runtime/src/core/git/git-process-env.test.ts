import assert from "node:assert";
import { describe, it } from "vitest";
import { buildSanitizedGitProcessEnv } from "./git-process-env.js";

describe("buildSanitizedGitProcessEnv", () => {
  it("removes ambient Git overrides while retaining normal process settings", () => {
    assert.deepStrictEqual(
      buildSanitizedGitProcessEnv({
        PATH: "/usr/bin:/bin",
        HOME: "/Users/tester",
        GIT_DIR: "/outside/repository",
        GIT_WORK_TREE: "/outside/worktree",
        GIT_CONFIG_COUNT: "1",
      }),
      {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/tester",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      }
    );
  });
});
