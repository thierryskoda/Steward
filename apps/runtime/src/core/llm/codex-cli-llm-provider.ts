/**
 * Codex CLI LLM provider: wraps `codex exec --json` and maps Codex JSONL output
 * to provider-neutral ILLMRunResult. Uses logical conversation ids so existing
 * runtime workflows can request a chat id before Codex creates its real thread.
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
import { runCodexCliProcessWithEnv } from "./run-agent-cli-process.js";
import type {
  IAgentQueueLifecycleCallbacks,
  IAgentRequestContext,
} from "./run-agent-cli-process.js";

const CODEX_LOGICAL_CONVERSATION_PREFIX = "codex-local-";

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

function isLogicalCodexConversationId(conversationId: string): boolean {
  return conversationId.startsWith(CODEX_LOGICAL_CONVERSATION_PREFIX);
}

export function createCodexCliLlmProvider(): ILLMProvider {
  const sessionIdsByLogicalConversationId = new Map<string, string>();

  const resolveSessionId = (conversationId: string | undefined): string | undefined => {
    if (conversationId === undefined) return undefined;
    if (!isLogicalCodexConversationId(conversationId)) return conversationId;
    return sessionIdsByLogicalConversationId.get(conversationId);
  };

  const rememberSessionId = (conversationId: string | undefined, result: ILLMRunResult): void => {
    if (conversationId === undefined) return;
    if (!isLogicalCodexConversationId(conversationId)) return;
    const sessionId = result.providerMeta?.sessionId;
    if (sessionId === undefined || sessionId.trim().length === 0) return;
    sessionIdsByLogicalConversationId.set(conversationId, sessionId);
  };

  return {
    async runStructured(args: ILLMStructuredRunArgs): Promise<ILLMRunResult> {
      const cliResult = await runCodexCliProcessWithEnv({
        prompt: args.prompt,
        model: args.model,
        workspace: args.workspace,
        resumeSessionId: resolveSessionId(args.resumeConversationId),
        executionMode: "ask",
        agentTmpDir: args.agentTmpDir,
        requestId: args.requestId,
      });
      const result = cliResultToLlmRunResult(cliResult);
      rememberSessionId(args.resumeConversationId, result);
      return result;
    },

    async runMutation(args: ILLMMutationRunArgs): Promise<ILLMRunResult> {
      const cliResult = await runCodexCliProcessWithEnv({
        prompt: args.prompt,
        model: args.model,
        workspace: args.workspace,
        resumeSessionId: resolveSessionId(args.resumeConversationId),
        executionMode: "force",
        lifecycleCallbacks: toCliLifecycle(args.lifecycleCallbacks),
        requestContext: toCliRequestContext(args.requestContext),
        agentTmpDir: args.agentTmpDir,
        requestId: args.requestId,
      });
      const result = cliResultToLlmRunResult(cliResult);
      rememberSessionId(args.resumeConversationId, result);
      return result;
    },

    createConversationId(): Promise<string | null> {
      return Promise.resolve(`${CODEX_LOGICAL_CONVERSATION_PREFIX}${randomUUID()}`);
    },
  };
}
