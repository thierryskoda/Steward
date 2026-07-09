/**
 * Run-scoped temporary directory for agent scratch files under .steward/tmp/runs/<requestId>.
 * Runtime creates the dir before spawn, passes path to agent via env and prompt, and removes
 * it when the run finishes. TTL cleanup removes orphan dirs (e.g. after crash).
 */

import { mkdirSync, rmSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  AGENT_TMP_DIR_CLEANUP_FAILED,
  AGENT_TMP_DIR_READDIR_FAILED,
  AGENT_TMP_DIR_TTL_CLEANED,
} from "./runtime-log-events.js";
import { getRuntimeLogger, logError } from "./logger.js";
import { stewardTmpRunsDir } from "./paths.js";
import { getProjectRoot } from "./project-root.js";

export function getAgentRunTmpDir(workspace: string, requestId: string): string {
  return join(stewardTmpRunsDir(workspace), requestId);
}

export function ensureAgentRunTmpDir(workspace: string, requestId: string): string {
  const dir = getAgentRunTmpDir(workspace, requestId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function removeAgentRunTmpDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    logError(err, {
      event: AGENT_TMP_DIR_CLEANUP_FAILED,
      component: "core",
      dir,
    });
  }
}

/** Remove run dirs under workspace/.steward/tmp/runs older than maxAgeMs. Call at startup or periodically. */
export function cleanupStaleAgentRunDirs(maxAgeMs: number): void {
  const runsDir = stewardTmpRunsDir(getProjectRoot());
  let entries: string[];
  try {
    entries = readdirSync(runsDir);
  } catch (err) {
    logError(err, {
      event: AGENT_TMP_DIR_READDIR_FAILED,
      component: "core",
      operation: "cleanupStaleAgentRunDirs",
      dir: runsDir,
    });
    return;
  }
  const now = Date.now();
  const log = getRuntimeLogger();
  for (const name of entries) {
    const path = join(runsDir, name);
    try {
      const stat = statSync(path);
      if (!stat.isDirectory()) continue;
      const ageMs = now - stat.mtimeMs;
      if (ageMs >= maxAgeMs) {
        rmSync(path, { recursive: true, force: true });
        log.info({
          event: AGENT_TMP_DIR_TTL_CLEANED,
          path,
          ageMs,
          maxAgeMs,
        });
      }
    } catch {
      // Skip unreadable or already-removed entry; no structured log (non-operational).
    }
  }
}
