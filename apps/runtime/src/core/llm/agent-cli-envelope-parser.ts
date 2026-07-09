/**
 * Parses agent CLI stdout/stderr on normal exit into IAgentCliResult.
 * Handles empty stdout (resilience), valid JSON envelope, and invalid JSON → invalid_cli_json.
 * No logging; caller logs when result.reason === "invalid_cli_json".
 */

import { agentCliEnvelopeSchema } from "./agent-cli-envelope.js";
import type {
  IAgentCliResult,
  IAgentTerminationReason,
  IRawAgentCliRunResult,
} from "./agent-cli-result.types.js";

export type IParseExitInput = {
  rawStdout: string;
  rawStderr: string;
  code: number | null;
  runtimeMs: number;
};

/**
 * Converts raw exit output to IAgentCliResult. Use only when process exited (reason "exit").
 * Returns reason "exit" with parsed envelope, or "invalid_cli_json" on parse failure.
 */
export function parseAgentCliExitToResult(input: IParseExitInput): IAgentCliResult {
  const { rawStdout, rawStderr, code, runtimeMs } = input;
  const trimmed = rawStdout.trim();

  if (trimmed.length === 0) {
    if (code === 0) {
      return {
        stdout: "",
        stderr: rawStderr.trim() || "",
        rawStdout,
        rawStderr,
        code,
        reason: "exit",
        runtimeMs,
      };
    }
    return {
      stdout: "",
      stderr:
        `Agent CLI JSON parse failed: Agent CLI returned empty JSON output\n${rawStderr}`.trim(),
      rawStdout,
      rawStderr,
      code,
      reason: "invalid_cli_json",
      runtimeMs,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return {
      stdout: "",
      stderr:
        `Agent CLI JSON parse failed: Agent CLI returned invalid JSON output\n${rawStderr}`.trim(),
      rawStdout: rawStdout,
      rawStderr: rawStderr,
      code,
      reason: "invalid_cli_json",
      runtimeMs,
    };
  }

  const parsed = agentCliEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    const parseMessage = parsed.error.message;
    return {
      stdout: "",
      stderr: `Agent CLI JSON parse failed: ${parseMessage}\n${rawStderr}`.trim(),
      rawStdout,
      rawStderr,
      code,
      reason: "invalid_cli_json",
      runtimeMs,
    };
  }

  const envelope = parsed.data;
  const stderr = rawStderr.trim().length > 0 ? rawStderr : envelope.is_error ? envelope.result : "";

  return {
    stdout: envelope.result,
    stderr,
    rawStdout,
    rawStderr,
    code,
    reason: "exit",
    runtimeMs,
    cli: {
      type: envelope.type,
      subtype: envelope.subtype,
      isError: envelope.is_error,
      durationMs: envelope.duration_ms,
      durationApiMs: envelope.duration_api_ms,
      sessionId: envelope.session_id,
      requestId: envelope.request_id,
    },
  };
}

/**
 * Builds IAgentCliResult from raw run outcome (timeout, idle_timeout, killed, spawn_error).
 * Do not use for reason "exit"; use parseAgentCliExitToResult instead.
 */
export function buildResultFromRawRun(raw: IRawAgentCliRunResult): IAgentCliResult {
  const reason: IAgentTerminationReason = raw.reason;
  return {
    stdout: raw.rawStdout,
    stderr: raw.rawStderr,
    rawStdout: raw.rawStdout,
    rawStderr: raw.rawStderr,
    code: raw.code,
    reason,
    runtimeMs: raw.runtimeMs,
    idleMs: raw.idleMs,
  };
}
