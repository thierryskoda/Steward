import {
  EXCLUDE_REGEN_COMPLETED,
  EXCLUDE_REGEN_FAILED,
  EXCLUDE_REGEN_STARTED,
  EXCLUDE_REGEN_UNCHANGED,
} from "../../core/runtime-log-events.js";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import { getExclude, writeGeneratedExclude } from "./repo-scope-config.js";
import type { IGeneratedExclude } from "./generate-repo-scope-config.js";

export type IRegenerateExcludeResult = { updated: true } | { updated: false };

export type IRegenerateExcludeConfigDeps = {
  generateExclude: (args: { projectRoot: string }) => Promise<IGeneratedExclude>;
};

export async function regenerateExcludeConfig(args: {
  projectRoot: string;
  deps: IRegenerateExcludeConfigDeps;
}): Promise<IRegenerateExcludeResult> {
  const { projectRoot, deps } = args;
  const log = getRuntimeLogger();

  log.info({ event: EXCLUDE_REGEN_STARTED, projectRoot });

  let generated: IGeneratedExclude;
  try {
    generated = await deps.generateExclude({ projectRoot });
  } catch (error) {
    logError(error, {
      event: EXCLUDE_REGEN_FAILED,
      component: "context",
      operation: "regenerateExcludeConfig",
      projectRoot,
    });
    throw error;
  }

  const current = getExclude(projectRoot);
  const currentSorted = [...current].sort();
  const generatedSorted = [...generated.exclude].sort();
  if (
    currentSorted.length === generatedSorted.length &&
    currentSorted.every((v, i) => v === generatedSorted[i])
  ) {
    log.info({
      event: EXCLUDE_REGEN_UNCHANGED,
      excludeCount: generated.exclude.length,
    });
    return { updated: false };
  }

  writeGeneratedExclude(projectRoot, generated.exclude);

  log.info({
    event: EXCLUDE_REGEN_COMPLETED,
    configPath: `${projectRoot}/.steward/state.db:generated_snapshots/exclude`,
    excludeCount: generated.exclude.length,
    excludeSample: generated.exclude.slice(0, 10),
  });

  return { updated: true };
}
