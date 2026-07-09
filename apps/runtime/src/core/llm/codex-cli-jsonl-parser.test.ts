/**
 * Tests for Codex CLI JSONL parsing: final agent messages and thread ids are
 * converted into the provider-neutral run shape.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { parseCodexCliJsonlToRunResult } from "./codex-cli-jsonl-parser.js";

describe("parseCodexCliJsonlToRunResult", () => {
  it("returns the last completed agent message and thread id for a successful JSONL stream", () => {
    const result = parseCodexCliJsonlToRunResult({
      rawStdout: [
        JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "item-1", type: "agent_message", text: "First message" },
        }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "item-2", type: "agent_message", text: "Final message" },
        }),
        JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10 } }),
      ].join("\n"),
      rawStderr: "progress log",
      code: 0,
      runtimeMs: 42,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.outputText, "Final message");
    assert.strictEqual(result.diagnosticText, "progress log");
    assert.strictEqual(result.reason, "exit");
    assert.strictEqual(result.providerMeta?.type, "codex_cli");
    assert.strictEqual(result.providerMeta?.subtype, "exec");
    assert.strictEqual(result.providerMeta?.sessionId, "thread-123");
    assert.strictEqual(result.runtimeMs, 42);
  });

  it("returns invalid_cli_json when a non-empty stdout line is not valid JSON", () => {
    const result = parseCodexCliJsonlToRunResult({
      rawStdout: '{"type":"thread.started","thread_id":"thread-123"}\nnot-json',
      rawStderr: "",
      code: 0,
      runtimeMs: 12,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "invalid_cli_json");
    assert.match(result.diagnosticText, /Codex CLI JSONL parse failed/);
  });

  it("marks error events as failed even when the process exits", () => {
    const result = parseCodexCliJsonlToRunResult({
      rawStdout: [
        JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
        JSON.stringify({ type: "error", message: "authentication failed" }),
      ].join("\n"),
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
