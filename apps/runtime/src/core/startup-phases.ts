/**
 * Startup phase runners. Orchestration only; all behavior injected via deps so core does not import features.
 * Order: DB migration → repo-scope (load config once, snapshots) → event sources/workers.
 */
import { getRuntimeLogger } from "./logger.js";
import { getProjectRoot } from "./project-root.js";
import { updateRuntimeState } from "./state.js";
import { RUNTIME_INIT_PHASE_COMPLETED, RUNTIME_INIT_PHASE_STARTED } from "./runtime-log-events.js";

export type IRepoScopeConfigLike = {
  ruleSources: string[];
  projectContext: string[];
};

export type IRepoScopePhaseDeps = {
  loadStrictCtoConfigFromDb: (projectRoot: string) => Promise<IRepoScopeConfigLike>;
  getExclude: (projectRoot: string) => string[];
  writeGeneratedExclude: (projectRoot: string, exclude: string[]) => void;
  generateExclude: (args: {
    projectRoot: string;
    deps?: unknown;
  }) => Promise<{ exclude: string[] }>;
  ensureRulesSnapshot: (projectRoot: string, config: IRepoScopeConfigLike) => Promise<unknown>;
  ensureProjectContextSnapshot: (
    projectRoot: string,
    config: IRepoScopeConfigLike
  ) => Promise<unknown>;
};

export async function runRepoScopePhase(
  setRepoScopeConfig: (config: IRepoScopeConfigLike) => void,
  deps: IRepoScopePhaseDeps
): Promise<void> {
  const projectRoot = getProjectRoot();
  const log = getRuntimeLogger();
  updateRuntimeState({ phase: "building-repo-scope", phaseStartedAt: Date.now() });
  log.info({ event: RUNTIME_INIT_PHASE_STARTED, phase: "building-repo-scope" });
  const startedAt = Date.now();
  const config = await deps.loadStrictCtoConfigFromDb(projectRoot);
  setRepoScopeConfig(config);
  if (deps.getExclude(projectRoot).length === 0) {
    const generated = await deps.generateExclude({ projectRoot, deps: undefined });
    deps.writeGeneratedExclude(projectRoot, generated.exclude);
  }
  await deps.ensureRulesSnapshot(projectRoot, config);
  await deps.ensureProjectContextSnapshot(projectRoot, config);
  log.info({
    event: RUNTIME_INIT_PHASE_COMPLETED,
    phase: "building-repo-scope",
    durationMs: Date.now() - startedAt,
    projectRoot,
  });
}

/**
 * Runs repo-scope generation (exclude, rules snapshot, project context) when config is already in memory.
 * Used by config initialize/update to complete activation after writing config to SQLite.
 */
export async function runRepoScopePhaseFromConfig(
  config: IRepoScopeConfigLike,
  deps: IRepoScopePhaseDeps
): Promise<void> {
  const projectRoot = getProjectRoot();
  const log = getRuntimeLogger();
  updateRuntimeState({ phase: "building-repo-scope", phaseStartedAt: Date.now() });
  log.info({ event: RUNTIME_INIT_PHASE_STARTED, phase: "building-repo-scope" });
  const startedAt = Date.now();
  if (deps.getExclude(projectRoot).length === 0) {
    const generated = await deps.generateExclude({ projectRoot, deps: undefined });
    deps.writeGeneratedExclude(projectRoot, generated.exclude);
  }
  await deps.ensureRulesSnapshot(projectRoot, config);
  await deps.ensureProjectContextSnapshot(projectRoot, config);
  log.info({
    event: RUNTIME_INIT_PHASE_COMPLETED,
    phase: "building-repo-scope",
    durationMs: Date.now() - startedAt,
    projectRoot,
  });
}

type IntervalRef = { current: ReturnType<typeof setInterval> | null };

export type IEventSourcesPhaseDeps = {
  startEventSources: () => void;
  runStaleImplementingSweep: () => void;
  startWorkers: () => void;
  logDisabledWorkflows: () => void;
  staleSweepIntervalMs: number;
  staleSweepIntervalRef: IntervalRef;
};

export function runEventSourcesPhase(deps: IEventSourcesPhaseDeps): void {
  const log = getRuntimeLogger();
  updateRuntimeState({ phase: "starting-services", phaseStartedAt: Date.now() });
  log.info({ event: RUNTIME_INIT_PHASE_STARTED, phase: "starting-services" });
  const startedAt = Date.now();
  deps.startEventSources();
  deps.runStaleImplementingSweep();
  deps.staleSweepIntervalRef.current = setInterval(
    () => deps.runStaleImplementingSweep(),
    deps.staleSweepIntervalMs
  );
  deps.startWorkers();
  deps.logDisabledWorkflows();
  log.info({
    event: RUNTIME_INIT_PHASE_COMPLETED,
    phase: "starting-services",
    durationMs: Date.now() - startedAt,
    projectRoot: getProjectRoot(),
  });
}
