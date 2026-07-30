import assert from "node:assert";
import { describe, it } from "vitest";
import { isGeneratedOrDependencyGitPath } from "./git-content-policy.js";

describe("isGeneratedOrDependencyGitPath", () => {
  it("rejects runtime and dependency path aliases regardless of case", () => {
    assert.strictEqual(
      isGeneratedOrDependencyGitPath(".StEwArD/tmp/runs/request/private.txt"),
      true
    );
    assert.strictEqual(isGeneratedOrDependencyGitPath("vendor/NODE_MODULES/pkg/index.js"), true);
  });
});
