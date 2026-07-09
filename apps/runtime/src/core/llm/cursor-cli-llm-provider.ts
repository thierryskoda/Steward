/**
 * Cursor CLI LLM provider: wraps run-agent-cli-process and agent-transcript-capture.
 * Maps CLI result to provider-neutral ILLMRunResult; CLI types stay internal to this adapter.
 */

import type {
  ILLMProvider,
  ILLMRunResult,
  ILLMStructuredRunArgs,
  ILLMMutationRunArgs,
  ILLMLifecycleCallbacks,
  ILLMRequestContext,
} from "./llm-provider.types.js";
import type { IAgentCliResult } from "./agent-cli-result.types.js";
import { runAgentCliProcessWithEnv } from "./run-agent-cli-process.js";
import type {
  IAgentQueueLifecycleCallbacks,
  IAgentRequestContext,
} from "./run-agent-cli-process.js";
import { createChatId } from "./agent-transcript-capture.js";

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

export function createCursorCliLlmProvider(): ILLMProvider {
  return {
    async runStructured(args: ILLMStructuredRunArgs): Promise<ILLMRunResult> {
      const cliResult = await runAgentCliProcessWithEnv({
        prompt: args.prompt,
        model: args.model,
        workspace: args.workspace,
        resumeChatId: args.resumeConversationId,
        executionMode: "ask",
        agentTmpDir: args.agentTmpDir,
        requestId: args.requestId,
      });
      return cliResultToLlmRunResult(cliResult);
    },

    async runMutation(args: ILLMMutationRunArgs): Promise<ILLMRunResult> {
      const cliResult = await runAgentCliProcessWithEnv({
        prompt: args.prompt,
        model: args.model,
        workspace: args.workspace,
        resumeChatId: args.resumeConversationId,
        executionMode: "force",
        lifecycleCallbacks: toCliLifecycle(args.lifecycleCallbacks),
        requestContext: toCliRequestContext(args.requestContext),
        agentTmpDir: args.agentTmpDir,
        requestId: args.requestId,
      });
      return cliResultToLlmRunResult(cliResult);
    },

    createConversationId(): Promise<string | null> {
      return createChatId();
    },
  };
}
