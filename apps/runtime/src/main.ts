/**
 * Runtime composition root. Wires env, SQLite state, HTTP server, lifecycle services, and category/rules/continual-learning features. Single bootstrap entry; no other module should perform app-level wiring.
 */
import "dotenv/config";
import { loadEnv } from "./core/env.js";
import { createSqliteCheckpointStore } from "./core/sources/sqlite-checkpoint-store.js";
import type { ITranscriptIngestionService } from "./core/sources/transcript-ingestion-service.js";
import type { IProcessCategoryImplementingDeps } from "./features/categories/category-implementing-processor.js";
import {
  processUndoCategory,
  type IProcessUndoCategoryDeps,
} from "./features/categories/undo-category-processor.js";
import {
  getFindingByIdAcrossCategories,
  listAllFindingsForCategory,
  listReviewFindingsForCategory,
  listApprovedFindingsForCategory,
  setCategoriesStoreDeps,
  type ICategoriesStoreDeps,
  transitionFindingStatus,
} from "./features/categories/categories-store.js";
import {
  getActionableCategories,
  loadCategoryRegistry,
  setCategoryRegistryDeps,
} from "./features/categories/category-registry.js";
import { buildLocationsExcerpt } from "./features/categories/build-locations-excerpt.js";
import { getCurrentContextFingerprintForItem } from "./features/categories/context-fingerprint.js";
import { readSourceDocs } from "./features/categories/rules-snapshot.js";
import { loadSnapshot } from "./features/categories/rules-snapshot.js";
import { isAllowedItemTransition } from "./features/workflow/workflow-allowed-transitions.js";
import { IMPLEMENTING_MAX_RETRIES } from "./features/workflow/implementing-policy.js";
import { isAllowedRuleTransition } from "./features/workflow/workflow-allowed-transitions.js";
import {
  findRuleById,
  listAllRules,
  listReviewRules,
  setRulesStoreDeps,
  type IRulesStoreDeps,
  transitionRuleStatus,
} from "./features/rules/rules-store.js";
import { getProjectRoot } from "./core/project-root.js";
import { getRuntimeState, updateRuntimeState } from "./core/state.js";
import { AppError, isAppError } from "./core/app-error.js";
import {
  ERR_ACTIVATION_IN_PROGRESS,
  ERR_CONFIG_MISSING,
  ERR_DEPS_NOT_SET,
} from "./core/error-codes.js";
import { getRuntimeLogger, logError } from "./core/logger.js";
import { createOptionHintFromRejectedFinding } from "./features/categories/option-hints-store.js";
import {
  readRepoScopeConfigFromDisk,
  writeRepoScopeConfig,
  type IRepoScopeConfig,
  FEATURE_FLAGS_DEFAULTS,
} from "./features/context/repo-scope-config.js";
import { CONFIG_SCHEMA_VERSION } from "./features/config/project-config-store.js";
import {
  readScanningStatus,
  writeScanningStatus,
} from "./features/config/scanning-status-store.js";
import { buildCursorRulesContext } from "./features/context/cursor-rules-context.js";
import {
  buildProjectContextForAgent,
  cursorProjectDirFromRoot,
} from "./features/context/project-context-builder.js";
import { loadProjectContextSnapshot } from "./features/context/project-context-snapshot.js";
import type { ICleanupRefs } from "./core/runtime-cleanup.js";
import type { IContinualLearningIdleState } from "./features/continual-learning/continual-learning.types.js";
import {
  RUNTIME_LIFECYCLE_READY,
  RUNTIME_INIT_STARTED,
  RUNTIME_INIT_FAILED,
} from "./core/runtime-log-events.js";
import {
  runRepoScopePhase,
  runRepoScopePhaseFromConfig,
  type IRepoScopeConfigLike,
} from "./core/startup-phases.js";
import { createLlmProvider, setLlmProvider } from "./core/llm/llm-provider-factory.js";
import {
  createTranscriptFetcher,
  setTranscriptFetcher,
} from "./core/sources/transcript-fetcher-factory.js";
import { fileURLToPath } from "url";
import {
  initializeRuntimeBootstrap,
  initializeStateOrExit,
} from "./lifecycle/runtime-bootstrap.js";
import { handleFatal } from "./lifecycle/fatal-handler.js";
import {
  buildRepoScopePhaseDeps,
  runPostActivationScanningSourcesPhase,
  runPostActivationWorkflowProcessorsPhase,
  type IPostActivationEventSourcesDeps,
} from "./lifecycle/activation-lifecycle.js";
import {
  startTranscriptIngestion,
  startContinualLearning,
  startGitPollerFromMain,
  ensureDirsAndRecovery,
  runStaleImplementingSweep,
  logDisabledWorkflows,
  startWorkers,
} from "./lifecycle/event-sources-lifecycle.js";
import { startHttpServer } from "./lifecycle/http-lifecycle.js";
import type { IConfigRouteConfig } from "./http/routes/config.routes.js";
import { openRuntimeDb } from "./core/db/sqlite-connection.js";
import { runSqliteMigrations } from "./core/db/sqlite-migrations.js";
import { setRuntimeDb } from "./core/db/runtime-db.js";

const STALE_SWEEP_INTERVAL_MS = 60000;

async function runRuntime(): Promise<void> {
  initializeRuntimeBootstrap(fileURLToPath(import.meta.url));
  initializeStateOrExit();
  setLlmProvider(createLlmProvider());
  setTranscriptFetcher(
    createTranscriptFetcher({
      cursorProjectDirFromRoot,
    })
  );

  setCategoryRegistryDeps({ readRepoScopeConfigFromDisk });

  const categoriesStoreDeps: ICategoriesStoreDeps = {
    isAllowedItemTransition: (from, to) =>
      isAllowedItemTransition(
        from as Parameters<typeof isAllowedItemTransition>[0],
        to as Parameters<typeof isAllowedItemTransition>[1]
      ),
  };
  setCategoriesStoreDeps(categoriesStoreDeps);

  const rulesStoreDeps: IRulesStoreDeps = {
    isAllowedRuleTransition: (from, to) =>
      isAllowedRuleTransition(from, to as Parameters<typeof isAllowedRuleTransition>[1]),
  };
  setRulesStoreDeps(rulesStoreDeps);

  const fingerprintDeps = {
    loadProjectContextSnapshot: (root: string) => {
      const s = loadProjectContextSnapshot(root);
      return s ? { sourcesHash: s.sourcesHash, extractorVersion: s.extractorVersion } : null;
    },
  };
  const processCategoryDeps: IProcessCategoryImplementingDeps = {
    cursorProjectDirFromRoot,
    implementingMaxRetries: IMPLEMENTING_MAX_RETRIES,
    getCurrentContextFingerprintForItem: (projectRoot, item) =>
      getCurrentContextFingerprintForItem(projectRoot, item, fingerprintDeps),
    buildRulesContextExcerpt: (root) =>
      buildCursorRulesContext(root, { getSourceDocs: readSourceDocs }),
    buildProjectContextExcerpt: buildProjectContextForAgent,
    buildLocationsExcerpt,
  };
  const processUndoDeps: IProcessUndoCategoryDeps = {
    cursorProjectDirFromRoot,
  };
  const processUndoCategoryFn = (args: {
    projectRoot: string;
    categoryId: string;
    itemId: string;
  }) => processUndoCategory({ ...args, deps: processUndoDeps });
  const seenIds = new Set<string>();
  const checkpointStore = createSqliteCheckpointStore();
  const transcriptIngestionServiceRef = { current: null as ITranscriptIngestionService | null };
  const findingImplementationWorkerIntervalRef = {
    current: null as ReturnType<typeof setInterval> | null,
  };
  const ruleApplyWorkerIntervalRef = { current: null as ReturnType<typeof setInterval> | null };
  const rejectedFindingLearningIntervalRef = {
    current: null as ReturnType<typeof setInterval> | null,
  };
  const staleSweepIntervalRef = { current: null as ReturnType<typeof setInterval> | null };
  const repoScopeConfigRef = { current: null as IRepoScopeConfig | null };
  const gitPollStopRef = { current: null as (() => void) | null };
  const continualLearningIdleByPath = new Map<string, IContinualLearningIdleState>();
  const continualLearningIntervalRef = { current: null as ReturnType<typeof setInterval> | null };
  const cleanupRefs: ICleanupRefs = {
    transcriptIngestionServiceRef,
    staleSweepIntervalRef,
    continualLearningIntervalRef,
    stopGitPollRef: gitPollStopRef,
    findingImplementationWorkerIntervalRef,
    ruleApplyWorkerIntervalRef,
    rejectedFindingLearningIntervalRef,
  };

  const activationInProgressRef = { current: false };
  let operationQueue = Promise.resolve();
  function enqueueOperation<T>(op: () => Promise<T>): Promise<T> {
    const res = operationQueue.then(op);
    operationQueue = res.catch(() => {}).then(() => {});
    return res;
  }
  const repoScopePhaseDeps = buildRepoScopePhaseDeps();

  function stopScanningSources(): void {
    transcriptIngestionServiceRef.current?.stop();
    transcriptIngestionServiceRef.current = null;
    gitPollStopRef.current?.();
    gitPollStopRef.current = null;
    if (continualLearningIntervalRef.current) {
      clearInterval(continualLearningIntervalRef.current);
      continualLearningIntervalRef.current = null;
    }
  }

  function stopWorkflowProcessors(): void {
    if (staleSweepIntervalRef.current) {
      clearInterval(staleSweepIntervalRef.current);
      staleSweepIntervalRef.current = null;
    }
    if (findingImplementationWorkerIntervalRef.current) {
      clearInterval(findingImplementationWorkerIntervalRef.current);
      findingImplementationWorkerIntervalRef.current = null;
    }
    if (ruleApplyWorkerIntervalRef.current) {
      clearInterval(ruleApplyWorkerIntervalRef.current);
      ruleApplyWorkerIntervalRef.current = null;
    }
    if (rejectedFindingLearningIntervalRef.current) {
      clearInterval(rejectedFindingLearningIntervalRef.current);
      rejectedFindingLearningIntervalRef.current = null;
    }
  }

  function stopActiveResourcesBeforeReconcile(): void {
    stopScanningSources();
    stopWorkflowProcessors();
  }

  function startConfiguredResources(repoScopeConfigForPhases: IRepoScopeConfig): void {
    const deps = buildPostActivationDeps(repoScopeConfigForPhases);
    runPostActivationWorkflowProcessorsPhase(deps);
    if (readScanningStatus() === "active") {
      runPostActivationScanningSourcesPhase(deps);
    } else {
      getRuntimeLogger().info({
        event: "Scanning is paused, skipping discovery sources startup",
      });
    }
  }

  function buildPostActivationDeps(
    repoScopeConfigForPhases: IRepoScopeConfig
  ): IPostActivationEventSourcesDeps {
    return {
      repoScopeConfigRef,
      repoScopeConfigForPhases,
      seenIds,
      checkpointStore,
      transcriptIngestionServiceRef,
      gitPollStopRef,
      continualLearningIdleByPath,
      continualLearningIntervalRef,
      ruleApplyWorkerIntervalRef,
      staleSweepIntervalRef,
      staleSweepIntervalMs: STALE_SWEEP_INTERVAL_MS,
      startTranscriptIngestionWithGetter: (getRepoScopeConfig) =>
        startTranscriptIngestion(
          seenIds,
          checkpointStore,
          transcriptIngestionServiceRef,
          getRepoScopeConfig
        ),
      startContinualLearningWithGetter: (getRepoScopeConfig) =>
        startContinualLearning(
          transcriptIngestionServiceRef,
          continualLearningIdleByPath,
          continualLearningIntervalRef,
          getRepoScopeConfig
        ),
      startGitPollerWithGetters: (getRepoScopeConfig, setRepoScopeConfig, onTick) =>
        startGitPollerFromMain(getRepoScopeConfig, setRepoScopeConfig, gitPollStopRef, onTick),
      ensureDirsAndRecoveryWithGetter: (getRepoScopeConfig) =>
        ensureDirsAndRecovery(getRepoScopeConfig),
      runStaleImplementingSweepWithGetter: (getRepoScopeConfig) =>
        runStaleImplementingSweep(getRepoScopeConfig),
      startWorkersWithConfig: (repoScopeConfig) =>
        startWorkers({
          repoScopeConfig,
          processCategoryDeps,
          findingImplementationWorkerIntervalRef,
          ruleApplyWorkerIntervalRef,
          rejectedFindingLearningIntervalRef,
        }),
      logDisabledWorkflowsWithConfig: (repoScopeConfig) =>
        logDisabledWorkflows({ repoScopeConfig }),
      ensureRulesSnapshot: (projectRoot, config) =>
        repoScopePhaseDeps.ensureRulesSnapshot(projectRoot, config),
      ensureProjectContextSnapshot: (projectRoot, config) =>
        repoScopePhaseDeps.ensureProjectContextSnapshot(projectRoot, config),
    };
  }

  const runActivation = (config: IRepoScopeConfig): Promise<void> => {
    return enqueueOperation(async () => {
      if (activationInProgressRef.current) {
        throw new AppError("Activation already in progress", ERR_ACTIVATION_IN_PROGRESS, {
          projectRoot: getProjectRoot(),
        });
      }
      activationInProgressRef.current = true;
      try {
        updateRuntimeState({
          state: "reconciling",
          phase: "reconciling-config",
          phaseStartedAt: Date.now(),
          lastError: null,
        });
        stopActiveResourcesBeforeReconcile();
        repoScopeConfigRef.current = config;
        await runRepoScopePhaseFromConfig(config, repoScopePhaseDeps);
        const repoScopeConfigForPhases = repoScopeConfigRef.current;
        if (!repoScopeConfigForPhases) {
          throw new AppError(
            "repoScopeConfig must be set after runRepoScopePhaseFromConfig",
            ERR_DEPS_NOT_SET,
            {
              component: "activation",
            }
          );
        }
        startConfiguredResources(repoScopeConfigForPhases);
        updateRuntimeState({
          state: "running",
          phase: undefined,
          phaseStartedAt: undefined,
        });
        getRuntimeLogger().info({ event: RUNTIME_LIFECYCLE_READY });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateRuntimeState({
          state: "error",
          lastError: message,
          phase: undefined,
          phaseStartedAt: undefined,
        });
        throw err;
      } finally {
        activationInProgressRef.current = false;
      }
    });
  };

  const inboxDeps = {
    loadCategoryRegistry,
    listReviewFindingsForCategory,
    listApprovedFindingsForCategory,
    listReviewRules,
  };
  const itemsDeps = {
    loadCategoryRegistry,
    listAllRules,
    listAllFindingsForCategory,
  };
  const rulesDeps = {
    findRuleById,
    transitionRuleStatus,
    loadSnapshot,
  };
  const findingsDeps = {
    getActionableCategories,
    getFindingByIdAcrossCategories,
    transitionFindingStatus,
    shouldLearnFromRejectedFinding: (projectRoot: string): boolean =>
      readRepoScopeConfigFromDisk(projectRoot)?.features.rulesWorkflowEnabled === true,
    processUndoCategory: processUndoCategoryFn,
    captureOptionHintOnFindingReject: (args: {
      projectRoot: string;
      categoryId: string;
      itemId: string;
      rejectedReason: string;
    }):
      | { outcome: "disabled" }
      | { outcome: "created"; hintId: string; trigger: string }
      | { outcome: "duplicate"; hintId: string; trigger: string }
      | { outcome: "skipped"; reason: string } => {
      const repoScopeConfig = readRepoScopeConfigFromDisk(args.projectRoot);
      if (!repoScopeConfig?.features.optionHintsEnabled) {
        return { outcome: "disabled" };
      }
      const result = createOptionHintFromRejectedFinding({
        projectRoot: args.projectRoot,
        categoryId: args.categoryId,
        itemId: args.itemId,
        rejectedReason: args.rejectedReason,
      });
      if (result.outcome === "created" || result.outcome === "duplicate") {
        return {
          outcome: result.outcome,
          hintId: result.hint.id,
          trigger: result.hint.trigger,
        };
      }
      return result;
    },
  };
  const configDeps = {
    getRuntimeStatus: getRuntimeState,
    runActivation: (config: IConfigRouteConfig) => runActivation(config as IRepoScopeConfig),
    readConfig: readRepoScopeConfigFromDisk as (
      projectRoot: string
    ) => ReturnType<typeof readRepoScopeConfigFromDisk>,
    writeConfig: (projectRoot: string, config: Record<string, unknown>) =>
      writeRepoScopeConfig(projectRoot, config as IRepoScopeConfig),
    configSchemaVersion: CONFIG_SCHEMA_VERSION,
    featureFlagsDefaults: FEATURE_FLAGS_DEFAULTS,
  };
  const serverDeps = { cleanupRefs };
  const scanningDeps = {
    getScanningStatus: () => readScanningStatus(),
    resumeScanning: () =>
      enqueueOperation(async () => {
        writeScanningStatus("active");
        const repoScopeConfigForPhases = repoScopeConfigRef.current;
        if (repoScopeConfigForPhases !== null) {
          stopScanningSources();
          runPostActivationScanningSourcesPhase(buildPostActivationDeps(repoScopeConfigForPhases));
        }
      }),
    pauseScanning: () =>
      enqueueOperation(async () => {
        writeScanningStatus("paused");
        stopScanningSources();
      }),
  };

  getRuntimeLogger().info({ event: RUNTIME_INIT_STARTED });

  try {
    updateRuntimeState({ phase: "opening-db", phaseStartedAt: Date.now() });
    const db = openRuntimeDb(getProjectRoot());
    setRuntimeDb(db);
    updateRuntimeState({ phase: "migrating-db", phaseStartedAt: Date.now() });
    runSqliteMigrations(db);

    try {
      await runRepoScopePhase((config: IRepoScopeConfigLike) => {
        repoScopeConfigRef.current = config as IRepoScopeConfig;
      }, repoScopePhaseDeps);
    } catch (repoScopeErr) {
      if (isAppError(repoScopeErr) && repoScopeErr.code === ERR_CONFIG_MISSING) {
        getRuntimeLogger().info({
          event: "Runtime entering needs-config; project config missing",
          projectRoot: getProjectRoot(),
        });
        updateRuntimeState({
          state: "needs-config",
          phase: "loading-config",
          phaseStartedAt: Date.now(),
          lastError: null,
        });
        startHttpServer(
          inboxDeps,
          itemsDeps,
          rulesDeps,
          findingsDeps,
          configDeps,
          serverDeps,
          scanningDeps
        );
        return;
      }
      throw repoScopeErr;
    }

    startHttpServer(
      inboxDeps,
      itemsDeps,
      rulesDeps,
      findingsDeps,
      configDeps,
      serverDeps,
      scanningDeps
    );
    const repoScopeConfigForPhases = repoScopeConfigRef.current;
    if (repoScopeConfigForPhases === null) {
      throw new AppError("repoScopeConfig must be set before event sources", ERR_DEPS_NOT_SET, {
        component: "event-sources",
      });
    }
    startConfiguredResources(repoScopeConfigForPhases);

    updateRuntimeState({
      state: "running",
      phase: undefined,
      phaseStartedAt: undefined,
    });
    getRuntimeLogger().info({ event: RUNTIME_LIFECYCLE_READY });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateRuntimeState({
      state: "error",
      lastError: msg,
      phase: undefined,
      phaseStartedAt: undefined,
    });
    logError(e, {
      event: RUNTIME_INIT_FAILED,
      component: "startup",
      operation: "runRuntime",
    });
    throw e;
  }
}

const isRuntime = process.argv.includes("--runtime");
if (isRuntime) {
  runRuntime().catch(handleFatal);
} else {
  loadEnv();
  console.log("steward bootstrap OK (run with --runtime for background mode)");
}
