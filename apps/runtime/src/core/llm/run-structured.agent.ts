/**
 * Runs a structured JSON agent via CLI and returns parsed output; supports one repair pass on invalid JSON. Used whenever the runtime needs typed agent output (category detection, options, repair, etc.). Invoked by generate-category, repair-json-output, and workspace-mutation flows.
 */
import { randomUUID } from "crypto";
import { getLlmProvider } from "./llm-provider-factory.js";
import type { IAgentSpec } from "./agent-spec.types.js";
import { ensureAgentRunTmpDir, removeAgentRunTmpDir } from "../agent-tmp-dir.js";
import { loadEnv } from "../env.js";
import { logAgentIO } from "../agent-io-logger.js";
import { estimatePromptTokens } from "./estimate-prompt-tokens.js";
import { AppError } from "../app-error.js";
import {
  AGENT_JSON_RECOVERY_FAILED,
  AGENT_JSON_RECOVERY_STARTED,
  AGENT_JSON_RECOVERY_SUCCEEDED,
  AGENT_JSON_REPAIR_SUCCEEDED,
  AGENT_STRUCTURED_CHAT_REUSED,
  AGENT_STRUCTURED_FAILED,
  AGENT_PROMPT_TOKENS,
} from "../runtime-log-events.js";
import { ERR_AGENT_FAILED } from "../error-codes.js";
import { getRuntimeLogger, logError } from "../logger.js";
import { jsonrepair } from "jsonrepair";
import { repairJsonOutput } from "./repair-json-output.js";

/** Thrown when agent returned success but output was empty. Callers may treat as "no findings". */
export class AgentEmptyOutputError extends Error {
  constructor(agentId: string) {
    super(`Agent ${agentId} returned success with empty output (treat as no findings)`);
    this.name = "AgentEmptyOutputError";
  }
}

const STRUCTURED_AGENT_REPLY_CONTRACT =
  "We only see your reply; we cannot see any files you create. Your entire reply must be the requested output and nothing else—no preamble, no summary, no path to a file. No markdown, no code blocks, no code fences.\n\n";

function buildStructuredAgentPromptPrefix(agent: { outputContractDescription?: string }): string {
  const shapeBlock =
    agent.outputContractDescription !== undefined && agent.outputContractDescription.length > 0
      ? `Expected output (matching this shape):\n${agent.outputContractDescription}\n\n`
      : "Expected output: as specified in the task below.\n\n";
  return STRUCTURED_AGENT_REPLY_CONTRACT + shapeBlock;
}

function prependStructuredAgentReplyContract<TInput, TOutput>(
  prompt: string,
  agent: IAgentSpec<TInput, TOutput>
): string {
  return buildStructuredAgentPromptPrefix(agent) + prompt;
}

export async function runStructuredAgent<TInput, TOutput>(args: {
  agent: IAgentSpec<TInput, TOutput>;
  input: TInput;
  workspace: string;
  resumeChatId?: string;
}): Promise<TOutput> {
  const { agent, input, workspace, resumeChatId } = args;
  const log = getRuntimeLogger();
  const parsedInput = agent.inputSchema.parse(input);
  const prompt = prependStructuredAgentReplyContract(agent.buildPrompt(parsedInput), agent);
  const model = agent.model;
  if (resumeChatId) {
    log.info({
      event: AGENT_STRUCTURED_CHAT_REUSED,
      agentId: agent.id,
      workspace,
      resumeChatId,
    });
  }
  const requestId = randomUUID();
  const agentTmpDir = ensureAgentRunTmpDir(workspace, requestId);
  log.info({
    event: AGENT_PROMPT_TOKENS,
    agentId: agent.id,
    model,
    promptChars: prompt.length,
    promptTokensApprox: estimatePromptTokens(prompt),
    requestId,
  });
  const result = await getLlmProvider().runStructured({
    prompt,
    model,
    workspace,
    resumeConversationId: resumeChatId,
    agentTmpDir,
    requestId,
  });

  const env = loadEnv();
  const ioLogEnabled = env.CTO_AGENT_IO_LOG_ENABLED;
  const agentIoBasePath = agentTmpDir;
  const baseRecord = {
    ts: new Date().toISOString(),
    agentId: agent.id,
    model,
    workspace,
    prompt,
    promptTokensApprox: estimatePromptTokens(prompt),
    execution: {
      code: result.reason === "exit" ? (result.success ? 0 : 1) : null,
      reason: result.reason,
      runtimeMs: result.runtimeMs,
      outputText: result.outputText,
      diagnosticText: result.diagnosticText,
      providerMeta: result.providerMeta,
    },
  };

  try {
    if (!result.success) {
      if (ioLogEnabled) logAgentIO(agentIoBasePath, { ...baseRecord, parseError: "Agent failed" });
      const detail = result.diagnosticText || result.outputText || "Agent failed";
      const err = new AppError(
        `Agent ${agent.id} failed (${result.reason}): ${detail}`,
        ERR_AGENT_FAILED,
        { agentId: agent.id, reason: result.reason, requestId, workspace }
      );
      logError(err, {
        event: AGENT_STRUCTURED_FAILED,
        component: "agent",
        operation: "runStructuredAgent",
        agentId: agent.id,
        requestId,
      });
      throw err;
    }

    const raw = result.outputText;
    if (raw.length === 0) {
      throw new AgentEmptyOutputError(agent.id);
    }
    const MIN_JSON_RECOVERY_LENGTH = 20;

    const shouldSkipRecovery = (): boolean => raw.length < MIN_JSON_RECOVERY_LENGTH;

    const parseDirectOutput = (candidate: string): TOutput => {
      const value: unknown = agent.extractOutput ? JSON.parse(candidate) : candidate;
      return agent.outputSchema.parse(value);
    };
    let recoveryInfo:
      | {
          attempted: true;
          reason: "extract_output_null" | "invalid_json_syntax";
          succeeded: boolean;
        }
      | undefined;

    const recoverOutput = async (args: {
      reason: "extract_output_null" | "invalid_json_syntax";
      parseError?: string;
    }): Promise<TOutput> => {
      recoveryInfo = {
        attempted: true,
        reason: args.reason,
        succeeded: false,
      };
      log.info({
        event: AGENT_JSON_RECOVERY_STARTED,
        agentId: agent.id,
        reason: args.reason,
      });
      try {
        const expectedOutputContract =
          agent.outputContractDescription ??
          "Valid JSON object matching the original agent output shape. No markdown, no code fences, no preamble.";
        const repairedJson = await repairJsonOutput({
          expectedOutputContract,
          receivedOutput: raw,
          parseError: args.parseError,
          workspace,
        });
        let parsedRaw: unknown;
        try {
          parsedRaw = JSON.parse(repairedJson);
        } catch (parseErr) {
          throw new AppError(
            "Repaired output is not valid JSON",
            ERR_AGENT_FAILED,
            { agentId: agent.id, reason: args.reason },
            { cause: parseErr }
          );
        }
        const parsed = agent.outputSchema.parse(parsedRaw);
        recoveryInfo = {
          attempted: true,
          reason: args.reason,
          succeeded: true,
        };
        log.info({
          event: AGENT_JSON_RECOVERY_SUCCEEDED,
          agentId: agent.id,
          reason: args.reason,
        });
        return parsed;
      } catch (error) {
        if (error instanceof Error && requestId !== undefined) {
          (error as Error & { requestId?: string }).requestId = requestId;
        }
        logError(error, {
          event: AGENT_JSON_RECOVERY_FAILED,
          component: "agent",
          operation: "runStructuredAgentRecovery",
          agentId: agent.id,
          reason: args.reason,
          requestId,
        });
        throw error;
      }
    };

    /* Try direct parse; on extract_output_null or invalid_json_syntax attempt repair once before rethrowing. */
    try {
      const toParse = agent.extractOutput ? agent.extractOutput(raw) : raw;
      if (toParse === null) {
        if (!agent.extractOutput) {
          throw new AppError(`Agent ${agent.id} produced no parseable output`, ERR_AGENT_FAILED, {
            agentId: agent.id,
            workspace,
          });
        }
        if (shouldSkipRecovery()) {
          throw new AppError(
            `Agent ${agent.id} produced empty or too-short output (${raw.length} chars); skipping recovery`,
            ERR_AGENT_FAILED,
            { agentId: agent.id, outputLength: raw.length, workspace }
          );
        }
        const recovered = await recoverOutput({ reason: "extract_output_null" });
        if (ioLogEnabled) {
          logAgentIO(agentIoBasePath, {
            ...baseRecord,
            parsedOutput: recovered,
            recovery: recoveryInfo,
          });
        }
        return recovered;
      }
      const parsed = parseDirectOutput(toParse);
      if (ioLogEnabled) logAgentIO(agentIoBasePath, { ...baseRecord, parsedOutput: parsed });
      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError && !shouldSkipRecovery()) {
        const candidate = agent.extractOutput ? agent.extractOutput(raw) : raw;
        if (candidate !== null) {
          try {
            const repaired = jsonrepair(candidate);
            const parsed = parseDirectOutput(repaired);
            log.info({
              event: AGENT_JSON_REPAIR_SUCCEEDED,
              agentId: agent.id,
            });
            if (ioLogEnabled) {
              logAgentIO(agentIoBasePath, { ...baseRecord, parsedOutput: parsed });
            }
            return parsed;
          } catch {
            /* fall through to LLM recovery when agent.extractOutput */
          }
        }
        if (agent.extractOutput) {
          const recovered = await recoverOutput({
            reason: "invalid_json_syntax",
            parseError: error.message,
          });
          if (ioLogEnabled) {
            logAgentIO(agentIoBasePath, {
              ...baseRecord,
              parsedOutput: recovered,
              recovery: recoveryInfo,
            });
          }
          return recovered;
        }
      }
      const msg = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && requestId !== undefined) {
        (error as Error & { requestId?: string }).requestId = requestId;
      }
      if (ioLogEnabled) {
        logAgentIO(agentIoBasePath, {
          ...baseRecord,
          parseError: msg,
          recovery: recoveryInfo,
        });
      }
      logError(error, {
        event: AGENT_STRUCTURED_FAILED,
        component: "agent",
        operation: "runStructuredAgent",
        agentId: agent.id,
        requestId,
      });
      throw error;
    }
  } finally {
    removeAgentRunTmpDir(agentTmpDir);
  }
}
