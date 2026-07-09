/**
 * Parses `claude -p --output-format json` stdout into the runtime's provider-neutral result.
 * Claude Code emits one JSON object for print mode; stderr is retained as diagnostics.
 */
import type { IAgentCliResult } from "./agent-cli-result.types.js";
import type { ILLMRunResult } from "./llm-provider.types.js";
import {
  claudeCodeCliErrorSchema,
  claudeCodeCliJsonResultSchema,
} from "./claude-code-cli-json.schemas.js";
import type { z } from "zod";

export type IParseClaudeCodeCliJsonInput = {
  rawStdout: string;
  rawStderr: string;
  code: number | null;
  runtimeMs: number;
};

type IClaudeCodeCliError = z.infer<typeof claudeCodeCliErrorSchema>;

function joinDiagnostics(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n");
}

function decodeClaudeCodeCliJson(
  rawStdout: string
): { data: z.infer<typeof claudeCodeCliJsonResultSchema> } | { error: string } {
  const trimmed = rawStdout.trim();
  if (trimmed.length === 0) {
    return { error: "Claude Code CLI JSON parse failed: empty stdout." };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(trimmed);
  } catch {
    return {
      error: `Claude Code CLI JSON parse failed: invalid JSON: ${trimmed.slice(0, 200)}`,
    };
  }

  const result = claudeCodeCliJsonResultSchema.safeParse(decoded);
  if (!result.success) {
    return {
      error: `Claude Code CLI JSON parse failed: invalid result object: ${result.error.message}`,
    };
  }

  return { data: result.data };
}

function errorToMessage(error: IClaudeCodeCliError | undefined): string | undefined {
  if (error === undefined) return undefined;
  if (typeof error === "string") return error;
  return error.message;
}

export function parseClaudeCodeCliJsonToRunResult(
  input: IParseClaudeCodeCliJsonInput
): ILLMRunResult {
  const parsed = decodeClaudeCodeCliJson(input.rawStdout);
  if ("error" in parsed) {
    return {
      outputText: "",
      diagnosticText: joinDiagnostics([parsed.error, input.rawStderr]),
      reason: "invalid_cli_json",
      success: false,
      runtimeMs: input.runtimeMs,
      providerMeta: {
        type: "claude_code_cli",
        subtype: "print",
        isError: true,
      },
    };
  }

  const errorMessage =
    errorToMessage(parsed.data.error) ??
    (parsed.data.is_error === true ? "Claude Code CLI reported an error." : undefined);
  const success = input.code === 0 && parsed.data.is_error !== true;

  return {
    outputText: parsed.data.result ?? "",
    diagnosticText: joinDiagnostics([errorMessage ?? "", input.rawStderr]),
    reason: "exit",
    success,
    runtimeMs: input.runtimeMs,
    providerMeta: {
      type: "claude_code_cli",
      subtype: parsed.data.subtype ?? parsed.data.type ?? "print",
      isError: !success,
      durationMs: parsed.data.duration_ms,
      durationApiMs: parsed.data.duration_api_ms,
      sessionId: parsed.data.session_id,
    },
  };
}

export function parseClaudeCodeCliJsonToAgentResult(
  input: IParseClaudeCodeCliJsonInput
): IAgentCliResult {
  const runResult = parseClaudeCodeCliJsonToRunResult(input);
  return {
    stdout: runResult.outputText,
    stderr: runResult.diagnosticText,
    rawStdout: input.rawStdout,
    rawStderr: input.rawStderr,
    code: input.code,
    reason: runResult.reason,
    runtimeMs: runResult.runtimeMs,
    cli: {
      type: runResult.providerMeta?.type ?? "claude_code_cli",
      subtype: runResult.providerMeta?.subtype,
      isError: runResult.providerMeta?.isError ?? !runResult.success,
      durationMs: runResult.providerMeta?.durationMs,
      durationApiMs: runResult.providerMeta?.durationApiMs,
      sessionId: runResult.providerMeta?.sessionId,
      requestId: runResult.providerMeta?.requestId,
    },
  };
}
