import { describe, it } from "vitest";
import assert from "node:assert";
import { APPROVAL_MODE_ALWAYS_APPROVE, DEFAULT_APPROVAL_MODE } from "@steward/contracts/schemas";
import { generateOptionsAgent } from "./generate-options.agent.js";

const baseInput = {
  title: "Test finding",
  finding: "Test finding summary",
  locations: ["src/foo.ts"],
  implementationConstraints: [
    "No barrel files.",
    "Use explicit types.",
    "Keep one agent per file.",
  ],
  ruleContent: "Keep minimal abstractions. No barrel files.",
};

describe("generateOptionsAgent buildPrompt", () => {
  it("prompt content varies by approvalMode so mode affects instructions", () => {
    const alwaysApprove = generateOptionsAgent.buildPrompt({
      ...baseInput,
      approvalMode: APPROVAL_MODE_ALWAYS_APPROVE,
    });
    const trustAi = generateOptionsAgent.buildPrompt({
      ...baseInput,
      approvalMode: DEFAULT_APPROVAL_MODE,
    });
    assert.ok(alwaysApprove.length > 0 && trustAi.length > 0);
    assert.notStrictEqual(alwaysApprove, trustAi, "approvalMode must affect prompt content");
  });

  it("prompt includes ruleConsideration in output rules and rule context when ruleContent is non-empty", () => {
    const prompt = generateOptionsAgent.buildPrompt({
      ...baseInput,
      approvalMode: DEFAULT_APPROVAL_MODE,
      ruleContent: "Category rule: prefer minimal change.",
    });
    assert.ok(prompt.includes("ruleConsideration"), "output rules must require ruleConsideration");
    assert.ok(
      prompt.includes("Category rule (for orientation"),
      "prompt must include rule context section when ruleContent set"
    );
    assert.ok(prompt.includes("Category rule: prefer minimal change."));
  });
});
