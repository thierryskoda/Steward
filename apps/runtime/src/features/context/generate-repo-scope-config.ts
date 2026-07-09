import { existsSync, readFileSync, readdirSync } from "fs";
import { basename, join } from "path";
import { AppError } from "../../core/app-error.js";
import { ERR_REPO_SCOPE_GENERATION } from "../../core/error-codes.js";
import { runStructuredAgent } from "../../core/llm/run-structured.agent.js";
import {
  REPO_SCOPE_CONFIG_GENERATION_COMPLETED,
  REPO_SCOPE_CONFIG_GENERATION_FAILED,
  REPO_SCOPE_CONFIG_GENERATION_STARTED,
} from "../../core/runtime-log-events.js";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import { generateRepoExcludeAgent } from "./generate-repo-exclude.agent.js";

type IGenerateExcludeDeps = {
  runExcludeAgentFn?: (input: IGenerateExcludeAgentInput) => Promise<string[]>;
};

type IGenerateExcludeAgentInput = {
  projectRootName: string;
  topLevelDirectories: string[];
  topLevelFiles: string[];
  gitignoreContent: string;
};

export type IGeneratedExclude = {
  exclude: string[];
};

const REQUIRED_EXCLUDES_IF_PRESENT = [
  ".git",
  ".steward",
  "node_modules",
  "dist",
  ".next",
  "build",
  "out",
  "coverage",
  "ios",
  "android",
  ".expo",
  ".turbo",
  ".cache",
] as const;

function uniqueNormalized(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function getTopLevelSummary(projectRoot: string): {
  topLevelDirectories: string[];
  topLevelFiles: string[];
} {
  if (!existsSync(projectRoot)) {
    return { topLevelDirectories: [], topLevelFiles: [] };
  }
  const entries = readdirSync(projectRoot, { withFileTypes: true });
  const topLevelDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const topLevelFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  return { topLevelDirectories, topLevelFiles };
}

function getGitignoreContent(projectRoot: string): string {
  const gitignorePath = join(projectRoot, ".gitignore");
  if (!existsSync(gitignorePath)) {
    return "";
  }
  return readFileSync(gitignorePath, "utf-8");
}

function validateRequiredExcludes(args: {
  topLevelDirectories: string[];
  exclude: string[];
}): void {
  const { topLevelDirectories, exclude } = args;
  const topLevelSet = new Set(topLevelDirectories);
  const excludeSet = new Set(exclude);
  const missing = REQUIRED_EXCLUDES_IF_PRESENT.filter(
    (requiredName) => topLevelSet.has(requiredName) && !excludeSet.has(requiredName)
  );
  if (missing.length > 0) {
    throw new AppError(
      `Generated exclude missing required entries for existing directories: ${missing.join(", ")}`,
      ERR_REPO_SCOPE_GENERATION,
      { missing }
    );
  }
}

/** Generate exclude list only; writes to the DB-backed exclude snapshot are done by caller. */
export async function generateExclude(args: {
  projectRoot: string;
  deps: IGenerateExcludeDeps | undefined;
}): Promise<IGeneratedExclude> {
  const { projectRoot, deps } = args;
  const log = getRuntimeLogger();
  const { topLevelDirectories, topLevelFiles } = getTopLevelSummary(projectRoot);
  const gitignoreContent = getGitignoreContent(projectRoot);
  const agentInput: IGenerateExcludeAgentInput = {
    projectRootName: basename(projectRoot),
    topLevelDirectories,
    topLevelFiles,
    gitignoreContent,
  };
  const runExcludeAgentFn =
    deps?.runExcludeAgentFn ??
    (async (input: IGenerateExcludeAgentInput): Promise<string[]> =>
      runStructuredAgent({
        agent: generateRepoExcludeAgent,
        input,
        workspace: projectRoot,
      }));

  log.info({
    event: REPO_SCOPE_CONFIG_GENERATION_STARTED,
    projectRoot,
    topLevelDirectoryCount: topLevelDirectories.length,
    topLevelFileCount: topLevelFiles.length,
  });

  try {
    const exclude = await runExcludeAgentFn(agentInput);
    const normalized: IGeneratedExclude = {
      exclude: uniqueNormalized(exclude),
    };
    validateRequiredExcludes({
      topLevelDirectories,
      exclude: normalized.exclude,
    });

    log.info({
      event: REPO_SCOPE_CONFIG_GENERATION_COMPLETED,
      excludeCount: normalized.exclude.length,
      excludeSample: normalized.exclude.slice(0, 10),
    });

    return normalized;
  } catch (error) {
    logError(error, {
      event: REPO_SCOPE_CONFIG_GENERATION_FAILED,
      component: "context",
      operation: "generateRepoScopeConfig",
    });
    throw error;
  }
}
