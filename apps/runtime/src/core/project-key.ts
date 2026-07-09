/**
 * Stable project key and app-data directory for per-project runtime.
 * Same project root always yields the same key.
 */
import { mkdirSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { homedir } from "os";
import { RESTRICTIVE_DIR_MODE } from "./app-data-permissions.js";

const APP_DATA = join(homedir(), ".steward");
const PROJECTS_DIR = join(APP_DATA, "projects");

export function getProjectKey(projectRoot: string): string {
  const canonical = projectRoot.replace(/\\/g, "/").trim();
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}

export function getProjectDir(projectRoot: string): string {
  return join(PROJECTS_DIR, getProjectKey(projectRoot));
}

export function ensureProjectDir(projectRoot: string): string {
  const dir = getProjectDir(projectRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: RESTRICTIVE_DIR_MODE });
  return dir;
}

export function getAppDataRoot(): string {
  return APP_DATA;
}
