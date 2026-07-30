import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert";
import { DEFAULT_APPROVAL_MODE } from "@steward/contracts/schemas";
import type { IGitDeltaFile } from "./git-delta.js";
import { collectGitSnapshot, type IGitSnapshot } from "./git-snapshot.js";
import { createGitPoller, type IGitPollerOnTickArgs } from "./git-poll-tick.js";

vi.mock("../logger.js", () => ({ getRuntimeLogger: () => mockLogger }));

const STABLE_HASH = "stable-hash";
const STABLE_SNAPSHOT: IGitSnapshot = {
  hash: STABLE_HASH,
  headSha: "abc",
  entries: [],
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => mockLogger),
};

const defaultEnv = {
  CTO_GENERIC_FINDING_ENABLED: true,
  CTO_REGENERATE_CONFIG_ON_GIT_POLL: false,
  CTO_GIT_POLL_QUIET_WINDOW_MS: 60_000,
};

vi.mock("./git-snapshot.js", () => ({
  collectGitSnapshot: vi.fn(() => STABLE_SNAPSHOT),
}));

vi.mock("../env.js", () => ({
  loadEnv: vi.fn(() => defaultEnv),
}));

function defaultDeps(
  overrides: Partial<{
    onTick: (args: IGitPollerOnTickArgs) => Promise<void>;
    buildGitDeltaWithConfig: () => IGitDeltaFile[];
  }> = {}
) {
  const defaultOnTick = async (): Promise<void> => {};
  return {
    intervalMs: 12000,
    getProjectRoot: () => "/tmp/test",
    getRepoScopeConfig: () => ({
      ruleSources: [],
      approvalMode: DEFAULT_APPROVAL_MODE,
      projectContext: [],
      features: {
        genericFindingEnabled: true,
        rulesWorkflowEnabled: false,
        continualLearningEnabled: false,
        optionHintsEnabled: false,
      },
    }),
    setRepoScopeConfig: () => {},
    buildGitDeltaWithConfig: (): IGitDeltaFile[] => overrides.buildGitDeltaWithConfig?.() ?? [],
    onTick: overrides.onTick ?? defaultOnTick,
  };
}

describe("createGitPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    vi.mocked(mockLogger.info).mockClear();
    vi.mocked(collectGitSnapshot).mockReturnValue(STABLE_SNAPSHOT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("proactive finding runs only after 60s quiet (same hash) and again on next interval", async () => {
    const proactiveRuns: number[] = [];
    const deps = defaultDeps({
      onTick: async (args) => {
        if (args.hasProactiveWork) proactiveRuns.push(1);
      },
    });
    const poller = createGitPoller(deps);

    poller.tickNow();
    assert.strictEqual(proactiveRuns.length, 0, "first tick: hash new, no run");

    vi.advanceTimersByTime(60_000);
    poller.tickNow();
    await vi.runAllTimersAsync();
    assert.strictEqual(proactiveRuns.length, 1, "second tick: quiet, proactive runs once");

    vi.advanceTimersByTime(60_000);
    poller.tickNow();
    await vi.runAllTimersAsync();
    assert.strictEqual(proactiveRuns.length, 2, "third tick: quiet again, proactive runs again");
  });

  it("reactive work runs once per hash and not again for same hash; proactive still runs every 60s", async () => {
    const reactiveRuns: number[] = [];
    const proactiveRuns: number[] = [];
    const deps = defaultDeps({
      onTick: async (args) => {
        if (args.hasReactiveWork) reactiveRuns.push(1);
        if (args.hasProactiveWork) proactiveRuns.push(1);
      },
      buildGitDeltaWithConfig: (): IGitDeltaFile[] => [
        {
          path: "foo.ts",
          status: "M",
          isUntracked: false,
          isBinary: false,
          added: 0,
          deleted: 0,
          patch: null,
        },
      ],
    });
    const poller = createGitPoller(deps);

    poller.tickNow();
    vi.advanceTimersByTime(60_000);
    poller.tickNow();
    await vi.runAllTimersAsync();
    assert.strictEqual(reactiveRuns.length, 1, "reactive run once on first quiet tick");

    vi.advanceTimersByTime(60_000);
    poller.tickNow();
    await vi.runAllTimersAsync();
    assert.strictEqual(reactiveRuns.length, 1, "reactive not run again for same hash");
    assert.strictEqual(proactiveRuns.length, 2, "proactive still runs every 60s");
  });

  it("emits one immutable raw change batch before generic consumer filtering", async () => {
    const snapshot: IGitSnapshot = {
      hash: "content-aware-fingerprint",
      headSha: "def",
      entries: [
        {
          path: "src/feature.ts",
          status: "M",
          contentFingerprint: "source-content",
        },
        {
          path: "AGENTS.md",
          status: "M",
          contentFingerprint: "context-content",
        },
      ],
    };
    vi.mocked(collectGitSnapshot).mockReturnValue(snapshot);
    let received: IGitPollerOnTickArgs | undefined;
    const deps = defaultDeps({
      onTick: async (args) => {
        received = args;
      },
      buildGitDeltaWithConfig: (): IGitDeltaFile[] => [
        {
          path: "src/feature.ts",
          status: "M",
          isUntracked: false,
          isBinary: false,
          added: 1,
          deleted: 0,
          patch: "new source",
        },
      ],
    });
    const poller = createGitPoller(deps);

    poller.tickNow();
    vi.advanceTimersByTime(60_000);
    poller.tickNow();
    await vi.runAllTimersAsync();

    assert.ok(received !== undefined);
    assert.strictEqual(received.changeBatch.fingerprint, snapshot.hash);
    assert.deepStrictEqual(received.changeBatch.changedPaths, ["src/feature.ts", "AGENTS.md"]);
    assert.deepStrictEqual(received.genericChangedPaths, ["src/feature.ts"]);
    assert.strictEqual(received.changeBatch.snapshot.headSha, "def");
    assert.strictEqual(Object.isFrozen(received.changeBatch), true);
    assert.strictEqual(Object.isFrozen(received.changeBatch.changedPaths), true);
    assert.strictEqual(Object.isFrozen(received.changeBatch.snapshot), true);
    assert.strictEqual(Object.isFrozen(received.changeBatch.snapshot.entries), true);
  });
});
