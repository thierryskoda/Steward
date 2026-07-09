/**
 * Spawns `claude -p --output-format json`, wires stdio, applies hard and idle
 * timeouts, and returns raw execution output. Queue orchestration and JSON parsing
 * live in run-agent-cli-process.
 */
import { spawn as nodeSpawn, type ChildProcess } from "child_process";
import {
  AGENT_FAILED_SPAWN,
  AGENT_TERMINATED,
  AGENT_TIMEOUT_HARD,
  AGENT_TIMEOUT_IDLE,
} from "../runtime-log-events.js";
import { getRuntimeLogger, logError, type ILogErrorExtra } from "../logger.js";
import type {
  IAgentCliResult,
  IAgentProcessConfig,
  IRawAgentCliRunReason,
  IRawAgentCliRunResult,
} from "./agent-cli-result.types.js";
import type {
  IAgentExecutionMode,
  IAgentRunnerRequestContext,
} from "./agent-cli-process-runner.js";

const CLAUDE_CODE_CLI_CMD = "claude";

export type IClaudeCodeCliSession =
  | {
      mode: "start";
      sessionId: string;
    }
  | {
      mode: "resume";
      sessionId: string;
    };

export type IBuildClaudeCodeCliArgsInput = {
  prompt: string;
  model: string;
  executionMode: IAgentExecutionMode;
  session: IClaudeCodeCliSession | undefined;
};

export function buildClaudeCodeCliArgs(input: IBuildClaudeCodeCliArgsInput): {
  spawnArgs: string[];
  logArgs: string[];
} {
  const { prompt, model, executionMode, session } = input;
  const permissionArgs =
    executionMode === "ask" ? ["--permission-mode", "plan"] : ["--dangerously-skip-permissions"];
  const sessionArgs =
    session === undefined
      ? []
      : session.mode === "start"
        ? ["--session-id", session.sessionId]
        : ["--resume", session.sessionId];

  return {
    spawnArgs: [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--model",
      model,
      ...permissionArgs,
      ...sessionArgs,
    ],
    logArgs: [
      "-p",
      "<redacted>",
      "--output-format",
      "json",
      "--model",
      model,
      ...permissionArgs,
      ...sessionArgs,
    ],
  };
}

function truncate(s: string, max = 200): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

type ISpawnFailurePayload = {
  requestId: string | undefined;
  agentId: string | undefined;
  categoryId: string | undefined;
  itemId: string | undefined;
  workspace: string;
  model: string;
  cmd: string;
  args: string[];
};

type IExecutionRefs = {
  resolved: boolean;
  hardTimeoutId: ReturnType<typeof setTimeout> | null;
  idleWatchdogId: ReturnType<typeof setTimeout> | null;
  killGraceId: ReturnType<typeof setTimeout> | null;
};

type IExecutionCtx = {
  proc: ChildProcess;
  resolve: (r: IRawAgentCliRunResult | IAgentCliResult) => void;
  refs: IExecutionRefs;
  streams: { rawStdout: string; rawStderr: string };
  startTime: number;
  lastActivityAt: number;
  forceReason: IRawAgentCliRunReason | null;
  requestId: string | undefined;
  requestContext: IAgentRunnerRequestContext | undefined;
  workspace: string;
  model: string;
  timeoutMs: number;
  watchdogIdleMs: number;
  killGraceMs: number;
  getAbortResult: () => IAgentCliResult;
};

function resolveCtx(ctx: IExecutionCtx, result: IRawAgentCliRunResult | IAgentCliResult): void {
  if (ctx.refs.resolved) return;
  ctx.refs.resolved = true;
  if (ctx.refs.hardTimeoutId) clearTimeout(ctx.refs.hardTimeoutId);
  if (ctx.refs.idleWatchdogId) clearTimeout(ctx.refs.idleWatchdogId);
  if (ctx.refs.killGraceId) clearTimeout(ctx.refs.killGraceId);
  ctx.proc.removeAllListeners();
  ctx.resolve(result);
}

function refreshIdleWatchdog(ctx: IExecutionCtx): void {
  ctx.lastActivityAt = Date.now();
  if (ctx.refs.idleWatchdogId) clearTimeout(ctx.refs.idleWatchdogId);
  ctx.refs.idleWatchdogId = setTimeout(() => onIdleTimeout(ctx), ctx.watchdogIdleMs);
}

function onIdleTimeout(ctx: IExecutionCtx): void {
  if (ctx.refs.resolved) return;
  ctx.forceReason = "idle_timeout";
  const log = getRuntimeLogger();
  const runtimeMs = Date.now() - ctx.startTime;
  const idleMs = Date.now() - ctx.lastActivityAt;
  log.info({
    event: AGENT_TIMEOUT_IDLE,
    requestId: ctx.requestId,
    agentId: ctx.requestContext?.agentId,
    categoryId: ctx.requestContext?.categoryId,
    itemId: ctx.requestContext?.itemId,
    pid: ctx.proc.pid,
    runtimeMs,
    idleMs,
    reason: "idle_timeout",
    timeoutMs: ctx.timeoutMs,
    watchdogIdleMs: ctx.watchdogIdleMs,
    killGraceMs: ctx.killGraceMs,
    stdoutPreview: truncate(ctx.streams.rawStdout),
    stderrPreview: truncate(ctx.streams.rawStderr),
  });
  ctx.proc.kill("SIGTERM");
  ctx.refs.killGraceId = setTimeout(() => {
    if (!ctx.refs.resolved) {
      ctx.proc.kill("SIGKILL");
      resolveCtx(ctx, {
        rawStdout: ctx.streams.rawStdout,
        rawStderr: ctx.streams.rawStderr,
        code: null,
        signal: null,
        reason: "idle_timeout",
        runtimeMs,
        idleMs,
      });
    }
  }, ctx.killGraceMs);
}

function onHardTimeout(ctx: IExecutionCtx): void {
  if (ctx.refs.resolved) return;
  ctx.forceReason = "timeout";
  const log = getRuntimeLogger();
  const runtimeMs = Date.now() - ctx.startTime;
  log.info({
    event: AGENT_TIMEOUT_HARD,
    requestId: ctx.requestId,
    agentId: ctx.requestContext?.agentId,
    categoryId: ctx.requestContext?.categoryId,
    itemId: ctx.requestContext?.itemId,
    pid: ctx.proc.pid,
    runtimeMs,
    reason: "timeout",
    timeoutMs: ctx.timeoutMs,
    watchdogIdleMs: ctx.watchdogIdleMs,
    killGraceMs: ctx.killGraceMs,
    stdoutPreview: truncate(ctx.streams.rawStdout),
    stderrPreview: truncate(ctx.streams.rawStderr),
  });
  ctx.proc.kill("SIGTERM");
  ctx.refs.killGraceId = setTimeout(() => {
    if (!ctx.refs.resolved) {
      ctx.proc.kill("SIGKILL");
      resolveCtx(ctx, {
        rawStdout: ctx.streams.rawStdout,
        rawStderr: ctx.streams.rawStderr,
        code: null,
        signal: null,
        reason: "timeout",
        runtimeMs,
      });
    }
  }, ctx.killGraceMs);
}

function onClose(code: number | null, signal: NodeJS.Signals | null, ctx: IExecutionCtx): void {
  if (ctx.refs.resolved) return;
  const runtimeMs = Date.now() - ctx.startTime;
  const reason: IRawAgentCliRunReason = ctx.forceReason ?? (signal ? "killed" : "exit");

  if (reason === "killed" || ctx.forceReason) {
    const log = getRuntimeLogger();
    log.info({
      event: AGENT_TERMINATED,
      requestId: ctx.requestId,
      agentId: ctx.requestContext?.agentId,
      categoryId: ctx.requestContext?.categoryId,
      itemId: ctx.requestContext?.itemId,
      pid: ctx.proc.pid,
      code,
      signal,
      reason,
      runtimeMs,
      timeoutMs: ctx.timeoutMs,
      watchdogIdleMs: ctx.watchdogIdleMs,
      killGraceMs: ctx.killGraceMs,
      stdoutPreview: truncate(ctx.streams.rawStdout),
      stderrPreview: truncate(ctx.streams.rawStderr),
    });
  }

  resolveCtx(ctx, {
    rawStdout: ctx.streams.rawStdout,
    rawStderr: ctx.streams.rawStderr,
    code,
    signal,
    reason,
    runtimeMs,
  });
}

export type IExecuteClaudeCodeCliProcessInput = {
  prompt: string;
  model: string;
  workspace: string;
  config: IAgentProcessConfig;
  executionMode: IAgentExecutionMode;
  session: IClaudeCodeCliSession | undefined;
  agentTmpDir?: string;
  requestId?: string;
  requestContext?: IAgentRunnerRequestContext;
  onAbortReady: (abort: () => void) => void;
  getAbortResult: () => IAgentCliResult;
};

export function executeClaudeCodeCliProcess(
  input: IExecuteClaudeCodeCliProcessInput
): Promise<IRawAgentCliRunResult | IAgentCliResult> {
  const {
    prompt,
    model,
    workspace,
    config,
    executionMode,
    session,
    agentTmpDir,
    requestId,
    requestContext,
    onAbortReady,
    getAbortResult,
  } = input;
  const { timeoutMs, watchdogIdleMs, killGraceMs } = config;
  const { spawnArgs, logArgs } = buildClaudeCodeCliArgs({
    prompt,
    model,
    executionMode,
    session,
  });
  const spawnPayload: ISpawnFailurePayload = {
    requestId,
    agentId: requestContext?.agentId,
    categoryId: requestContext?.categoryId,
    itemId: requestContext?.itemId,
    workspace,
    model,
    cmd: CLAUDE_CODE_CLI_CMD,
    args: logArgs,
  };

  return new Promise((resolve) => {
    const startTime = Date.now();
    const refs: IExecutionRefs = {
      resolved: false,
      hardTimeoutId: null,
      idleWatchdogId: null,
      killGraceId: null,
    };
    const streams = { rawStdout: "", rawStderr: "" };
    let proc: ChildProcess;

    try {
      const spawnEnv = agentTmpDir ? { ...process.env, CTO_AGENT_TMP_DIR: agentTmpDir } : undefined;
      proc = nodeSpawn(CLAUDE_CODE_CLI_CMD, spawnArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        cwd: workspace,
        env: spawnEnv,
      });
    } catch (error) {
      const extra: ILogErrorExtra = {
        event: AGENT_FAILED_SPAWN,
        component: "core",
        operation: "spawn",
        ...spawnPayload,
      };
      if (isErrnoException(error)) {
        extra.code = error.code;
        extra.errno = error.errno;
        extra.syscall = error.syscall;
        extra.path = error.path;
      }
      logError(error, extra);
      resolve({
        rawStdout: "",
        rawStderr: "",
        code: null,
        signal: null,
        reason: "spawn_error",
      });
      return;
    }

    const ctx: IExecutionCtx = {
      proc,
      resolve,
      refs,
      streams,
      startTime,
      lastActivityAt: startTime,
      forceReason: null,
      requestId,
      requestContext,
      workspace,
      model,
      timeoutMs,
      watchdogIdleMs,
      killGraceMs,
      getAbortResult,
    };

    onAbortReady(() => {
      if (ctx.refs.resolved) return;
      try {
        proc.kill("SIGTERM");
      } catch {
        // Process may already be dead.
      }
      resolveCtx(ctx, getAbortResult());
    });

    refs.hardTimeoutId = setTimeout(() => onHardTimeout(ctx), timeoutMs);
    refs.idleWatchdogId = setTimeout(() => onIdleTimeout(ctx), watchdogIdleMs);

    proc.stdout?.on("data", (d) => {
      streams.rawStdout += d.toString();
      refreshIdleWatchdog(ctx);
    });
    proc.stderr?.on("data", (d) => {
      streams.rawStderr += d.toString();
      refreshIdleWatchdog(ctx);
    });

    proc.on("error", (err) => {
      if (refs.resolved) return;
      const extra: ILogErrorExtra = {
        event: AGENT_FAILED_SPAWN,
        component: "core",
        operation: "spawn",
        ...spawnPayload,
      };
      if (isErrnoException(err)) {
        extra.code = err.code;
        extra.errno = err.errno;
        extra.syscall = err.syscall;
        extra.path = err.path;
      }
      logError(err, extra);
      resolveCtx(ctx, {
        rawStdout: streams.rawStdout,
        rawStderr: streams.rawStderr,
        code: null,
        signal: null,
        reason: "spawn_error",
      });
    });

    proc.on("close", (code, signal) => onClose(code, signal, ctx));
  });
}
