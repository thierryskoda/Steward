/**
 * Tests for Codex CLI process runner: buildCodexCliArgs maps provider execution modes
 * to documented `codex exec --json` invocations.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { DEFAULT_LLM_MODEL } from "./llm-defaults.js";
import { buildCodexCliArgs } from "./codex-cli-process-runner.js";

describe("buildCodexCliArgs", () => {
  it("builds a read-only non-interactive command for structured ask runs", () => {
    const { spawnArgs, logArgs } = buildCodexCliArgs({
      prompt: "hello",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp/ws",
      executionMode: "ask",
      resumeSessionId: undefined,
    });

    assert.deepStrictEqual(spawnArgs, [
      "exec",
      "--json",
      "--cd",
      "/tmp/ws",
      "--model",
      DEFAULT_LLM_MODEL,
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "hello",
    ]);
    assert.deepStrictEqual(logArgs, [
      "exec",
      "--json",
      "--cd",
      "/tmp/ws",
      "--model",
      DEFAULT_LLM_MODEL,
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "<redacted>",
    ]);
  });

  it("builds a workspace-write non-interactive command for mutation force runs", () => {
    const { spawnArgs } = buildCodexCliArgs({
      prompt: "change files",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp/ws",
      executionMode: "force",
      resumeSessionId: undefined,
    });

    assert.ok(spawnArgs.includes("--sandbox"));
    assert.strictEqual(spawnArgs[spawnArgs.indexOf("--sandbox") + 1], "workspace-write");
    assert.ok(spawnArgs.includes("--ask-for-approval"));
    assert.strictEqual(spawnArgs[spawnArgs.indexOf("--ask-for-approval") + 1], "never");
  });

  it("uses codex exec resume when a real session id is available", () => {
    const { spawnArgs, logArgs } = buildCodexCliArgs({
      prompt: "continue",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp/ws",
      executionMode: "force",
      resumeSessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53",
    });

    assert.deepStrictEqual(spawnArgs.slice(-3), [
      "resume",
      "0199a213-81c0-7800-8aa1-bbab2a035a53",
      "continue",
    ]);
    assert.deepStrictEqual(logArgs.slice(-3), [
      "resume",
      "0199a213-81c0-7800-8aa1-bbab2a035a53",
      "<redacted>",
    ]);
  });
});
