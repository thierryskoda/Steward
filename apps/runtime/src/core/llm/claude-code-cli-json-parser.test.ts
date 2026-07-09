/**
 * Tests for Claude Code CLI JSON parsing: print-mode result objects are converted
 * into provider-neutral run results.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { parseClaudeCodeCliJsonToRunResult } from "./claude-code-cli-json-parser.js";

describe("parseClaudeCodeCliJsonToRunResult", () => {
  it("returns result text, diagnostics, timings, and session id for successful print JSON", () => {
    const result = parseClaudeCodeCliJsonToRunResult({
      rawStdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Final answer",
        session_id: "0199a213-81c0-7800-8aa1-bbab2a035a53",
        duration_ms: 1200,
        duration_api_ms: 900,
      }),
      rawStderr: "progress log",
      code: 0,
      runtimeMs: 42,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.outputText, "Final answer");
    assert.strictEqual(result.diagnosticText, "progress log");
    assert.strictEqual(result.reason, "exit");
    assert.strictEqual(result.providerMeta?.type, "claude_code_cli");
    assert.strictEqual(result.providerMeta?.subtype, "success");
    assert.strictEqual(result.providerMeta?.sessionId, "0199a213-81c0-7800-8aa1-bbab2a035a53");
    assert.strictEqual(result.providerMeta?.durationMs, 1200);
    assert.strictEqual(result.providerMeta?.durationApiMs, 900);
    assert.strictEqual(result.runtimeMs, 42);
  });

  it("returns invalid_cli_json when stdout is not valid JSON", () => {
    const result = parseClaudeCodeCliJsonToRunResult({
      rawStdout: "not-json",
      rawStderr: "",
      code: 0,
      runtimeMs: 12,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "invalid_cli_json");
    assert.match(result.diagnosticText, /Claude Code CLI JSON parse failed/);
    assert.strictEqual(result.providerMeta?.isError, true);
  });

  it("marks CLI error results as failed and preserves the error message", () => {
    const result = parseClaudeCodeCliJsonToRunResult({
      rawStdout: JSON.stringify({
        type: "result",
        subtype: "error",
        is_error: true,
        error: { message: "authentication failed" },
        session_id: "0199a213-81c0-7800-8aa1-bbab2a035a53",
      }),
      rawStderr: "",
      code: 1,
      runtimeMs: 5,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "exit");
    assert.match(result.diagnosticText, /authentication failed/);
    assert.strictEqual(result.providerMeta?.isError, true);
  });
});
