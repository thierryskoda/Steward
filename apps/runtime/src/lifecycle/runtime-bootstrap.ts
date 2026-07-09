/**
 * Runtime bootstrap: env, logger, project root, pid lock, initial state.
 * Called once at runtime startup from composition root.
 */
import { loadEnv } from "../core/env.js";
import { getProjectRootFromStartupInput } from "../core/startup-input.js";
import { getProjectRoot, setProjectRoot } from "../core/project-root.js";
import { acquirePidLock } from "../core/status-store.js";
import { updateRuntimeState } from "../core/state.js";
import { initRuntimeLogger, getRuntimeLogger } from "../core/logger.js";
import { ensureEnvVariables } from "../core/bootstrap.js";
import { writeRuntimeConfig } from "../core/runtime-config.js";
import { stewardDir } from "../core/paths.js";
import { RUNTIME_LOG_FILE, resolveLogsDir } from "../core/log-paths.js";
import {
  RUNTIME_LIFECYCLE_EXIT_PID_LOCK_HELD,
  RUNTIME_LIFECYCLE_PROJECT_ROOT_SET,
} from "../core/runtime-log-events.js";
import type { Env } from "../core/env.js";
import type { IDebugLog } from "../core/debug.js";

export type IRuntimeBootstrapResult = {
  env: Env;
  debugLog: IDebugLog;
  projectRoot: string;
  logsDir: string;
};

export function initializeRuntimeBootstrap(mainJsPath: string): IRuntimeBootstrapResult {
  const envConfig = loadEnv();
  const logsDir = resolveLogsDir({ logsRootOverride: envConfig.CTO_LOGS_ROOT });
  initRuntimeLogger(logsDir);
  const { env, debugLog } = ensureEnvVariables();
  const projectRoot = getProjectRootFromStartupInput(env);
  setProjectRoot(projectRoot);
  writeRuntimeConfig({
    projectRoot,
    nodePath: process.execPath,
    mainJs: mainJsPath,
  });
  getRuntimeLogger().info({
    event: RUNTIME_LIFECYCLE_PROJECT_ROOT_SET,
    pid: process.pid,
    projectRoot,
    monitoredStewardRoot: stewardDir(projectRoot),
    runtimeLogFile: RUNTIME_LOG_FILE,
    logsDir,
  });
  debugLog("H2", "lifecycle:initializeRuntimeBootstrap", "project/config initialized", {
    projectRoot,
  });
  return { env, debugLog, projectRoot, logsDir };
}

export function initializeStateOrExit(): void {
  const projectRoot = getProjectRoot();
  const log = getRuntimeLogger();
  if (!acquirePidLock(projectRoot)) {
    log.info({ event: RUNTIME_LIFECYCLE_EXIT_PID_LOCK_HELD, reason: "pid lock held" });
    process.exit(1);
  }
  const now = Date.now();
  updateRuntimeState({
    pid: process.pid,
    state: "starting",
    startedAt: now,
    lastHeartbeatAt: now,
    lastError: null,
    phase: "opening-db",
    phaseStartedAt: now,
  });
}
