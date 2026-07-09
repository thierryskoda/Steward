/**
 * Tests for Claude Code CLI process runner: buildClaudeCodeCliArgs maps provider
 * execution modes to documented `claude -p --output-format json` invocations.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { DEFAULT_LLM_MODEL } from "./llm-defaults.js";
import { buildClaudeCodeCliArgs } from "./claude-code-cli-process-runner.js";

describe("buildClaudeCodeCliArgs", () => {
  it("builds a plan-mode non-interactive command for structured ask runs", () => {
    const { spawnArgs, logArgs } = buildClaudeCodeCliArgs({
      prompt: "hello",
      model: DEFAULT_LLM_MODEL,
      executionMode: "ask",
      session: {
        mode: "start",
        sessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53",
      },
    });

    assert.deepStrictEqual(spawnArgs, [
      "-p",
      "hello",
      "--output-format",
      "json",
      "--model",
      DEFAULT_LLM_MODEL,
      "--permission-mode",
      "plan",
      "--session-id",
      "0199a213-81c0-7800-8aa1-bbab2a035a53",
    ]);
    assert.deepStrictEqual(logArgs, [
      "-p",
      "<redacted>",
      "--output-format",
      "json",
      "--model",
      DEFAULT_LLM_MODEL,
      "--permission-mode",
      "plan",
      "--session-id",
      "0199a213-81c0-7800-8aa1-bbab2a035a53",
    ]);
  });

  it("builds a bypass-permissions command for mutation force runs", () => {
    const { spawnArgs } = buildClaudeCodeCliArgs({
      prompt: "change files",
      model: DEFAULT_LLM_MODEL,
      executionMode: "force",
      session: undefined,
    });

    assert.ok(spawnArgs.includes("--dangerously-skip-permissions"));
    assert.strictEqual(spawnArgs.indexOf("--permission-mode"), -1);
  });

  it("uses --resume when an existing session id is available", () => {
    const { spawnArgs, logArgs } = buildClaudeCodeCliArgs({
      prompt: "continue",
      model: DEFAULT_LLM_MODEL,
      executionMode: "force",
      session: {
        mode: "resume",
        sessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53",
      },
    });

    assert.deepStrictEqual(spawnArgs.slice(-2), [
      "--resume",
      "0199a213-81c0-7800-8aa1-bbab2a035a53",
    ]);
    assert.deepStrictEqual(logArgs.slice(-2), ["--resume", "0199a213-81c0-7800-8aa1-bbab2a035a53"]);
  });
});
