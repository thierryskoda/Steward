/**
 * Event-sources lifecycle: transcript ingestion, continual learning, git poller,
 * recovery, stale sweep, workers, disabled-workflow logging.
 * Used by activation-lifecycle when building the post-activation phase.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadEnv } from "../core/env.js";
import { getProjectRoot } from "../core/project-root.js";
import { getRuntimeLogger } from "../core/logger.js";
import type { CheckpointStore } from "../core/sources/types.js";
import {
  createTranscriptIngestionService,
  type ITranscriptIngestionService,
} from "../core/sources/transcript-ingestion-service.js";
import { buildGitDelta } from "../core/git/git-delta.js";
import {
  createGitPoller,
  type IGitPollerDeps,
  type IGitPollerOnTickArgs,
  type IGitPollerRepoScopeConfig,
} from "../core/git/git-poll-tick.js";
import { cleanupStaleAgentRunDirs } from "../core/agent-tmp-dir.js";
import {
  TRANSCRIPT_INGESTION_SKIPPED_NO_FEATURES,
  WORKFLOW_DISABLED_BY_CONFIG,
} from "../core/runtime-log-events.js";
import { getActionableCategories } from "../features/categories/category-registry.js";
import {
  recoverInterruptedFindingsOnStartup,
  recoverInterruptedFindingsForCategory,
} from "../features/categories/categories-store.js";
import {
  getFeatureFlags,
  getIgnoreMatcher,
  getProjectContextSources,
  getRuleSources,
  pathMatchesProjectContext,
  type IRepoScopeConfig,
} from "../features/context/repo-scope-config.js";
import { readSourceDocs } from "../features/categories/rules-snapshot.js";
import {
  findTranscriptPaths,
  cursorProjectDirFromRoot,
} from "../features/context/project-context-builder.js";
import { createRulesTranscriptSubscriber } from "../features/rules/transcript-subscriber.js";
import { createRuleCaptureAgentRunner } from "../features/rules/rule-capture.js";
import {
  createContinualLearningRunner,
  type IProjectContextTarget,
} from "../features/continual-learning/run-continual-learning.js";
import type { IContinualLearningIdleState } from "../features/continual-learning/continual-learning.types.js";
import { CONTINUAL_LEARNING_DISABLED_BY_CONFIG } from "../features/continual-learning/continual-learning-log-events.js";
import {
  recoverInterruptedRulesOnStartup,
  recoverInterruptedRules,
} from "../features/rules/rules-store.js";
import { startRuleApplyWorker } from "../features/rules/rule-apply-worker.js";
import { startRejectedFindingLearningProcessor } from "../features/rules/rejected-finding-learning-processor.js";
import { RULE_APPLY_WORKER_STARTED } from "../features/rules/rules-log-events.js";
import { IMPLEMENTING_MAX_RETRIES } from "../features/workflow/implementing-policy.js";
import { startFindingImplementationWorker } from "../features/categories/finding-implementation-worker.js";
import type { IProcessCategoryImplementingDeps } from "../features/categories/category-implementing-processor.js";

const GIT_POLL_INTERVAL_MS = 12000;

export function startTranscriptIngestion(
  seenIds: Set<string>,
  checkpointStore: CheckpointStore,
  transcriptIngestionServiceRef: { current: ITranscriptIngestionService | null },
  getRepoScopeConfig: () => IRepoScopeConfig
): void {
  const env = loadEnv();
  const featureFlags = getFeatureFlags(getRepoScopeConfig());
  if (!featureFlags.rulesWorkflowEnabled && !featureFlags.continualLearningEnabled) {
    getRuntimeLogger().info({
      event: TRANSCRIPT_INGESTION_SKIPPED_NO_FEATURES,
    });
    return;
  }
  const getRuleSourcesContent = (projectRoot: string): string => {
    const config = getRepoScopeConfig();
    const sources = getRuleSources(config);
    const entries = readSourceDocs(projectRoot, sources);
    return entries.map((e) => e.content).join("\n\n---\n\n");
  };
  const rulesSubscriber = createRulesTranscriptSubscriber({
    projectRoot: getProjectRoot(),
    seenIds,
    createRuleCaptureAgentRunner,
    getRuleSourcesContent,
    getFeatureFlags: () => getFeatureFlags(getRepoScopeConfig()),
  });
  const ingestionService = createTranscriptIngestionService({
    getPaths: () =>
      findTranscriptPaths({
        projectRoot: getProjectRoot(),
        cursorProjectsRoot: env.CTO_CURSOR_PROJECTS_ROOT,
      }),
    checkpointStore,
    pollIntervalMs: env.CURSOR_POLL_INTERVAL_MS,
    subscribers: [rulesSubscriber],
  });
  transcriptIngestionServiceRef.current = ingestionService;
  ingestionService.start();
}

export function startContinualLearning(
  transcriptIngestionServiceRef: { current: ITranscriptIngestionService | null },
  continualLearningIdleByPath: Map<string, IContinualLearningIdleState>,
  continualLearningIntervalRef: { current: ReturnType<typeof setInterval> | null },
  getRepoScopeConfig: () => IRepoScopeConfig
): void {
  const featureFlags = getFeatureFlags(getRepoScopeConfig());
  if (!featureFlags.continualLearningEnabled) {
    getRuntimeLogger().info({
      event: CONTINUAL_LEARNING_DISABLED_BY_CONFIG,
      flag: "continualLearningEnabled",
    });
    return;
  }
  const env = loadEnv();
  const getProjectContextTargetFile = (projectRoot: string): IProjectContextTarget | null => {
    const config = getRepoScopeConfig();
    const sources = getProjectContextSources(config);
    if (sources.length === 0) return null;
    const firstRaw = sources[0];
    if (firstRaw === undefined) return null;
    const first = firstRaw.trim().replaceAll("\\", "/");
    if (!first) return null;
    const fullPath = join(projectRoot, first);
    if (!existsSync(fullPath)) return null;
    try {
      const content = readFileSync(fullPath, "utf-8");
      return { targetFilePath: first, content };
    } catch {
      return null;
    }
  };
  const runner = createContinualLearningRunner({
    projectRoot: getProjectRoot(),
    findTranscriptPaths,
    getStreamStateSnapshot: () =>
      transcriptIngestionServiceRef.current?.getStreamStateSnapshot() ?? new Map(),
    getProjectContextTargetFile,
    cursorProjectsRoot: env.CTO_CURSOR_PROJECTS_ROOT,
    idleMs: env.CTO_CONTINUAL_LEARNING_IDLE_MS,
    cursorProjectDirFromRoot,
  });
  continualLearningIntervalRef.current = setInterval(() => {
    void runner.tick({ idleByPath: continualLearningIdleByPath });
  }, 30_000);
}

export function startGitPollerFromMain(
  getRepoScopeConfig: () => IRepoScopeConfig,
  setRepoScopeConfig: (config: IGitPollerRepoScopeConfig) => void,
  gitPollStopRef: { current: (() => void) | null },
  onTick: (args: IGitPollerOnTickArgs) => Promise<void>
): void {
  const gitPollerDeps: IGitPollerDeps = {
    intervalMs: GIT_POLL_INTERVAL_MS,
    getProjectRoot,
    getRepoScopeConfig: () => {
      const c = getRepoScopeConfig();
      return {
        ruleSources: c.ruleSources,
        approvalMode: c.approvalMode,
        projectContext: c.projectContext,
        features: c.features,
      };
    },
    setRepoScopeConfig,
    buildGitDeltaWithConfig: (args) =>
      buildGitDelta(args.projectRoot, args.snapshot, {
        isExcluded: (path) =>
          getIgnoreMatcher(args.projectRoot)(path) || pathMatchesProjectContext(path, args.config),
      }),
    onTick,
  };
  const gitPoller = createGitPoller(gitPollerDeps);
  gitPollStopRef.current = gitPoller.stop;
  gitPoller.start();
}

export function ensureDirsAndRecovery(getRepoScopeConfig: () => IRepoScopeConfig): void {
  const AGENT_TMP_TTL_MS = 24 * 60 * 60 * 1000;
  cleanupStaleAgentRunDirs(AGENT_TMP_TTL_MS);
  for (const entry of getActionableCategories()) {
    recoverInterruptedFindingsOnStartup({ categoryId: entry.categoryId });
  }
  if (getFeatureFlags(getRepoScopeConfig()).rulesWorkflowEnabled) {
    recoverInterruptedRulesOnStartup(getProjectRoot());
  }
}

export function runStaleImplementingSweep(
  getRepoScopeConfig?: () => IRepoScopeConfig | null
): void {
  const projectRoot = getProjectRoot();
  const now = Date.now();
  const staleMs = loadEnv().CTO_IMPLEMENTING_STALE_MS;
  const categories = getActionableCategories();
  for (const entry of categories) {
    recoverInterruptedFindingsForCategory({
      projectRoot,
      categoryId: entry.categoryId,
      now,
      staleMs,
    });
  }
  const repoScopeConfig = getRepoScopeConfig?.() ?? null;
  if (repoScopeConfig && getFeatureFlags(repoScopeConfig).rulesWorkflowEnabled) {
    recoverInterruptedRules({
      projectRoot,
      staleMs,
      implementingMaxRetries: IMPLEMENTING_MAX_RETRIES,
      now,
    });
  }
}

export type ILogDisabledWorkflowsDeps = { repoScopeConfig: IRepoScopeConfig | null };

export function logDisabledWorkflows(deps: ILogDisabledWorkflowsDeps): void {
  if (deps.repoScopeConfig === null) return;
  const flags = getFeatureFlags(deps.repoScopeConfig);
  const projectRoot = getProjectRoot();
  if (!flags.rulesWorkflowEnabled) {
    getRuntimeLogger().info({
      event: WORKFLOW_DISABLED_BY_CONFIG,
      workflow: "rules",
      flag: "rulesWorkflowEnabled",
      projectRoot,
    });
  }
  if (!flags.genericFindingEnabled) {
    getRuntimeLogger().info({
      event: WORKFLOW_DISABLED_BY_CONFIG,
      workflow: "generic-finding",
      flag: "genericFindingEnabled",
      projectRoot,
    });
  }
}

export type IStartWorkersDeps = {
  repoScopeConfig: IRepoScopeConfig | null;
  processCategoryDeps: IProcessCategoryImplementingDeps;
  findingImplementationWorkerIntervalRef: { current: ReturnType<typeof setInterval> | null };
  ruleApplyWorkerIntervalRef: { current: ReturnType<typeof setInterval> | null };
  rejectedFindingLearningIntervalRef: { current: ReturnType<typeof setInterval> | null };
};

export function startWorkers(deps: IStartWorkersDeps): void {
  if (deps.repoScopeConfig === null) return;
  const flags = getFeatureFlags(deps.repoScopeConfig);
  if (flags.genericFindingEnabled) {
    deps.findingImplementationWorkerIntervalRef.current = startFindingImplementationWorker({
      deps: deps.processCategoryDeps,
      isGenericFindingEnabled: flags.genericFindingEnabled,
    });
  }
  if (flags.rulesWorkflowEnabled) {
    deps.ruleApplyWorkerIntervalRef.current = startRuleApplyWorker({
      implementingMaxRetries: IMPLEMENTING_MAX_RETRIES,
      isRulesWorkflowEnabled: flags.rulesWorkflowEnabled,
    });
    deps.rejectedFindingLearningIntervalRef.current = startRejectedFindingLearningProcessor({
      isRulesWorkflowEnabled: flags.rulesWorkflowEnabled,
    });
    getRuntimeLogger().info({ event: RULE_APPLY_WORKER_STARTED });
  }
}
