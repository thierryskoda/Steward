/**
 * Orchestrates a workspace-mutation agent run with optional chat resume, idle-timeout retry, transcript capture, and LLM outcome evaluation. Single place for mutation flow so callers get transcript and evaluated outcome. Invoked when implementing a category item or similar long-running edit.
 */
import { randomUUID } from "crypto";
import { ensureAgentRunTmpDir, removeAgentRunTmpDir } from "../agent-tmp-dir.js";
import { getRuntimeLogger, logError } from "../logger.js";
import { getLlmProvider } from "./llm-provider-factory.js";
import type { IAgentSpec } from "./agent-spec.types.js";
import { loadEnv } from "../env.js";
import { logAgentIO } from "../agent-io-logger.js";
import { estimatePromptTokens } from "./estimate-prompt-tokens.js";
import {
  AGENT_IDLE_RESUME_RETRY_FAILED,
  AGENT_IDLE_RESUME_RETRY_SCHEDULED,
  AGENT_IDLE_RESUME_RETRY_STARTED,
  AGENT_IDLE_RESUME_RETRY_SUCCEEDED,
  AGENT_PROMPT_TOKENS,
  AGENT_TRANSCRIPT_CAPTURED,
  AGENT_TRANSCRIPT_CAPTURE_SKIPPED,
  AGENT_TRANSCRIPT_CHAT_CREATED,
  AGENT_TRANSCRIPT_CHAT_CREATE_FAILED,
  AGENT_TRANSCRIPT_RESUMED,
  EVALUATE_MUTATION_OUTCOME_ERROR,
} from "../runtime-log-events.js";
import { STATUS } from "@steward/contracts/schemas";
import type {
  IMutationResult,
  IMutationOutcome,
  IEvaluatedFailureReason,
} from "./mutation-result.types.js";
import type {
  IAgentQueueLifecycleCallbacks,
  IAgentRequestContext,
} from "./run-agent-cli-process.js";
import { getTranscriptFetcher } from "../sources/transcript-fetcher-factory.js";
import { runStructuredAgent } from "./run-structured.agent.js";
import { evaluateMutationOutcomeAgent } from "./evaluate-mutation-outcome.agent.js";

const CONTINUATION_PROMPT =
  "Continue from the previous context in this chat. Do not restart exploration from scratch. Inspect current repo state before making new edits. Finish with a short plain-text execution summary.";

type IRunWorkspaceMutationAgentDeps = {
  cursorProjectDirFromRoot: (workspace: string) => string;
};

export async function runWorkspaceMutationAgent<TInput>(args: {
  agent: IAgentSpec<TInput, unknown>;
  input: TInput;
  workspace: string;
  resumeChatId?: string;
  lifecycleCallbacks?: IAgentQueueLifecycleCallbacks;
  requestContext?: IAgentRequestContext;
  deps: IRunWorkspaceMutationAgentDeps;
}): Promise<IMutationResult> {
  const {
    agent,
    input,
    workspace,
    resumeChatId: resumeChatIdArg,
    lifecycleCallbacks,
    requestContext,
    deps: _deps,
  } = args;
  const log = getRuntimeLogger();
  const parsedInput = agent.inputSchema.parse(input);
  const prompt = agent.buildPrompt(parsedInput);
  const model = agent.model;
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

  const env = loadEnv();
  /* Ensure chat id for transcript and resume. */
  let chatId: string | null = resumeChatIdArg ?? null;
  if (!chatId) {
    chatId = await getLlmProvider().createConversationId();
  }
  if (!chatId) {
    log.info({
      event: AGENT_TRANSCRIPT_CHAT_CREATE_FAILED,
      agentId: agent.id,
      workspace,
      requestId,
    });
  } else if (resumeChatIdArg) {
    log.info({
      event: AGENT_TRANSCRIPT_RESUMED,
      agentId: agent.id,
      workspace,
      chatId,
      requestId,
    });
  } else {
    log.info({
      event: AGENT_TRANSCRIPT_CHAT_CREATED,
      agentId: agent.id,
      workspace,
      chatId,
      requestId,
    });
  }
  const baseRequestContext: IAgentRequestContext = {
    ...requestContext,
    agentId: agent.id,
  };
  const provider = getLlmProvider();
  let result = await provider.runMutation({
    prompt,
    model,
    workspace,
    resumeConversationId: chatId ?? undefined,
    lifecycleCallbacks,
    requestContext: baseRequestContext,
    agentTmpDir,
    requestId,
  });

  /* One continuation attempt on idle timeout. */
  if (result.reason === "idle_timeout" && chatId) {
    log.info({
      event: AGENT_IDLE_RESUME_RETRY_SCHEDULED,
      agentId: agent.id,
      chatId,
      firstReason: result.reason,
      firstRuntimeMs: result.runtimeMs,
    });
    log.info({
      event: AGENT_IDLE_RESUME_RETRY_STARTED,
      agentId: agent.id,
      chatId,
      attemptIndex: 2,
      requestId,
    });
    const retryResult = await provider.runMutation({
      prompt: CONTINUATION_PROMPT,
      model,
      workspace,
      resumeConversationId: chatId,
      lifecycleCallbacks,
      requestContext: baseRequestContext,
      agentTmpDir,
      requestId,
    });
    const retrySucceeded = retryResult.success;
    if (retrySucceeded) {
      log.info({
        event: AGENT_IDLE_RESUME_RETRY_SUCCEEDED,
        agentId: agent.id,
        chatId,
        retryRuntimeMs: retryResult.runtimeMs,
      });
    } else {
      log.info({
        event: AGENT_IDLE_RESUME_RETRY_FAILED,
        agentId: agent.id,
        chatId,
        secondReason: retryResult.reason,
        secondRuntimeMs: retryResult.runtimeMs,
      });
    }
    result = {
      ...retryResult,
      runtimeMs: (result.runtimeMs ?? 0) + (retryResult.runtimeMs ?? 0),
    };
  }

  /* Capture transcript via provider-aware fetcher. */
  let transcript: IMutationResult["transcript"];
  if (chatId) {
    await new Promise((r) => setTimeout(r, 500));
    const capture = await getTranscriptFetcher().getTranscriptCapture({
      conversationId: chatId,
      workspace,
    });
    if (capture === undefined) {
      log.info({
        event: AGENT_TRANSCRIPT_CAPTURE_SKIPPED,
        agentId: agent.id,
        workspace,
        chatId,
        reason: "path_not_found",
      });
    } else {
      transcript = capture;
      log.info({
        event: AGENT_TRANSCRIPT_CAPTURED,
        agentId: agent.id,
        workspace,
        chatId,
        transcriptPath: capture.path,
        entriesCount: capture.entries.length,
      });
    }
  }

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

  let evaluatedStatus: "success" | "failure" | undefined;
  let evaluatedFailureReason: IEvaluatedFailureReason | undefined;
  let evaluatedExplanation: string | undefined;

  const isShutdownCancelled = result.reason === "shutdown_cancelled";

  if (isShutdownCancelled) {
    evaluatedExplanation = "Activity stopped; agent work cancelled.";
  } else {
    /* Classify success/failure from output/diagnostic. */
    try {
      const evalResult = await runStructuredAgent({
        agent: evaluateMutationOutcomeAgent,
        input: {
          taskIntent: prompt,
          code: result.reason === "exit" ? (result.success ? 0 : 1) : null,
          reason: result.reason,
          outputExcerpt: result.outputText,
          diagnosticExcerpt: result.diagnosticText,
        },
        workspace,
      });
      evaluatedStatus = evalResult.status;
      evaluatedFailureReason =
        evalResult.status === "failure"
          ? (evalResult.failureReason as IEvaluatedFailureReason)
          : undefined;
      evaluatedExplanation = evalResult.explanation;
    } catch (e) {
      evaluatedStatus = "failure";
      evaluatedFailureReason = "evaluator-error";
      evaluatedExplanation = e instanceof Error ? e.message : String(e);
      logError(e, {
        event: EVALUATE_MUTATION_OUTCOME_ERROR,
        component: "core",
        operation: "evaluateMutationOutcome",
        workspace,
      });
    }
  }

  const providerReportedError = result.providerMeta?.isError === true;
  const outcome: IMutationOutcome = isShutdownCancelled
    ? "cancelled"
    : providerReportedError
      ? STATUS.FAILED
      : evaluatedStatus === "success"
        ? "succeeded"
        : evaluatedStatus === "failure"
          ? STATUS.FAILED
          : result.success
            ? "succeeded"
            : result.reason === "timeout"
              ? "timeout"
              : result.reason === "idle_timeout"
                ? "idle_timeout"
                : result.reason === "spawn_error"
                  ? "spawn_error"
                  : result.reason === "killed"
                    ? "killed"
                    : STATUS.FAILED;

  let summaryFallback: string;
  if (outcome === "succeeded") {
    const raw = result.outputText;
    const toParse = agent.extractOutput ? agent.extractOutput(raw) : raw;
    if (toParse === null) {
      summaryFallback = raw.trim().slice(0, 500);
    } else {
      try {
        const value: unknown = agent.extractOutput ? JSON.parse(toParse) : toParse;
        const parsed = agent.outputSchema.parse(value);
        if (typeof parsed === "string") summaryFallback = parsed.trim().slice(0, 500);
        else {
          const obj = parsed as Record<string, unknown>;
          summaryFallback =
            typeof obj?.summary === "string"
              ? obj.summary.trim().slice(0, 500)
              : JSON.stringify(parsed).slice(0, 500);
        }
      } catch {
        summaryFallback = raw.trim().slice(0, 500);
      }
    }
  } else {
    summaryFallback = (result.diagnosticText || result.outputText || result.reason)
      .trim()
      .slice(0, 500);
  }
  const summary = evaluatedExplanation?.trim() ?? summaryFallback;

  const mutationResult: IMutationResult = {
    outcome,
    summary,
    outputText: result.outputText,
    diagnosticText: result.diagnosticText,
    providerMeta: result.providerMeta,
    runtimeMs: result.runtimeMs,
    code: result.reason === "exit" ? (result.success ? 0 : 1) : null,
    reason: result.reason,
    evaluatedStatus,
    evaluatedFailureReason,
    evaluatedExplanation,
    transcript,
  };

  try {
    if (ioLogEnabled) {
      logAgentIO(agentIoBasePath, {
        ...baseRecord,
        transcript,
        parsedOutput:
          outcome === "succeeded" ? { summary, evaluatedStatus, evaluatedExplanation } : undefined,
        parseError:
          outcome !== "succeeded"
            ? `${result.reason}: ${evaluatedFailureReason ?? ""} ${summary}`
            : undefined,
      });
    }

    return mutationResult;
  } finally {
    removeAgentRunTmpDir(agentTmpDir);
  }
}
