/**
 * Repo-scope phase deps and post-activation event-sources phase. Single place for the shared
 * "run event sources after config is set" logic (used by runActivation and by happy-path startup).
 */
import { runStructuredAgent } from "../core/llm/run-structured.agent.js";
import { logError } from "../core/logger.js";
import { runEventSourcesPhase, type IRepoScopePhaseDeps } from "../core/startup-phases.js";
import {
  ensureRulesSnapshot,
  type ISourceDocEntry,
} from "../features/categories/rules-snapshot.js";
import {
  ensureProjectContextSnapshot,
  loadProjectContextSnapshot,
} from "../features/context/project-context-snapshot.js";
import {
  getRuleSources,
  getProjectContextSources,
  getExclude,
  getIgnoreMatcher,
  getApprovalMode,
  readRepoScopeConfigFromDisk,
  type IRepoScopeConfig,
  writeGeneratedExclude,
} from "../features/context/repo-scope-config.js";
import { loadStrictCtoConfigFromDb } from "../features/context/repo-scope-config.js";
import { generateExclude } from "../features/context/generate-repo-scope-config.js";
import {
  regenerateExcludeConfig,
  type IRegenerateExcludeConfigDeps,
} from "../features/context/regenerate-repo-scope-config.js";
import { buildProjectContextForAgent } from "../features/context/project-context-builder.js";
import { buildCursorRulesContext } from "../features/context/cursor-rules-context.js";
import { readSourceDocs } from "../features/categories/rules-snapshot.js";
import { extractRulesCategoriesAgent } from "../features/categories/extract-rules-categories.agent.js";
import { extractProjectContextAgent } from "../features/context/extract-project-context.agent.js";
import { buildLocationsExcerpt } from "../features/categories/build-locations-excerpt.js";
import {
  getCurrentContextFingerprint,
  getCurrentContextFingerprintForItem,
} from "../features/categories/context-fingerprint.js";
import {
  generateAllGenericCategories,
  type IGenerateCategoryDeps,
} from "../features/categories/generate-category.js";
import { getLlmProvider } from "../core/llm/llm-provider-factory.js";
import { CATEGORY_GENERATION_FAILED, EXCLUDE_REGEN_FAILED } from "../core/runtime-log-events.js";
import {
  SNAPSHOT_REFRESH_FAILED_ON_GIT_POLL,
  STALE_CONTEXT_SCAN_FAILED_AFTER_REFRESH,
} from "../features/categories/categories-log-events.js";
import type { IGitPollerOnTickArgs, IGitPollerRepoScopeConfig } from "../core/git/git-poll-tick.js";
import type { ITranscriptIngestionService } from "../core/sources/transcript-ingestion-service.js";
import type { IContinualLearningIdleState } from "../features/continual-learning/continual-learning.types.js";
import type { CheckpointStore } from "../core/sources/types.js";
import { loadCategoryRegistry } from "../features/categories/category-registry.js";
import {
  listReviewFindingsForCategory,
  listApprovedFindingsForCategory,
} from "../features/categories/categories-store.js";
import { runStaleContextScan } from "../features/categories/stale-context-scan.js";

export function buildRepoScopePhaseDeps(): IRepoScopePhaseDeps {
  return {
    loadStrictCtoConfigFromDb: (root) => loadStrictCtoConfigFromDb(root),
    getExclude,
    writeGeneratedExclude,
    generateExclude: (args) => generateExclude({ projectRoot: args.projectRoot, deps: undefined }),
    ensureRulesSnapshot: (projectRoot, config) =>
      ensureRulesSnapshot({
        projectRoot,
        config,
        deps: {
          runExtractor: async ({
            projectRoot: pRoot,
            sourceEntries,
          }: {
            projectRoot: string;
            sourceEntries: ISourceDocEntry[];
          }) => {
            const out = await runStructuredAgent({
              agent: extractRulesCategoriesAgent,
              input: { sourceEntries },
              workspace: pRoot,
            });
            return out.categories;
          },
          getRuleSources: (c) => getRuleSources(c as IRepoScopeConfig),
        },
      }),
    ensureProjectContextSnapshot: (projectRoot, config) =>
      ensureProjectContextSnapshot({
        projectRoot,
        config,
        deps: {
          runExtractor: async ({
            projectRoot: pRoot,
            sourceEntries,
          }: {
            projectRoot: string;
            sourceEntries: Array<{ path: string; content: string }>;
          }) => {
            const out = await runStructuredAgent({
              agent: extractProjectContextAgent,
              input: { sourceEntries },
              workspace: pRoot,
            });
            return out.projectContextText;
          },
          getProjectContextSources: (c) => getProjectContextSources(c as IRepoScopeConfig),
        },
      }),
  };
}

export type IPostActivationEventSourcesDeps = {
  repoScopeConfigRef: { current: IRepoScopeConfig | null };
  repoScopeConfigForPhases: IRepoScopeConfig;
  seenIds: Set<string>;
  checkpointStore: CheckpointStore;
  transcriptIngestionServiceRef: { current: ITranscriptIngestionService | null };
  gitPollStopRef: { current: (() => void) | null };
  continualLearningIdleByPath: Map<string, IContinualLearningIdleState>;
  continualLearningIntervalRef: { current: ReturnType<typeof setInterval> | null };
  ruleApplyWorkerIntervalRef: { current: ReturnType<typeof setInterval> | null };
  staleSweepIntervalRef: { current: ReturnType<typeof setInterval> | null };
  staleSweepIntervalMs: number;
  startTranscriptIngestionWithGetter: (getRepoScopeConfig: () => IRepoScopeConfig) => void;
  startContinualLearningWithGetter: (getRepoScopeConfig: () => IRepoScopeConfig) => void;
  startGitPollerWithGetters: (
    getRepoScopeConfig: () => IRepoScopeConfig,
    setRepoScopeConfig: (cfg: IGitPollerRepoScopeConfig) => void,
    onTick: (args: IGitPollerOnTickArgs) => Promise<void>
  ) => void;
  ensureDirsAndRecoveryWithGetter: (getRepoScopeConfig: () => IRepoScopeConfig) => void;
  runStaleImplementingSweepWithGetter: (getRepoScopeConfig: () => IRepoScopeConfig | null) => void;
  startWorkersWithConfig: (repoScopeConfig: IRepoScopeConfig | null) => void;
  logDisabledWorkflowsWithConfig: (repoScopeConfig: IRepoScopeConfig | null) => void;
  ensureRulesSnapshot: (projectRoot: string, config: IRepoScopeConfig) => Promise<unknown>;
  ensureProjectContextSnapshot: (projectRoot: string, config: IRepoScopeConfig) => Promise<unknown>;
};

export function runPostActivationScanningSourcesPhase(deps: IPostActivationEventSourcesDeps): void {
  const { repoScopeConfigRef, repoScopeConfigForPhases } = deps;
  const getRepoScopeConfig = (): IRepoScopeConfig =>
    repoScopeConfigRef.current ?? repoScopeConfigForPhases;
  const setRepoScopeConfig = (cfg: IGitPollerRepoScopeConfig): void => {
    const prev = repoScopeConfigRef.current ?? repoScopeConfigForPhases;
    repoScopeConfigRef.current = {
      ...prev,
      ruleSources: cfg.ruleSources,
      approvalMode: cfg.approvalMode,
      projectContext: cfg.projectContext,
      features: cfg.features,
    };
  };
  const categoryDeps: IGenerateCategoryDeps = {
    createChatId: () => getLlmProvider().createConversationId(),
    runStructuredAgent,
    buildProjectContextForAgent,
    buildCursorRulesContext: (root) =>
      buildCursorRulesContext(root, { getSourceDocs: readSourceDocs }),
    getApprovalMode: () => getApprovalMode(getRepoScopeConfig()),
    readRepoScopeConfigFromDisk,
    getExclude: (projectRoot) => getExclude(projectRoot),
    getIgnoreMatcher: (projectRoot) => getIgnoreMatcher(projectRoot),
    getCurrentContextFingerprint: (projectRoot) =>
      getCurrentContextFingerprint(projectRoot, {
        loadProjectContextSnapshot: (root) => {
          const s = loadProjectContextSnapshot(root);
          return s ? { sourcesHash: s.sourcesHash, extractorVersion: s.extractorVersion } : null;
        },
      }),
  };
  const regenDeps: IRegenerateExcludeConfigDeps = {
    generateExclude: (args) => generateExclude({ projectRoot: args.projectRoot, deps: undefined }),
  };
  let snapshotRefreshInFlight = false;
  const ruleAndContextSources = (): string[] => [
    ...getRuleSources(getRepoScopeConfig()),
    ...getProjectContextSources(getRepoScopeConfig()),
  ];
  const changedPathsNormalized = (paths: string[]): Set<string> =>
    new Set(paths.map((p) => p.replace(/\\/g, "/").trim()));
  const sourcePathsNormalized = (): Set<string> =>
    new Set(ruleAndContextSources().map((p) => p.replace(/\\/g, "/").trim()));
  const shouldRefreshSnapshots = (changedPaths: string[]): boolean => {
    const changed = changedPathsNormalized(changedPaths);
    const sources = sourcePathsNormalized();
    for (const p of changed) {
      if (sources.has(p)) return true;
    }
    return false;
  };
  const onTick = async (args: IGitPollerOnTickArgs): Promise<void> => {
    if (
      shouldRefreshSnapshots(args.changedPaths) &&
      !snapshotRefreshInFlight &&
      (args.hasReactiveWork || args.hasProactiveWork)
    ) {
      snapshotRefreshInFlight = true;
      const config = getRepoScopeConfig();
      try {
        await deps.ensureRulesSnapshot(args.projectRoot, config);
        await deps.ensureProjectContextSnapshot(args.projectRoot, config);
      } catch (error) {
        logError(error, {
          event: SNAPSHOT_REFRESH_FAILED_ON_GIT_POLL,
          component: "git-poll",
          operation: "ensureRulesSnapshotOrProjectContextSnapshot",
          projectRoot: args.projectRoot,
        });
      } finally {
        snapshotRefreshInFlight = false;
      }
      const fingerprintDeps = {
        loadProjectContextSnapshot: (root: string) => {
          const s = loadProjectContextSnapshot(root);
          return s ? { sourcesHash: s.sourcesHash, extractorVersion: s.extractorVersion } : null;
        },
      };
      try {
        await runStaleContextScan(args.projectRoot, {
          getCurrentContextFingerprintForItem: (projectRoot, item) =>
            getCurrentContextFingerprintForItem(projectRoot, item, fingerprintDeps),
          loadCategoryRegistry,
          listReviewFindingsForCategory,
          listApprovedFindingsForCategory,
          buildRulesContextExcerpt: (root) =>
            buildCursorRulesContext(root, { getSourceDocs: readSourceDocs }),
          buildProjectContextExcerpt: buildProjectContextForAgent,
          buildLocationsExcerpt,
        });
      } catch (error) {
        logError(error, {
          event: STALE_CONTEXT_SCAN_FAILED_AFTER_REFRESH,
          component: "git-poll",
          operation: "runStaleContextScan",
          projectRoot: args.projectRoot,
        });
      }
    }
    if (args.hasProactiveWork && args.config.features.genericFindingEnabled) {
      try {
        await generateAllGenericCategories({
          projectRoot: args.projectRoot,
          deps: categoryDeps,
        });
      } catch (error) {
        const categoryId = (error as Error & { categoryId?: string }).categoryId;
        logError(error, {
          event: CATEGORY_GENERATION_FAILED,
          component: "git-poll",
          operation: "runGenerateAllGenericCategories",
          projectRoot: args.projectRoot,
          ...(categoryId !== undefined && { categoryId }),
          changedFilesCount: args.changedPaths.length,
        });
      }
    }
    if (args.shouldRegenExclude) {
      try {
        await regenerateExcludeConfig({
          projectRoot: args.projectRoot,
          deps: regenDeps,
        });
      } catch (error) {
        logError(error, {
          event: EXCLUDE_REGEN_FAILED,
          component: "git-poll",
          operation: "runRegenerateExcludeConfig",
          projectRoot: args.projectRoot,
        });
      }
    }
  };
  deps.startTranscriptIngestionWithGetter(getRepoScopeConfig);
  deps.startContinualLearningWithGetter(getRepoScopeConfig);
  deps.startGitPollerWithGetters(getRepoScopeConfig, setRepoScopeConfig, onTick);
}

export function runPostActivationWorkflowProcessorsPhase(
  deps: IPostActivationEventSourcesDeps
): void {
  const {
    repoScopeConfigRef,
    repoScopeConfigForPhases,
    staleSweepIntervalMs,
    staleSweepIntervalRef,
  } = deps;
  const getRepoScopeConfig = (): IRepoScopeConfig =>
    repoScopeConfigRef.current ?? repoScopeConfigForPhases;

  runEventSourcesPhase({
    startEventSources: () => deps.ensureDirsAndRecoveryWithGetter(getRepoScopeConfig),
    runStaleImplementingSweep: () =>
      deps.runStaleImplementingSweepWithGetter(() => repoScopeConfigRef.current ?? null),
    startWorkers: () => deps.startWorkersWithConfig(repoScopeConfigRef.current),
    logDisabledWorkflows: () => deps.logDisabledWorkflowsWithConfig(repoScopeConfigRef.current),
    staleSweepIntervalMs,
    staleSweepIntervalRef,
  });
}
