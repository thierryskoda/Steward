/**
 * Provider-neutral LLM execution port. All providers implement this contract.
 * Result shape and reason taxonomy are normalized; adapters map provider-specific errors into this set.
 */

/** Canonical termination reasons; adapters must map provider errors into this union. */
export type ILLMTerminationReason =
  | "exit"
  | "timeout"
  | "idle_timeout"
  | "spawn_error"
  | "killed"
  | "invalid_cli_json"
  | "shutdown_cancelled";

/** Optional provider-specific metadata (observability, request id, etc.). */
export type ILLMProviderMeta = {
  type: string;
  subtype?: string;
  isError?: boolean;
  durationMs?: number;
  durationApiMs?: number;
  sessionId?: string;
  requestId?: string;
};

/** Provider-neutral run result; no CLI-specific fields. */
export type ILLMRunResult = {
  outputText: string;
  diagnosticText: string;
  reason: ILLMTerminationReason;
  success: boolean;
  runtimeMs?: number;
  idleMs?: number;
  providerMeta?: ILLMProviderMeta;
};

/** Request context for observability and lifecycle hooks. */
export type ILLMRequestContext = {
  agentId?: string;
  categoryId?: string;
  itemId?: string;
};

/** One trusted, read-only stdio MCP server exposed only for a structured run. */
export type IReadOnlyMcpServer = {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  enabledTools: string[];
};

/** Lifecycle callbacks for mutation runs (queue/start/finish). */
export type ILLMLifecycleCallbacks = {
  onQueued?: () => void;
  onStarted?: () => void;
  onFinished?: () => void;
};

/** Args for structured (ask-mode) execution. */
import type { IJsonSchema } from "./json-schema.types.js";

export type ILLMStructuredRunArgs = {
  prompt: string;
  model: string;
  workspace: string;
  outputJsonSchema: IJsonSchema | undefined;
  resumeConversationId?: string;
  agentTmpDir?: string;
  isolatedCodexHome?: string;
  readOnlyMcpServer?: IReadOnlyMcpServer;
  requestId?: string;
  deadlineAt: number | undefined;
};

/** Args for workspace-mutation (force-mode) execution. */
export type ILLMMutationRunArgs = {
  prompt: string;
  model: string;
  workspace: string;
  resumeConversationId?: string;
  lifecycleCallbacks?: ILLMLifecycleCallbacks;
  requestContext?: ILLMRequestContext;
  agentTmpDir?: string;
  requestId?: string;
};

/** Provider port: structured run, mutation run, and conversation id creation for resume/transcript. */
export type ILLMProvider = {
  runStructured(args: ILLMStructuredRunArgs): Promise<ILLMRunResult>;
  runMutation(args: ILLMMutationRunArgs): Promise<ILLMRunResult>;
  createConversationId(): Promise<string | null>;
};
