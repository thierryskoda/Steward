import { writeFileSync, readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { ensureProjectDir, getProjectDir } from "./project-key.js";
import { RESTRICTIVE_FILE_MODE } from "./app-data-permissions.js";

const PID_FILENAME = "pid";

function pidFile(projectRoot: string): string {
  return join(getProjectDir(projectRoot), PID_FILENAME);
}

/**
 * Acquire pid lock for the given project. Returns false if another runtime holds the lock.
 */
export function acquirePidLock(projectRoot: string): boolean {
  const file = pidFile(projectRoot);
  ensureProjectDir(projectRoot);
  if (existsSync(file)) {
    try {
      const pid = parseInt(readFileSync(file, "utf-8"), 10);
      if (pid && process.kill(pid, 0)) return false;
    } catch {
      // stale pid
    }
    unlinkSync(file);
  }
  writeFileSync(file, String(process.pid), {
    encoding: "utf-8",
    mode: RESTRICTIVE_FILE_MODE,
  });
  return true;
}

export function releasePidLock(projectRoot: string): void {
  const file = pidFile(projectRoot);
  if (!existsSync(file)) return;
  try {
    const pid = parseInt(readFileSync(file, "utf-8"), 10);
    if (pid === process.pid) unlinkSync(file);
  } catch {
    unlinkSync(file);
  }
}
