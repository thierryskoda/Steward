/**
 * Single-process agent queue: bounded concurrency, FIFO, spawn CLI subprocess, hard and idle
 * timeouts, shutdown drain. Centralizes agent process lifecycle so all callers get consistent
 * timeout, queue age-cap, and shutdown behavior. Delegates spawn/timeouts to process runner
 * and stdout parsing to envelope parser.
 */

import { randomUUID } from "crypto";
import { STATUS } from "@steward/contracts/schemas";
import { AppError } from "../app-error.js";
import { AGENT_CLI_JSON_PARSE_FAILED, AGENT_PROMPT_TOO_LARGE } from "../runtime-log-events.js";
import { ERR_AGENT_FAILED } from "../error-codes.js";
import {
  AGENT_QUEUE_AGE_CAP_REJECTED,
  AGENT_QUEUE_ENCLAIMED,
  AGENT_QUEUE_FINISHED,
  AGENT_QUEUE_HEALTH_ALERT,
  AGENT_QUEUE_STARTED,
  AGENT_QUEUE_WARN_WAIT,
  AGENT_QUEUE_SHUTDOWN_CANCELLED,
  AGENT_QUEUE_SHUTDOWN_COMPLETED,
  AGENT_QUEUE_SHUTDOWN_ENQUEUE_REJECTED,
} from "../runtime-log-events.js";
import { ensureAgentRunTmpDir, getAgentRunTmpDir, removeAgentRunTmpDir } from "../agent-tmp-dir.js";
import { loadEnv } from "../env.js";
import { getRuntimeLogger, logError } from "../logger.js";
import { buildResultFromRawRun, parseAgentCliExitToResult } from "./agent-cli-envelope-parser.js";
import {
  buildAgentCliArgs,
  executeAgentCliProcess as runProcess,
} from "./agent-cli-process-runner.js";
import {
  buildClaudeCodeCliArgs,
  executeClaudeCodeCliProcess,
  type IClaudeCodeCliSession,
} from "./claude-code-cli-process-runner.js";
import { buildCodexCliArgs, executeCodexCliProcess } from "./codex-cli-process-runner.js";
import type {
  IAgentCliResult,
  IAgentProcessConfig,
  IRawAgentCliRunResult,
} from "./agent-cli-result.types.js";
import { parseClaudeCodeCliJsonToAgentResult } from "./claude-code-cli-json-parser.js";
import { parseCodexCliJsonlToAgentResult } from "./codex-cli-jsonl-parser.js";

export type {
  IAgentCliResult,
  IAgentProcessConfig,
  IAgentTerminationReason,
} from "./agent-cli-result.types.js";

const MAX_PROMPT_CHARS = 500_000;

/** Max chars of stderr to include in logs when CLI fails (parse or non-zero exit). */
const LOG_STDERR_MAX = 2048;

function truncate(s: string, max = 200): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

export type IAgentQueueLifecycleCallbacks = {
  onQueued?: () => void;
  onStarted?: () => void;
  onFinished?: () => void;
};

export type IAgentRequestContext = {
  agentId?: string;
  categoryId?: string;
  itemId?: string;
};

type IAgentExecutionMode = "ask" | "force";
type IQueuedAgentProvider = "cursor_agent" | "codex_cli" | "claude_code_cli";

type IAgentProcessArgs = {
  prompt: string;
  model: string;
  workspace: string;
  config: IAgentProcessConfig;
  resumeChatId: string | undefined;
  executionMode: IAgentExecutionMode;
  provider?: IQueuedAgentProvider;
  claudeCodeSession?: IClaudeCodeCliSession;
  lifecycleCallbacks?: IAgentQueueLifecycleCallbacks;
  requestContext?: IAgentRequestContext;
  requestId?: string;
  agentTmpDir?: string;
};

const QUEUE_DEPTH_WARN_THRESHOLD = 25;
export const SHUTDOWN_QUEUE_TIMEOUT_MS = 30_000;

type QueueState = "running" | "draining" | "cancelling" | "stopped";
let queueState: QueueState = "running";
let inFlightCount = 0;
const activeAbortRefs = new Map<string, { abort: () => void }>();
const QUEUE_P95_WARN_MS = 60_000;
const QUEUE_P99_WARN_MS = 120_000;
const WAIT_MS_SAMPLE_SIZE = 100;

const waitMsSamples: number[] = [];

function recordWaitMsAndEmitAlerts(waitMs: number): void {
  waitMsSamples.push(waitMs);
  if (waitMsSamples.length > WAIT_MS_SAMPLE_SIZE) waitMsSamples.shift();
  const log = getRuntimeLogger();
  if (waitMsSamples.length >= 10) {
    const sorted = [...waitMsSamples].sort((a, b) => a - b);
    const p95Idx = Math.floor(0.95 * sorted.length) - 1;
    const p99Idx = Math.floor(0.99 * sorted.length) - 1;
    const p95 = sorted[Math.max(0, p95Idx)] ?? 0;
    const p99 = sorted[Math.max(0, p99Idx)] ?? 0;
    if (p95 > QUEUE_P95_WARN_MS || p99 > QUEUE_P99_WARN_MS) {
      log.info({
        event: AGENT_QUEUE_HEALTH_ALERT,
        reason: "percentile",
        p95,
        p99,
        p95Threshold: QUEUE_P95_WARN_MS,
        p99Threshold: QUEUE_P99_WARN_MS,
        sampleCount: waitMsSamples.length,
      });
    }
  }
}

type IQueueItem = {
  requestId: string;
  args: IAgentProcessArgs;
  enclaimedAt: number;
  resolve: (r: IAgentCliResult) => void;
  reject: (e: unknown) => void;
};

const queue: IQueueItem[] = [];

const CANCELLED_RESULT: IAgentCliResult = {
  stdout: "",
  stderr: "Shutdown cancelled",
  rawStdout: "",
  rawStderr: "Shutdown cancelled",
  code: null,
  reason: "shutdown_cancelled",
};

function logParseFailure(args: {
  requestId: string | undefined;
  requestContext: IAgentRequestContext | undefined;
  resumeChatId: string | undefined;
  code: number | null;
  signal: NodeJS.Signals | null;
  workspace: string;
  model: string;
  rawStdout: string;
  rawStderr: string;
  logArgs: string[];
  cmd: string;
  parseMessage: string;
}): void {
  const log = getRuntimeLogger();
  const {
    requestId,
    requestContext,
    resumeChatId,
    code,
    signal,
    workspace,
    model,
    rawStdout,
    rawStderr,
    logArgs,
    cmd,
    parseMessage,
  } = args;
  const rawStdoutLen = rawStdout.length;
  const rawStderrLen = rawStderr.length;
  const stderrForLog =
    rawStderrLen > 0
      ? rawStderr.length <= LOG_STDERR_MAX
        ? rawStderr
        : rawStderr.slice(0, LOG_STDERR_MAX) + "\n... (truncated)"
      : "";
  log.info({
    event: AGENT_CLI_JSON_PARSE_FAILED,
    requestId,
    agentId: requestContext?.agentId,
    categoryId: requestContext?.categoryId,
    itemId: requestContext?.itemId,
    chatId: resumeChatId,
    code,
    signal,
    cmd,
    args: logArgs,
    workspace,
    model,
    rawStdoutLength: rawStdoutLen,
    rawStderrLength: rawStderrLen,
    stderrPreview: truncate(rawStderr),
    parseMessage,
    ...(rawStderrLen > 0 ? { stderrFull: stderrForLog } : {}),
    ...(rawStdoutLen > 0 && rawStdoutLen <= 1000
      ? { stdoutPreview: rawStdout }
      : rawStdoutLen > 1000
        ? { stdoutPreview: truncate(rawStdout, 1000) }
        : {}),
  });
}

/** Runs one agent request via runner then parser; returns IAgentCliResult. */
async function executeAgentCliProcess(
  args: IAgentProcessArgs,
  onAbortReady: (abort: () => void) => void,
  requestId: string
): Promise<IAgentCliResult> {
  const provider = args.provider ?? "cursor_agent";
  let rawOrCancelled: IRawAgentCliRunResult | IAgentCliResult;
  if (provider === "codex_cli") {
    rawOrCancelled = await executeCodexCliProcess({
      prompt: args.prompt,
      model: args.model,
      workspace: args.workspace,
      config: args.config,
      resumeSessionId: args.resumeChatId,
      executionMode: args.executionMode,
      agentTmpDir: args.agentTmpDir,
      requestId,
      requestContext: args.requestContext,
      onAbortReady,
      getAbortResult: () => CANCELLED_RESULT,
    });
  } else if (provider === "claude_code_cli") {
    rawOrCancelled = await executeClaudeCodeCliProcess({
      prompt: args.prompt,
      model: args.model,
      workspace: args.workspace,
      config: args.config,
      executionMode: args.executionMode,
      session: args.claudeCodeSession,
      agentTmpDir: args.agentTmpDir,
      requestId,
      requestContext: args.requestContext,
      onAbortReady,
      getAbortResult: () => CANCELLED_RESULT,
    });
  } else {
    rawOrCancelled = await runProcess({
      prompt: args.prompt,
      model: args.model,
      workspace: args.workspace,
      config: args.config,
      resumeChatId: args.resumeChatId,
      executionMode: args.executionMode,
      agentTmpDir: args.agentTmpDir,
      requestId,
      requestContext: args.requestContext,
      onAbortReady,
      getAbortResult: () => CANCELLED_RESULT,
    });
  }

  if (rawOrCancelled.reason === "shutdown_cancelled") {
    return rawOrCancelled as IAgentCliResult;
  }

  const raw = rawOrCancelled as IRawAgentCliRunResult;

  if (raw.reason === "exit") {
    let result: IAgentCliResult;
    if (provider === "codex_cli") {
      result = parseCodexCliJsonlToAgentResult({
        rawStdout: raw.rawStdout,
        rawStderr: raw.rawStderr,
        code: raw.code,
        runtimeMs: raw.runtimeMs ?? 0,
      });
    } else if (provider === "claude_code_cli") {
      result = parseClaudeCodeCliJsonToAgentResult({
        rawStdout: raw.rawStdout,
        rawStderr: raw.rawStderr,
        code: raw.code,
        runtimeMs: raw.runtimeMs ?? 0,
      });
    } else {
      result = parseAgentCliExitToResult({
        rawStdout: raw.rawStdout,
        rawStderr: raw.rawStderr,
        code: raw.code,
        runtimeMs: raw.runtimeMs ?? 0,
      });
    }
    if (
      provider === "cursor_agent" &&
      result.reason === "exit" &&
      result.code === 0 &&
      result.stdout.length === 0
    ) {
      const log = getRuntimeLogger();
      log.info({
        event:
          "Agent exited 0 with empty stdout; treating as no findings (Cursor CLI may not emit envelope in this case).",
        requestId,
        agentId: args.requestContext?.agentId,
        categoryId: args.requestContext?.categoryId,
        chatId: args.resumeChatId,
      });
    }
    if (result.reason === "invalid_cli_json") {
      let logArgs: string[];
      let cmd: string;
      if (provider === "codex_cli") {
        logArgs = buildCodexCliArgs({
          prompt: args.prompt,
          model: args.model,
          workspace: args.workspace,
          executionMode: args.executionMode,
          resumeSessionId: args.resumeChatId,
        }).logArgs;
        cmd = "codex";
      } else if (provider === "claude_code_cli") {
        logArgs = buildClaudeCodeCliArgs({
          prompt: args.prompt,
          model: args.model,
          executionMode: args.executionMode,
          session: args.claudeCodeSession,
        }).logArgs;
        cmd = "claude";
      } else {
        logArgs = buildAgentCliArgs({
          prompt: args.prompt,
          model: args.model,
          workspace: args.workspace,
          executionMode: args.executionMode,
          resumeChatId: args.resumeChatId,
        }).logArgs;
        cmd = "agent";
      }
      const parseMessage = result.stderr.startsWith("Agent CLI JSON parse failed: ")
        ? (result.stderr.slice("Agent CLI JSON parse failed: ".length).split("\n")[0]?.trim() ??
          "invalid_cli_json")
        : (result.stderr.split("\n")[0] ?? "invalid_cli_json");
      logParseFailure({
        requestId,
        requestContext: args.requestContext,
        resumeChatId: args.resumeChatId,
        code: raw.code,
        signal: raw.signal,
        workspace: args.workspace,
        model: args.model,
        rawStdout: raw.rawStdout,
        rawStderr: raw.rawStderr,
        logArgs,
        cmd,
        parseMessage,
      });
    }
    return result;
  }

  return buildResultFromRawRun(raw);
}

/** Drain one item when under concurrency cap and queue non-empty; reject items that exceeded max queue age. */
function scheduleFill(): void {
  if (queueState === "cancelling") return;
  let maxConcurrency: number;
  try {
    maxConcurrency = loadEnv().CTO_AGENT_MAX_CONCURRENCY;
  } catch {
    maxConcurrency = 3;
  }
  if (inFlightCount >= maxConcurrency || queue.length === 0) return;

  const item = queue.shift();
  if (!item) return;

  const { requestId, args, enclaimedAt, resolve, reject } = item;
  const log = getRuntimeLogger();
  const queueDepthBefore = queue.length + 1;
  const waitMs = Date.now() - enclaimedAt;
  const env = loadEnv();
  const maxAgeMs = env.CTO_AGENT_MAX_QUEUE_AGE_MS;

  if (queueDepthBefore > QUEUE_DEPTH_WARN_THRESHOLD) {
    log.info({
      event: AGENT_QUEUE_HEALTH_ALERT,
      reason: "depth",
      queueDepth: queueDepthBefore,
      threshold: QUEUE_DEPTH_WARN_THRESHOLD,
    });
  }

  if (waitMs > maxAgeMs) {
    log.info({
      event: AGENT_QUEUE_AGE_CAP_REJECTED,
      requestId,
      workspace: args.workspace,
      model: args.model,
      waitMs,
      maxAgeMs,
    });
    reject(new Error(`Queue age ${waitMs}ms exceeds maximum ${maxAgeMs}ms; request rejected.`));
    scheduleFill();
    return;
  }

  if (waitMs >= env.CTO_AGENT_QUEUE_WARN_WAIT_MS) {
    log.info({
      event: AGENT_QUEUE_WARN_WAIT,
      requestId,
      workspace: args.workspace,
      model: args.model,
      waitMs,
      queueDepthBefore,
    });
  }

  inFlightCount++;
  log.info({
    event: AGENT_QUEUE_STARTED,
    requestId,
    workspace: args.workspace,
    model: args.model,
    waitMs,
    inFlightCount,
    queueDepthBefore,
  });
  args.lifecycleCallbacks?.onStarted?.();
  const startTime = Date.now();

  if (args.agentTmpDir) {
    ensureAgentRunTmpDir(args.workspace, requestId);
  }
  void (async () => {
    try {
      const result = await executeAgentCliProcess(
        args,
        (abort) => {
          activeAbortRefs.set(requestId, { abort });
        },
        requestId
      );
      const runtimeMs = Date.now() - startTime;
      log.info({
        event: AGENT_QUEUE_FINISHED,
        requestId,
        workspace: args.workspace,
        model: args.model,
        runtimeMs,
        waitMs,
        reason: result.reason,
        code: result.code,
        cliType: result.cli?.type,
        cliSubtype: result.cli?.subtype,
        cliIsError: result.cli?.isError,
        cliSessionId: result.cli?.sessionId,
        cliRequestId: result.cli?.requestId,
        inFlightCount: inFlightCount - 1,
        queueDepthAfter: queue.length,
      });
      recordWaitMsAndEmitAlerts(waitMs);
      args.lifecycleCallbacks?.onFinished?.();
      if (result.reason === "shutdown_cancelled") {
        logShutdownTerminal("cancelled", item);
      } else if (queueState === "draining") {
        logShutdownTerminal("completed", item);
      }
      resolve(result);
    } catch (error) {
      const runtimeMs = Date.now() - startTime;
      logError(error, {
        event: AGENT_QUEUE_FINISHED,
        component: "core",
        operation: "agentQueueRun",
        requestId,
        workspace: args.workspace,
        model: args.model,
        runtimeMs,
        waitMs,
        reason: "error",
        code: null,
        inFlightCount: inFlightCount - 1,
        queueDepthAfter: queue.length,
      });
      recordWaitMsAndEmitAlerts(waitMs);
      args.lifecycleCallbacks?.onFinished?.();
      if (queueState === "draining") {
        logShutdownTerminal("completed", item);
      }
      reject(error);
    } finally {
      if (args.agentTmpDir) {
        removeAgentRunTmpDir(args.agentTmpDir);
      }
      activeAbortRefs.delete(requestId);
      inFlightCount--;
      scheduleFill();
    }
  })();
}

function logShutdownTerminal(outcome: "completed" | "cancelled", item: IQueueItem): void {
  const log = getRuntimeLogger();
  const ctx = item.args.requestContext;
  const payload = {
    requestId: item.requestId,
    agentId: ctx?.agentId,
    categoryId: ctx?.categoryId,
    itemId: ctx?.itemId,
    phase: outcome === "cancelled" ? STATUS.CLAIMED : "running",
    mode: outcome === "completed" ? "drain" : "cancel",
  };
  if (outcome === "completed") {
    log.info({ event: AGENT_QUEUE_SHUTDOWN_COMPLETED, ...payload });
  } else {
    log.info({ event: AGENT_QUEUE_SHUTDOWN_CANCELLED, ...payload });
  }
}

export function runAgentCliProcess(args: IAgentProcessArgs): Promise<IAgentCliResult> {
  const log = getRuntimeLogger();
  if (queueState !== "running") {
    const ctx = args.requestContext;
    log.info({
      event: AGENT_QUEUE_SHUTDOWN_ENQUEUE_REJECTED,
      requestId: "(rejected before enqueue)",
      agentId: ctx?.agentId,
      categoryId: ctx?.categoryId,
      itemId: ctx?.itemId,
    });
    return Promise.reject(new Error("Agent queue is shutting down; new requests are rejected."));
  }
  if (args.prompt.length > MAX_PROMPT_CHARS) {
    log.info({
      event: AGENT_PROMPT_TOO_LARGE,
      promptChars: args.prompt.length,
      maxChars: MAX_PROMPT_CHARS,
      workspace: args.workspace,
      model: args.model,
    });
    throw new AppError(
      `Agent prompt too large (max ${MAX_PROMPT_CHARS}). Aborting to avoid spawn E2BIG.`,
      ERR_AGENT_FAILED,
      {
        promptChars: args.prompt.length,
        maxChars: MAX_PROMPT_CHARS,
        workspace: args.workspace,
        model: args.model,
      }
    );
  }
  const requestId = args.requestId ?? randomUUID();
  const enclaimedAt = Date.now();
  return new Promise<IAgentCliResult>((resolve, reject) => {
    queue.push({
      requestId,
      args,
      enclaimedAt,
      resolve,
      reject,
    });
    args.lifecycleCallbacks?.onQueued?.();
    log.info({
      event: AGENT_QUEUE_ENCLAIMED,
      requestId,
      workspace: args.workspace,
      model: args.model,
      queueLength: queue.length,
    });
    void scheduleFill();
  });
}

export function runAgentCliProcessWithEnv(args: {
  prompt: string;
  model: string;
  workspace: string;
  resumeChatId: string | undefined;
  executionMode: "ask" | "force";
  lifecycleCallbacks?: IAgentQueueLifecycleCallbacks;
  requestContext?: IAgentRequestContext;
  agentTmpDir?: string;
  requestId?: string;
}): Promise<IAgentCliResult> {
  const env = loadEnv();
  const requestId = args.requestId ?? randomUUID();
  const agentTmpDir =
    args.agentTmpDir !== undefined
      ? args.agentTmpDir
      : getAgentRunTmpDir(args.workspace, requestId);
  return runAgentCliProcess({
    ...args,
    prompt: args.prompt,
    requestId,
    agentTmpDir,
    config: {
      timeoutMs: env.AGENT_TIMEOUT_MS,
      watchdogIdleMs: env.AGENT_WATCHDOG_IDLE_MS,
      killGraceMs: env.AGENT_KILL_GRACE_MS,
    },
  });
}

export function runCodexCliProcessWithEnv(args: {
  prompt: string;
  model: string;
  workspace: string;
  resumeSessionId: string | undefined;
  executionMode: "ask" | "force";
  lifecycleCallbacks?: IAgentQueueLifecycleCallbacks;
  requestContext?: IAgentRequestContext;
  agentTmpDir?: string;
  requestId?: string;
}): Promise<IAgentCliResult> {
  const env = loadEnv();
  const requestId = args.requestId ?? randomUUID();
  const agentTmpDir =
    args.agentTmpDir !== undefined
      ? args.agentTmpDir
      : getAgentRunTmpDir(args.workspace, requestId);
  return runAgentCliProcess({
    prompt: args.prompt,
    model: args.model,
    workspace: args.workspace,
    resumeChatId: args.resumeSessionId,
    executionMode: args.executionMode,
    lifecycleCallbacks: args.lifecycleCallbacks,
    requestContext: args.requestContext,
    requestId,
    agentTmpDir,
    provider: "codex_cli",
    config: {
      timeoutMs: env.AGENT_TIMEOUT_MS,
      watchdogIdleMs: env.AGENT_WATCHDOG_IDLE_MS,
      killGraceMs: env.AGENT_KILL_GRACE_MS,
    },
  });
}

export function runClaudeCodeCliProcessWithEnv(args: {
  prompt: string;
  model: string;
  workspace: string;
  session: IClaudeCodeCliSession | undefined;
  executionMode: "ask" | "force";
  lifecycleCallbacks?: IAgentQueueLifecycleCallbacks;
  requestContext?: IAgentRequestContext;
  agentTmpDir?: string;
  requestId?: string;
}): Promise<IAgentCliResult> {
  const env = loadEnv();
  const requestId = args.requestId ?? randomUUID();
  const agentTmpDir =
    args.agentTmpDir !== undefined
      ? args.agentTmpDir
      : getAgentRunTmpDir(args.workspace, requestId);
  return runAgentCliProcess({
    prompt: args.prompt,
    model: args.model,
    workspace: args.workspace,
    resumeChatId: args.session?.sessionId,
    executionMode: args.executionMode,
    lifecycleCallbacks: args.lifecycleCallbacks,
    requestContext: args.requestContext,
    requestId,
    agentTmpDir,
    provider: "claude_code_cli",
    claudeCodeSession: args.session,
    config: {
      timeoutMs: env.AGENT_TIMEOUT_MS,
      watchdogIdleMs: env.AGENT_WATCHDOG_IDLE_MS,
      killGraceMs: env.AGENT_KILL_GRACE_MS,
    },
  });
}

type IShutdownAgentQueueArgs = {
  timeoutMs: number;
};

export async function shutdownAgentQueue(args: IShutdownAgentQueueArgs): Promise<void> {
  if (queueState !== "running") return;
  queueState = "draining";
  const deadline = Date.now() + args.timeoutMs;
  while ((inFlightCount > 0 || queue.length > 0) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (inFlightCount > 0 || queue.length > 0) {
    queueState = "cancelling";
    for (const { abort } of activeAbortRefs.values()) {
      abort();
    }
    activeAbortRefs.clear();
    while (queue.length > 0) {
      const item = queue.shift();
      if (item) {
        logShutdownTerminal("cancelled", item);
        item.reject(new Error("Agent request cancelled during shutdown (timeout)."));
      }
    }
  }
  queueState = "stopped";
}

export function resumeAgentQueue(): void {
  queueState = "running";
}
