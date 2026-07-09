import { join } from "path";

/** Canonical .steward base path segment; single source of truth for all .steward path construction. */
export const STEWARD_BASE = ".steward";

export function stewardDir(projectRoot: string): string {
  return join(projectRoot, STEWARD_BASE);
}

export function stewardStateDbPath(projectRoot: string): string {
  return join(projectRoot, STEWARD_BASE, "state.db");
}

export function stewardTmpRunsDir(projectRoot: string): string {
  return join(projectRoot, STEWARD_BASE, "tmp", "runs");
}

export function cursorRulesDir(projectRoot: string): string {
  return join(projectRoot, ".cursor", "rules");
}
