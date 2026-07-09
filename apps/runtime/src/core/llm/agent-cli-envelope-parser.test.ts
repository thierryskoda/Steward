/**
 * Tests for agent CLI envelope parser: valid envelope, empty stdout resilience, invalid JSON.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { parseAgentCliExitToResult, buildResultFromRawRun } from "./agent-cli-envelope-parser.js";
import type { IRawAgentCliRunResult } from "./agent-cli-result.types.js";

describe("parseAgentCliExitToResult", () => {
  it("returns parsed envelope result when stdout is valid JSON envelope", () => {
    const stdout =
      '{"type":"result","subtype":"success","is_error":false,"duration_ms":12,"duration_api_ms":10,"result":"hello","session_id":"s1","request_id":"r1"}';
    const result = parseAgentCliExitToResult({
      rawStdout: stdout,
      rawStderr: "",
      code: 0,
      runtimeMs: 100,
    });
    assert.strictEqual(result.reason, "exit");
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, "hello");
    assert.strictEqual(result.stderr, "");
    assert.strictEqual(result.cli?.type, "result");
    assert.strictEqual(result.cli?.subtype, "success");
    assert.strictEqual(result.cli?.isError, false);
    assert.strictEqual(result.cli?.durationMs, 12);
    assert.strictEqual(result.cli?.sessionId, "s1");
    assert.strictEqual(result.cli?.requestId, "r1");
  });

  it("returns exit with empty stdout when code is 0 and stdout is empty (resilience)", () => {
    const result = parseAgentCliExitToResult({
      rawStdout: "",
      rawStderr: "",
      code: 0,
      runtimeMs: 50,
    });
    assert.strictEqual(result.reason, "exit");
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, "");
    assert.strictEqual(result.stderr, "");
    assert.strictEqual(result.cli, undefined);
  });

  it("returns invalid_cli_json when stdout is empty and code is non-zero", () => {
    const result = parseAgentCliExitToResult({
      rawStdout: "",
      rawStderr: "some error",
      code: 1,
      runtimeMs: 50,
    });
    assert.strictEqual(result.reason, "invalid_cli_json");
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("empty JSON output"));
  });

  it("returns invalid_cli_json when stdout is not valid JSON", () => {
    const result = parseAgentCliExitToResult({
      rawStdout: "not json at all",
      rawStderr: "",
      code: 0,
      runtimeMs: 50,
    });
    assert.strictEqual(result.reason, "invalid_cli_json");
    assert.strictEqual(result.code, 0);
    assert.ok(result.stderr.includes("invalid JSON"));
  });

  it("returns invalid_cli_json when stdout JSON does not match envelope schema", () => {
    const result = parseAgentCliExitToResult({
      rawStdout: '{"foo":1}',
      rawStderr: "",
      code: 0,
      runtimeMs: 50,
    });
    assert.strictEqual(result.reason, "invalid_cli_json");
    assert.strictEqual(result.code, 0);
  });

  it("uses envelope result as stderr when is_error is true and rawStderr is empty", () => {
    const result = parseAgentCliExitToResult({
      rawStdout: '{"type":"result","subtype":"error","is_error":true,"result":"agent said error"}',
      rawStderr: "",
      code: 1,
      runtimeMs: 50,
    });
    assert.strictEqual(result.reason, "exit");
    assert.strictEqual(result.stdout, "agent said error");
    assert.strictEqual(result.stderr, "agent said error");
    assert.strictEqual(result.cli?.isError, true);
  });
});

describe("buildResultFromRawRun", () => {
  it("maps raw timeout result to IAgentCliResult", () => {
    const raw: IRawAgentCliRunResult = {
      rawStdout: "out",
      rawStderr: "err",
      code: null,
      signal: null,
      reason: "timeout",
      runtimeMs: 60_000,
    };
    const result = buildResultFromRawRun(raw);
    assert.strictEqual(result.reason, "timeout");
    assert.strictEqual(result.stdout, "out");
    assert.strictEqual(result.stderr, "err");
    assert.strictEqual(result.code, null);
    assert.strictEqual(result.runtimeMs, 60_000);
    assert.strictEqual(result.cli, undefined);
  });

  it("maps raw idle_timeout result with idleMs", () => {
    const raw: IRawAgentCliRunResult = {
      rawStdout: "",
      rawStderr: "",
      code: null,
      signal: null,
      reason: "idle_timeout",
      runtimeMs: 30_000,
      idleMs: 25_000,
    };
    const result = buildResultFromRawRun(raw);
    assert.strictEqual(result.reason, "idle_timeout");
    assert.strictEqual(result.idleMs, 25_000);
  });
});
