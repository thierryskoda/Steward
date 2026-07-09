/**
 * Shared types for agent CLI execution: result shape and termination reasons.
 * Used by queue/orchestration, process runner, and envelope parser.
 */

export type IAgentTerminationReason =
  | "exit"
  | "timeout"
  | "idle_timeout"
  | "spawn_error"
  | "killed"
  | "invalid_cli_json"
  | "shutdown_cancelled";

export type IAgentCliResult = {
  stdout: string;
  stderr: string;
  rawStdout: string;
  rawStderr: string;
  code: number | null;
  reason: IAgentTerminationReason;
  runtimeMs?: number;
  idleMs?: number;
  cli?: {
    type: string;
    subtype?: string;
    isError: boolean;
    durationMs?: number;
    durationApiMs?: number;
    sessionId?: string;
    requestId?: string;
  };
};

export type IAgentProcessConfig = {
  timeoutMs: number;
  watchdogIdleMs: number;
  killGraceMs: number;
};

/** Raw outcome from the process runner before envelope parsing. */
export type IRawAgentCliRunReason = "exit" | "timeout" | "idle_timeout" | "killed" | "spawn_error";

export type IRawAgentCliRunResult = {
  rawStdout: string;
  rawStderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  reason: IRawAgentCliRunReason;
  runtimeMs?: number;
  idleMs?: number;
};
