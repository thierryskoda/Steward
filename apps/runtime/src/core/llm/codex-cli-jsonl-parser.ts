/**
 * Parses `codex exec --json` JSONL stdout into the runtime's provider-neutral result.
 * Codex streams progress events; the final useful response is the last completed agent_message.
 */
import type { IAgentCliResult } from "./agent-cli-result.types.js";
import type { ILLMRunResult } from "./llm-provider.types.js";
import {
  codexCliErrorEventSchema,
  codexCliItemCompletedEventSchema,
  codexCliJsonlBaseEventSchema,
  codexCliThreadStartedEventSchema,
  codexCliTurnFailedEventSchema,
} from "./codex-cli-jsonl.schemas.js";

export type IParseCodexCliJsonlInput = {
  rawStdout: string;
  rawStderr: string;
  code: number | null;
  runtimeMs: number;
};

type ICodexCliParsedStream = {
  outputText: string;
  threadId?: string;
  errorMessage?: string;
};

function joinDiagnostics(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n");
}

function parseCodexCliJsonlStream(rawStdout: string): ICodexCliParsedStream | { error: string } {
  let outputText = "";
  let threadId: string | undefined;
  let errorMessage: string | undefined;

  const lines = rawStdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      return { error: `Codex CLI JSONL parse failed: invalid JSON line: ${line.slice(0, 200)}` };
    }

    const baseResult = codexCliJsonlBaseEventSchema.safeParse(decoded);
    if (!baseResult.success) {
      return {
        error: `Codex CLI JSONL parse failed: event missing string type: ${baseResult.error.message}`,
      };
    }

    const eventType = baseResult.data.type;
    if (eventType === "thread.started") {
      const result = codexCliThreadStartedEventSchema.safeParse(decoded);
      if (!result.success) {
        return {
          error: `Codex CLI JSONL parse failed: invalid thread.started event: ${result.error.message}`,
        };
      }
      threadId = result.data.thread_id;
      continue;
    }

    if (eventType === "item.completed") {
      const result = codexCliItemCompletedEventSchema.safeParse(decoded);
      if (!result.success) {
        return {
          error: `Codex CLI JSONL parse failed: invalid item.completed event: ${result.error.message}`,
        };
      }
      if (result.data.item.type === "agent_message" && result.data.item.text !== undefined) {
        outputText = result.data.item.text;
      }
      continue;
    }

    if (eventType === "error") {
      const result = codexCliErrorEventSchema.safeParse(decoded);
      if (!result.success) {
        return {
          error: `Codex CLI JSONL parse failed: invalid error event: ${result.error.message}`,
        };
      }
      errorMessage = result.data.message ?? "Codex CLI emitted an error event.";
      continue;
    }

    if (eventType === "turn.failed") {
      const result = codexCliTurnFailedEventSchema.safeParse(decoded);
      if (!result.success) {
        return {
          error: `Codex CLI JSONL parse failed: invalid turn.failed event: ${result.error.message}`,
        };
      }
      errorMessage =
        result.data.message ??
        result.data.error?.message ??
        "Codex CLI emitted a turn.failed event.";
    }
  }

  return { outputText, threadId, errorMessage };
}

export function parseCodexCliJsonlToRunResult(input: IParseCodexCliJsonlInput): ILLMRunResult {
  const parsed = parseCodexCliJsonlStream(input.rawStdout);
  if ("error" in parsed) {
    return {
      outputText: "",
      diagnosticText: joinDiagnostics([parsed.error, input.rawStderr]),
      reason: "invalid_cli_json",
      success: false,
      runtimeMs: input.runtimeMs,
      providerMeta: {
        type: "codex_cli",
        subtype: "exec",
        isError: true,
      },
    };
  }

  const success = input.code === 0 && parsed.errorMessage === undefined;
  return {
    outputText: parsed.outputText,
    diagnosticText: joinDiagnostics([parsed.errorMessage ?? "", input.rawStderr]),
    reason: "exit",
    success,
    runtimeMs: input.runtimeMs,
    providerMeta: {
      type: "codex_cli",
      subtype: "exec",
      isError: !success,
      sessionId: parsed.threadId,
    },
  };
}

export function parseCodexCliJsonlToAgentResult(input: IParseCodexCliJsonlInput): IAgentCliResult {
  const runResult = parseCodexCliJsonlToRunResult(input);
  return {
    stdout: runResult.outputText,
    stderr: runResult.diagnosticText,
    rawStdout: input.rawStdout,
    rawStderr: input.rawStderr,
    code: input.code,
    reason: runResult.reason,
    runtimeMs: runResult.runtimeMs,
    cli: {
      type: runResult.providerMeta?.type ?? "codex_cli",
      subtype: runResult.providerMeta?.subtype,
      isError: runResult.providerMeta?.isError ?? !runResult.success,
      sessionId: runResult.providerMeta?.sessionId,
      requestId: runResult.providerMeta?.requestId,
    },
  };
}
