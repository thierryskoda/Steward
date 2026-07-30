import { describe, expect, it, vi } from "vitest";
import {
  runPostActivationScanningSourcesPhase,
  runPostActivationWorkflowProcessorsPhase,
  type IPostActivationEventSourcesDeps,
} from "./activation-lifecycle.js";
import type { IRepoScopeConfig } from "../features/context/repo-scope-config.js";
import { CONFIG_SCHEMA_VERSION } from "../features/config/project-config-store.js";
import { APPROVAL_MODE_ALWAYS_APPROVE } from "@steward/contracts/schemas";
import type { IGitPollerOnTickArgs } from "../core/git/git-poll-tick.js";

vi.mock("../core/project-root.js", () => ({
  getProjectRoot: () => "/tmp/cto-runtime-lifecycle-test",
}));

vi.mock("../core/state.js", () => ({
  updateRuntimeState: vi.fn(),
}));

vi.mock("../core/logger.js", () => ({
  getRuntimeLogger: () => ({ info: vi.fn() }),
  logError: vi.fn(),
}));

const repoScopeConfig = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
  ruleSources: [],
  approvalMode: APPROVAL_MODE_ALWAYS_APPROVE,
  projectContext: [],
  features: {
    rulesWorkflowEnabled: true,
    continualLearningEnabled: true,
    genericFindingEnabled: true,
    optionHintsEnabled: true,
  },
} satisfies IRepoScopeConfig;

function createDeps(): IPostActivationEventSourcesDeps {
  const staleSweepIntervalRef = { current: null as ReturnType<typeof setInterval> | null };
  return {
    repoScopeConfigRef: { current: repoScopeConfig },
    repoScopeConfigForPhases: repoScopeConfig,
    seenIds: new Set<string>(),
    checkpointStore: {
      get: vi.fn(),
      set: vi.fn(),
    },
    transcriptIngestionServiceRef: { current: null },
    gitPollStopRef: { current: null },
    continualLearningIdleByPath: new Map(),
    continualLearningIntervalRef: { current: null },
    ruleApplyWorkerIntervalRef: { current: null },
    staleSweepIntervalRef,
    staleSweepIntervalMs: 60_000,
    startTranscriptIngestionWithGetter: vi.fn(),
    startContinualLearningWithGetter: vi.fn(),
    startGitPollerWithGetters: vi.fn(),
    ensureDirsAndRecoveryWithGetter: vi.fn(),
    runStaleImplementingSweepWithGetter: vi.fn(),
    startWorkersWithConfig: vi.fn(),
    logDisabledWorkflowsWithConfig: vi.fn(),
    ensureRulesSnapshot: vi.fn(),
    ensureProjectContextSnapshot: vi.fn(),
    runDocumentationRefresh: vi.fn(),
    recoverDocumentationRefreshRuns: vi.fn(),
  };
}

describe("activation lifecycle resource scopes", () => {
  it("starts scanning sources without starting workflow processors", () => {
    const deps = createDeps();

    runPostActivationScanningSourcesPhase(deps);

    expect(deps.startTranscriptIngestionWithGetter).toHaveBeenCalledOnce();
    expect(deps.startContinualLearningWithGetter).toHaveBeenCalledOnce();
    expect(deps.startGitPollerWithGetters).toHaveBeenCalledOnce();
    expect(deps.ensureDirsAndRecoveryWithGetter).not.toHaveBeenCalled();
    expect(deps.runStaleImplementingSweepWithGetter).not.toHaveBeenCalled();
    expect(deps.startWorkersWithConfig).not.toHaveBeenCalled();
  });

  it("starts workflow processors without starting scanning sources", () => {
    const deps = createDeps();

    runPostActivationWorkflowProcessorsPhase(deps);
    if (deps.staleSweepIntervalRef.current) {
      clearInterval(deps.staleSweepIntervalRef.current);
    }

    expect(deps.ensureDirsAndRecoveryWithGetter).toHaveBeenCalledOnce();
    expect(deps.recoverDocumentationRefreshRuns).toHaveBeenCalledOnce();
    expect(deps.runStaleImplementingSweepWithGetter).toHaveBeenCalledOnce();
    expect(deps.startWorkersWithConfig).toHaveBeenCalledWith(repoScopeConfig);
    expect(deps.logDisabledWorkflowsWithConfig).toHaveBeenCalledWith(repoScopeConfig);
    expect(deps.startTranscriptIngestionWithGetter).not.toHaveBeenCalled();
    expect(deps.startContinualLearningWithGetter).not.toHaveBeenCalled();
    expect(deps.startGitPollerWithGetters).not.toHaveBeenCalled();
  });

  it("refreshes project-context snapshots from the raw change batch even when generic filtering removed the path", async () => {
    const deps = createDeps();
    const configWithProjectContext: IRepoScopeConfig = {
      ...repoScopeConfig,
      projectContext: ["AGENTS.md"],
      features: {
        ...repoScopeConfig.features,
        genericFindingEnabled: false,
      },
    };
    deps.repoScopeConfigRef.current = configWithProjectContext;
    deps.repoScopeConfigForPhases = configWithProjectContext;
    runPostActivationScanningSourcesPhase(deps);
    const startCall = vi.mocked(deps.startGitPollerWithGetters).mock.calls[0];
    const onTick = startCall?.[2];
    expect(onTick).toBeDefined();
    if (onTick === undefined) return;
    const tick: IGitPollerOnTickArgs = {
      projectRoot: "/tmp/cto-runtime-lifecycle-test",
      config: configWithProjectContext,
      changeBatch: Object.freeze({
        fingerprint: "fingerprint",
        changedPaths: Object.freeze(["AGENTS.md"]),
        snapshot: Object.freeze({
          hash: "fingerprint",
          headSha: "abc",
          entries: Object.freeze([
            Object.freeze({
              path: "AGENTS.md",
              status: "M" as const,
              contentFingerprint: "context-content",
            }),
          ]),
        }),
      }),
      genericChangedPaths: [],
      shouldRegenExclude: false,
      hasReactiveWork: false,
      hasProactiveWork: true,
    };

    await onTick(tick);

    expect(deps.runDocumentationRefresh).toHaveBeenCalledWith(tick.changeBatch);

    expect(deps.ensureRulesSnapshot).toHaveBeenCalledWith(
      "/tmp/cto-runtime-lifecycle-test",
      configWithProjectContext
    );
    expect(deps.ensureProjectContextSnapshot).toHaveBeenCalledWith(
      "/tmp/cto-runtime-lifecycle-test",
      configWithProjectContext
    );
  });
});
