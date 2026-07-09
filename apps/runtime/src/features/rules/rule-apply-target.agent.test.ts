import { describe, it } from "vitest";
import assert from "node:assert";
import { ruleApplyTargetAgent } from "./rule-apply-target.agent.js";

describe("ruleApplyTargetAgent output contract", () => {
  it("accepts a kebab-case Cursor rule filename and normalizes .md to .mdc", () => {
    const result = ruleApplyTargetAgent.outputSchema.parse({
      targetFile: "backend-validation.md",
      action: "create",
    });

    assert.deepStrictEqual(result, {
      targetFile: "backend-validation.mdc",
      action: "create",
    });
  });

  it("rejects path-like target files so approved rules cannot be written outside .cursor/rules", () => {
    const result = ruleApplyTargetAgent.outputSchema.safeParse({
      targetFile: "../AGENTS.md",
      action: "append",
    });

    assert.equal(result.success, false);
  });

  it("rejects stale duplicate-decision output because duplicate checks happen before approval", () => {
    const result = ruleApplyTargetAgent.outputSchema.safeParse({
      targetFile: "backend-validation.mdc",
      action: "create",
      shouldApply: false,
    });

    assert.equal(result.success, false);
  });
});
