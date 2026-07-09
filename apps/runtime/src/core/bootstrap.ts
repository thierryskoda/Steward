/**
 * Ensures env is loaded and validated, applies defaults, and returns env plus debugLog. No feature wiring; pure startup bootstrap.
 * Exists so the runtime has a single place for env readiness before composition. Use at runtime startup only; called from main before any stores or HTTP.
 */
import { getAppliedEnvDefaults, loadEnv } from "./env.js";
import type { Env } from "./env.js";
import { createDebugLog } from "./debug.js";
import { getRuntimeLogger } from "./logger.js";
import { RUNTIME_ENV_DEFAULTS_APPLIED, RUNTIME_LIFECYCLE_STARTED } from "./runtime-log-events.js";

export function ensureEnvVariables(): {
  env: Env;
  debugLog: ReturnType<typeof createDebugLog>;
} {
  const env = loadEnv();
  const log = getRuntimeLogger();
  log.info({
    event: RUNTIME_LIFECYCLE_STARTED,
    pid: process.pid,
    cwd: process.cwd(),
    ...(env.CTO_TARGET_PROJECT_ROOT && { targetProjectRoot: env.CTO_TARGET_PROJECT_ROOT }),
    cursorProjectsRoot: env.CTO_CURSOR_PROJECTS_ROOT,
    cursorPollMs: env.CURSOR_POLL_INTERVAL_MS,
  });
  const appliedDefaults = getAppliedEnvDefaults(process.env);
  if (appliedDefaults.length > 0) {
    log.info({
      event: RUNTIME_ENV_DEFAULTS_APPLIED,
      count: appliedDefaults.length,
      defaults: appliedDefaults.map((entry) => ({
        key: entry.key,
        defaultValue: entry.defaultValue,
      })),
    });
  }
  const debugLog = createDebugLog();
  debugLog("H1", "bootstrap:ensureEnvVariables", "runtime entry", {
    pollMs: env.CURSOR_POLL_INTERVAL_MS,
  });
  return { env, debugLog };
}
