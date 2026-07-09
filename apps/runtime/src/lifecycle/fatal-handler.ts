/**
 * Fatal error handler: unregister runtime, release pid lock, log to file, exit.
 * Called from composition root when runRuntime() rejects.
 */
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { loadEnv } from "../core/env.js";
import { getProjectRootFromStartupInput } from "../core/startup-input.js";
import { unregisterRuntime } from "../core/runtime-registry.js";
import { releasePidLock } from "../core/status-store.js";
import { logError } from "../core/logger.js";
import { normalizeErrorForLog } from "../core/error-log-context.js";
import { resolveLogsDir, RUNTIME_LOG_FILE } from "../core/log-paths.js";
import { RUNTIME_LIFECYCLE_FATAL } from "../core/runtime-log-events.js";

export function handleFatal(error: unknown): void {
  let logsDir: string;
  try {
    logsDir = resolveLogsDir({ logsRootOverride: loadEnv().CTO_LOGS_ROOT });
  } catch {
    logsDir = resolveLogsDir({ logsRootOverride: undefined });
  }
  logError(error, {
    event: RUNTIME_LIFECYCLE_FATAL,
    component: "runtime",
    operation: "runRuntime",
    phase: "fatal",
    logsDir,
  });
  try {
    const projectRoot = getProjectRootFromStartupInput(loadEnv());
    unregisterRuntime(projectRoot);
    releasePidLock(projectRoot);
  } catch {
    // startup input may be missing or invalid
  }
  try {
    mkdirSync(logsDir, { recursive: true });
    const normalized = normalizeErrorForLog(error);
    const payload = {
      event: RUNTIME_LIFECYCLE_FATAL,
      code: normalized.code,
      message: normalized.message,
      ...normalized.context,
      causeChain: normalized.causeChain,
    };
    appendFileSync(
      join(logsDir, RUNTIME_LOG_FILE),
      `[${new Date().toISOString()}] ${JSON.stringify(payload)}\n`,
      "utf-8"
    );
  } catch {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`RUNTIME_FATAL: ${msg}\n`);
  }
  process.exit(1);
}
