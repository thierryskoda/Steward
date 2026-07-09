/**
 * Claude Code CLI LLM provider: wraps `claude -p --output-format json` and maps
 * Claude's print-mode JSON output to provider-neutral ILLMRunResult.
 */
import { randomUUID } from "crypto";
import type {
  ILLMProvider,
  ILLMRunResult,
  ILLMStructuredRunArgs,
  ILLMMutationRunArgs,
  ILLMLifecycleCallbacks,
  ILLMRequestContext,
} from "./llm-provider.types.js";
import type { IAgentCliResult } from "./agent-cli-result.types.js";
import {
  runClaudeCodeCliProcessWithEnv,
  type IAgentQueueLifecycleCallbacks,
  type IAgentRequestContext,
} from "./run-agent-cli-process.js";
import type { IClaudeCodeCliSession } from "./claude-code-cli-process-runner.js";

function cliResultToLlmRunResult(cli: IAgentCliResult): ILLMRunResult {
  const success = cli.reason === "exit" && cli.code === 0 && cli.cli?.isError !== true;
  return {
    outputText: cli.stdout,
    diagnosticText: cli.stderr,
    reason: cli.reason,
    success,
    runtimeMs: cli.runtimeMs,
    idleMs: cli.idleMs,
    providerMeta: cli.cli
      ? {
          type: cli.cli.type,
          subtype: cli.cli.subtype,
          isError: cli.cli.isError,
          durationMs: cli.cli.durationMs,
          durationApiMs: cli.cli.durationApiMs,
          sessionId: cli.cli.sessionId,
          requestId: cli.cli.requestId,
        }
      : undefined,
  };
}

function toCliLifecycle(
  cb: ILLMLifecycleCallbacks | undefined
): IAgentQueueLifecycleCallbacks | undefined {
  if (!cb) return undefined;
  return {
    onQueued: cb.onQueued,
    onStarted: cb.onStarted,
    onFinished: cb.onFinished,
  };
}

function toCliRequestContext(
  ctx: ILLMRequestContext | undefined
): IAgentRequestContext | undefined {
  if (!ctx) return undefined;
  return {
    agentId: ctx.agentId,
    categoryId: ctx.categoryId,
    itemId: ctx.itemId,
  };
}

export function createClaudeCodeCliLlmProvider(): ILLMProvider {
  const freshSessionIds = new Set<string>();
  const startedSessionIds = new Set<string>();

  const resolveSession = (
    conversationId: string | undefined
  ): IClaudeCodeCliSession | undefined => {
    if (conversationId === undefined) return undefined;
    if (freshSessionIds.has(conversationId) && !startedSessionIds.has(conversationId)) {
      return { mode: "start", sessionId: conversationId };
    }
    return { mode: "resume", sessionId: conversationId };
  };

  const rememberStartedSession = (
    conversationId: string | undefined,
    result: ILLMRunResult
  ): void => {
    if (!result.success) return;
    if (conversationId !== undefined) {
      startedSessionIds.add(conversationId);
      freshSessionIds.delete(conversationId);
    }
    const providerSessionId = result.providerMeta?.sessionId;
    if (providerSessionId === undefined || providerSessionId.trim().length === 0) return;
    startedSessionIds.add(providerSessionId);
    freshSessionIds.delete(providerSessionId);
  };

  return {
    async runStructured(args: ILLMStructuredRunArgs): Promise<ILLMRunResult> {
      const cliResult = await runClaudeCodeCliProcessWithEnv({
        prompt: args.prompt,
        model: args.model,
        workspace: args.workspace,
        session: resolveSession(args.resumeConversationId),
        executionMode: "ask",
        agentTmpDir: args.agentTmpDir,
        requestId: args.requestId,
      });
      const result = cliResultToLlmRunResult(cliResult);
      rememberStartedSession(args.resumeConversationId, result);
      return result;
    },

    async runMutation(args: ILLMMutationRunArgs): Promise<ILLMRunResult> {
      const cliResult = await runClaudeCodeCliProcessWithEnv({
        prompt: args.prompt,
        model: args.model,
        workspace: args.workspace,
        session: resolveSession(args.resumeConversationId),
        executionMode: "force",
        lifecycleCallbacks: toCliLifecycle(args.lifecycleCallbacks),
        requestContext: toCliRequestContext(args.requestContext),
        agentTmpDir: args.agentTmpDir,
        requestId: args.requestId,
      });
      const result = cliResultToLlmRunResult(cliResult);
      rememberStartedSession(args.resumeConversationId, result);
      return result;
    },

    createConversationId(): Promise<string | null> {
      const sessionId = randomUUID();
      freshSessionIds.add(sessionId);
      return Promise.resolve(sessionId);
    },
  };
}
