/**
 * Runtime startup contract: project root must be provided by the launcher (menubar or script)
 * via argv (--project-root) or env (CTO_TARGET_PROJECT_ROOT). No default; fail fast if missing.
 */
import { statSync } from "fs";
import { resolve } from "path";
import { AppError, isAppError } from "./app-error.js";
import {
  ERR_PROJECT_ROOT_INVALID,
  ERR_PROJECT_ROOT_NOT_DIR,
  ERR_PROJECT_ROOT_REQUIRED,
} from "./error-codes.js";

const PROJECT_ROOT_ARG = "--project-root";

function findProjectRootArg(): string | undefined {
  const argv = process.argv;
  const i = argv.indexOf(PROJECT_ROOT_ARG);
  if (i === -1 || i === argv.length - 1) return undefined;
  const value = argv[i + 1]?.trim();
  return value && !value.startsWith("-") ? value : undefined;
}

/**
 * Returns canonical project root. Throws if missing or invalid (not a directory).
 * Prefer --project-root over CTO_TARGET_PROJECT_ROOT.
 */
export function getProjectRootFromStartupInput(env: { CTO_TARGET_PROJECT_ROOT?: string }): string {
  const fromArg = findProjectRootArg();
  const fromEnv = env.CTO_TARGET_PROJECT_ROOT?.trim();
  const raw = fromArg ?? fromEnv;
  if (!raw) {
    throw new AppError(
      "Project root required. Pass --project-root <path> or set CTO_TARGET_PROJECT_ROOT (launcher must provide this).",
      ERR_PROJECT_ROOT_REQUIRED,
      {}
    );
  }
  const projectRoot = resolve(raw);
  try {
    const stat = statSync(projectRoot);
    if (!stat.isDirectory()) {
      throw new AppError(
        `Project root is not a directory: ${projectRoot}`,
        ERR_PROJECT_ROOT_NOT_DIR,
        { projectRoot }
      );
    }
  } catch (e) {
    if (isAppError(e)) throw e;
    throw new AppError(
      `Project root path invalid or not accessible: ${projectRoot}`,
      ERR_PROJECT_ROOT_INVALID,
      { projectRoot },
      { cause: e }
    );
  }
  return projectRoot;
}
