import { collectGitSnapshot } from "./git-snapshot.js";
import { hasScopeStructureChanges, type IGitDeltaFile } from "./git-delta.js";
import type { IGitSnapshot } from "./git-snapshot.js";
import { getRuntimeLogger } from "../logger.js";
import { loadEnv } from "../env.js";
import type { ICoreFeatureFlags } from "../feature-flags.types.js";
import {
  GIT_POLL_COALESCED_RUN,
  GIT_POLL_QUIET_TRIGGER,
  GIT_POLL_SNAPSHOT_CHANGED,
  GIT_POLL_SKIPPED_INFLIGHT,
  GIT_POLL_SKIPPED_QUIET_WINDOW,
} from "../runtime-log-events.js";
import type { IApprovalMode } from "@steward/contracts/schemas";

function toBoundedSample<T>(values: readonly T[], limit: number): T[] {
  if (limit <= 0) return [];
  return values.slice(0, limit);
}

/** User config shape used by the git poller (exclude comes from generated file). */
export type IGitPollerRepoScopeConfig = {
  ruleSources: string[];
  approvalMode: IApprovalMode;
  projectContext: string[];
  features: ICoreFeatureFlags;
};

/** Args passed to the composition-root callback when a git poll tick has work to do. */
export type IGitPollerOnTickArgs = {
  projectRoot: string;
  config: IGitPollerRepoScopeConfig;
  changedPaths: string[];
  shouldRegenExclude: boolean;
  hasReactiveWork: boolean;
  hasProactiveWork: boolean;
};

export type IGitPollerDeps = {
  intervalMs: number;
  getProjectRoot: () => string;
  getRepoScopeConfig: () => IGitPollerRepoScopeConfig;
  setRepoScopeConfig: (config: IGitPollerRepoScopeConfig) => void;
  buildGitDeltaWithConfig: (args: {
    projectRoot: string;
    snapshot: IGitSnapshot;
    config: IGitPollerRepoScopeConfig;
  }) => IGitDeltaFile[];
  onTick: (args: IGitPollerOnTickArgs) => Promise<void>;
};

type IGitPoller = {
  start: () => void;
  stop: () => void;
  tickNow: () => void;
};

type IGitPollerState = {
  lastSeenHash: string | null;
  lastChangedAt: number;
  lastProcessedHashForReactive: string | null;
  lastProactiveRunAt: number;
  inFlight: boolean;
  pendingHash: string | null;
  intervalId: ReturnType<typeof setInterval> | null;
};

function runGitPollerTick(state: IGitPollerState, deps: IGitPollerDeps): void {
  const projectRoot = deps.getProjectRoot();
  const snapshot: IGitSnapshot = collectGitSnapshot(projectRoot);
  const now = Date.now();
  const log = getRuntimeLogger();
  const quietWindowMs = loadEnv().CTO_GIT_POLL_QUIET_WINDOW_MS;

  if (snapshot.hash !== state.lastSeenHash) {
    state.lastSeenHash = snapshot.hash;
    state.lastChangedAt = now;
    log.info({
      event: GIT_POLL_SNAPSHOT_CHANGED,
      gitSnapshotHash: snapshot.hash,
      entriesCount: snapshot.entries.length,
      changedPathsSample: toBoundedSample(
        snapshot.entries.map((entry) => entry.path),
        20
      ),
      changedAt: new Date(now).toISOString(),
      quietWindowMs,
    });
    return;
  }

  const quietElapsed = now - state.lastChangedAt >= quietWindowMs;
  if (!quietElapsed) {
    log.info({
      event: GIT_POLL_SKIPPED_QUIET_WINDOW,
      gitSnapshotHash: snapshot.hash,
      entriesCount: snapshot.entries.length,
      quietWindowMs,
      elapsedMs: now - state.lastChangedAt,
    });
    return;
  }

  if (state.inFlight) {
    state.pendingHash = snapshot.hash;
    log.info({
      event: GIT_POLL_SKIPPED_INFLIGHT,
      gitSnapshotHash: snapshot.hash,
      entriesCount: snapshot.entries.length,
    });
    return;
  }

  const config = deps.getRepoScopeConfig();
  const delta = deps.buildGitDeltaWithConfig({
    projectRoot,
    snapshot,
    config,
  });
  const changedPaths = delta.map((f) => f.path);
  const snapshotEntries = snapshot.entries;
  const shouldRegenExclude =
    loadEnv().CTO_REGENERATE_CONFIG_ON_GIT_POLL && hasScopeStructureChanges(snapshotEntries);

  const hasReactiveWork =
    changedPaths.length > 0 && snapshot.hash !== state.lastProcessedHashForReactive;
  const hasProactiveWork = now - state.lastProactiveRunAt >= quietWindowMs;

  if (!hasReactiveWork && !hasProactiveWork && !shouldRegenExclude) {
    return;
  }

  log.info({
    event: GIT_POLL_QUIET_TRIGGER,
    gitSnapshotHash: snapshot.hash,
    entriesCount: snapshot.entries.length,
    changedPathsSample: toBoundedSample(
      snapshot.entries.map((entry) => entry.path),
      20
    ),
    quietWindowMs,
    stableForMs: now - state.lastChangedAt,
    hasProactiveWork,
    hasReactiveWork,
  });

  state.inFlight = true;
  void runGitPollerTickWork(
    state,
    deps,
    snapshot,
    changedPaths,
    shouldRegenExclude,
    hasReactiveWork,
    hasProactiveWork
  );
}

async function runGitPollerTickWork(
  state: IGitPollerState,
  deps: IGitPollerDeps,
  snapshot: IGitSnapshot,
  changedPaths: string[],
  shouldRegenExclude: boolean,
  hasReactiveWork: boolean,
  hasProactiveWork: boolean
): Promise<void> {
  const log = getRuntimeLogger();
  const projectRoot = deps.getProjectRoot();
  const config = deps.getRepoScopeConfig();
  try {
    await deps.onTick({
      projectRoot,
      config,
      changedPaths,
      shouldRegenExclude,
      hasReactiveWork,
      hasProactiveWork,
    });
    if (hasReactiveWork) state.lastProcessedHashForReactive = snapshot.hash;
    if (hasProactiveWork) state.lastProactiveRunAt = Date.now();
  } finally {
    state.inFlight = false;
    if (state.pendingHash !== null) {
      const pendingHash = state.pendingHash;
      state.pendingHash = null;
      log.info({ event: GIT_POLL_COALESCED_RUN, gitSnapshotHash: pendingHash });
      scheduleNextGitPollerTick(state, deps);
    }
  }
}

function scheduleNextGitPollerTick(state: IGitPollerState, deps: IGitPollerDeps): void {
  setImmediate(() => runGitPollerTick(state, deps));
}

function startGitPoller(state: IGitPollerState, deps: IGitPollerDeps): void {
  if (state.intervalId !== null) return;
  state.intervalId = setInterval(() => runGitPollerTick(state, deps), deps.intervalMs);
}

function stopGitPoller(state: IGitPollerState): void {
  if (state.intervalId !== null) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
}

export function createGitPoller(deps: IGitPollerDeps): IGitPoller {
  const state: IGitPollerState = {
    lastSeenHash: null,
    lastChangedAt: 0,
    lastProcessedHashForReactive: null,
    lastProactiveRunAt: 0,
    inFlight: false,
    pendingHash: null,
    intervalId: null,
  };
  return {
    start: () => startGitPoller(state, deps),
    stop: () => stopGitPoller(state),
    tickNow: () => runGitPollerTick(state, deps),
  };
}
