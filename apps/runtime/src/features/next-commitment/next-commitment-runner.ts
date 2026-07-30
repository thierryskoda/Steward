import { existsSync, mkdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { execPath } from "node:process";
import { AppError, isAppError } from "../../core/app-error.js";
import { ensureAgentRunTmpDir, removeAgentRunTmpDir } from "../../core/agent-tmp-dir.js";
import { ERR_AGENT_CLI_CONTRACT } from "../../core/error-codes.js";
import { collectRequiredGitSnapshot } from "../../core/git/git-snapshot.js";
import type { ILLMProvider } from "../../core/llm/llm-provider.types.js";
import { runSchemaConstrainedAgentWithProvider } from "../../core/llm/run-structured.agent.js";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import { snapshotRecentProjectTasks } from "../../core/sources/codex/recent-project-task-snapshots.js";
import { discoverRecentProjectTasks } from "../../core/sources/codex/recent-project-tasks.js";
import { nextCommitmentAgent } from "./next-commitment.agent.js";
import {
  assertNextCommitmentResultProvenance,
  validateConfiguredContextPatterns,
} from "./next-commitment-evidence.js";
import {
  NEXT_COMMITMENT_RUN_COMPLETED,
  NEXT_COMMITMENT_RUN_FAILED,
  NEXT_COMMITMENT_RUN_QUEUED,
  NEXT_COMMITMENT_RUN_STARTED,
  NEXT_COMMITMENT_RUN_SUPERSEDED,
} from "./next-commitment-log-events.js";
import type { INextCommitmentRun } from "./next-commitment.schemas.js";
import {
  NEXT_COMMITMENT_RECENT_TASK_LOOKBACK_DAYS,
  NEXT_COMMITMENT_RECENT_TASK_MANIFEST_LIMIT,
} from "./next-commitment-limits.js";
import {
  getNextCommitmentEvidenceBrokerEntryPath,
  NEXT_COMMITMENT_EVIDENCE_BROKER_SERVER_NAME,
  NEXT_COMMITMENT_EVIDENCE_TOOL_NAMES,
  prepareNextCommitmentEvidenceBroker,
  readNextCommitmentEvidenceAudit,
} from "./next-commitment-evidence-broker.js";
import {
  assertNextCommitmentRunRootSupported,
  assertNextCommitmentReviewProjectRootSupported,
  createNextCommitmentReviewWorkspace,
  findContainingTemporaryRoot,
} from "./next-commitment-review-workspace.js";
import {
  claimNextCommitmentRun,
  completeNextCommitmentRun,
  createOrGetActiveNextCommitmentRun,
  failNextCommitmentRun,
  findNextCommitmentRunById,
  getLatestNextCommitmentRun,
  supersedeNextCommitmentRecommendation,
  supersedeNextCommitmentRun,
} from "./next-commitment-store.js";

const NEXT_COMMITMENT_WALL_TIME_MS = 9 * 60 * 1_000 + 45 * 1_000;
const ISOLATED_AUTH_MAX_BYTES = 64 * 1024;

type INextCommitmentRunnerDeps = {
  projectRoot: string;
  codexHome: string;
  llmProvider: ILLMProvider;
  getConfiguredContextPatterns: () => string[];
  shouldContinue: () => boolean;
  now?: () => number;
};

export type INextCommitmentRunner = {
  getLatestCurrent: () => INextCommitmentRun | null;
  queue: () => { run: INextCommitmentRun; created: boolean };
  process: (runId: string) => Promise<INextCommitmentRun>;
  start: () => INextCommitmentRun;
};

function failureReason(error: unknown): string {
  if (isAppError(error)) return error.code;
  return "unexpected_error";
}

export function createIsolatedCodexHome(args: {
  sourceCodexHome: string;
  runRoot: string;
}): string {
  const sourceAuthPath = join(args.sourceCodexHome, "auth.json");
  const isolatedCodexHome = join(args.runRoot, "codex-home");
  mkdirSync(isolatedCodexHome, { recursive: true, mode: 0o700 });
  if (!existsSync(sourceAuthPath)) {
    if (process.env.OPENAI_API_KEY !== undefined || process.env.CODEX_API_KEY !== undefined) {
      return isolatedCodexHome;
    }
    throw new AppError(
      "Project-isolated Codex review requires an authenticated Codex installation.",
      ERR_AGENT_CLI_CONTRACT,
      { reason: "isolated_codex_auth_missing", sourceAuthPath }
    );
  }
  try {
    const resolvedAuthPath = realpathSync(sourceAuthPath);
    const temporaryRoot = findContainingTemporaryRoot(resolvedAuthPath);
    if (temporaryRoot !== undefined) {
      throw new Error(`Codex auth path is under an unsafe temporary root: ${temporaryRoot}`);
    }
    const authStat = statSync(resolvedAuthPath);
    if (!authStat.isFile() || authStat.size > ISOLATED_AUTH_MAX_BYTES) {
      throw new Error("Codex auth path is not a bounded regular file");
    }
    symlinkSync(resolvedAuthPath, join(isolatedCodexHome, "auth.json"));
  } catch (error) {
    throw new AppError(
      "Project-isolated Codex review could not prepare isolated authentication.",
      ERR_AGENT_CLI_CONTRACT,
      { reason: "isolated_codex_auth_invalid", sourceAuthPath },
      { cause: error }
    );
  }
  return isolatedCodexHome;
}

export function createNextCommitmentRunner(deps: INextCommitmentRunnerDeps): INextCommitmentRunner {
  const now = deps.now ?? Date.now;

  function getLatestCurrent(): INextCommitmentRun | null {
    const latest = getLatestNextCommitmentRun();
    if (latest === null || latest.status !== "recommendation") return latest;

    const currentSnapshot = collectRequiredGitSnapshot(deps.projectRoot);
    if (currentSnapshot.hash === latest.projectSnapshotHash) return latest;

    const superseded = supersedeNextCommitmentRecommendation({
      id: latest.id,
      stopReason: "project_changed_before_codex_handoff",
      now: now(),
    });
    getRuntimeLogger().info({
      event: NEXT_COMMITMENT_RUN_SUPERSEDED,
      runId: latest.id,
      phase: "before_codex_handoff",
      projectRoot: deps.projectRoot,
      expectedProjectSnapshotHash: latest.projectSnapshotHash,
      actualProjectSnapshotHash: currentSnapshot.hash,
    });
    return superseded;
  }

  function queue(): { run: INextCommitmentRun; created: boolean } {
    assertNextCommitmentReviewProjectRootSupported(deps.projectRoot);
    const snapshot = collectRequiredGitSnapshot(deps.projectRoot);
    const queued = createOrGetActiveNextCommitmentRun({
      headSha: snapshot.headSha,
      projectSnapshotHash: snapshot.hash,
      now: now(),
    });
    if (queued.created) {
      getRuntimeLogger().info({
        event: NEXT_COMMITMENT_RUN_QUEUED,
        runId: queued.run.id,
        projectRoot: deps.projectRoot,
        projectSnapshotHash: snapshot.hash,
      });
    }
    return queued;
  }

  async function process(runId: string): Promise<INextCommitmentRun> {
    const claimed = claimNextCommitmentRun({ id: runId, now: now() });
    getRuntimeLogger().info({
      event: NEXT_COMMITMENT_RUN_STARTED,
      runId,
      projectRoot: deps.projectRoot,
    });

    let runRoot: string | null = null;
    try {
      const currentSnapshot = collectRequiredGitSnapshot(deps.projectRoot);
      if (currentSnapshot.hash !== claimed.projectSnapshotHash) {
        const superseded = supersedeNextCommitmentRun({
          id: runId,
          stopReason: "project_changed_before_review",
          now: now(),
        });
        getRuntimeLogger().info({
          event: NEXT_COMMITMENT_RUN_SUPERSEDED,
          runId,
          phase: "before_review",
        });
        return superseded;
      }
      if (!deps.shouldContinue()) {
        return failNextCommitmentRun({ id: runId, stopReason: "runtime_stopping", now: now() });
      }

      runRoot = ensureAgentRunTmpDir(deps.projectRoot, `next-commitment-${runId}`);
      assertNextCommitmentRunRootSupported({ projectRoot: deps.projectRoot, runRoot });
      const capturedAt = now();
      const discovery = discoverRecentProjectTasks({
        codexHome: deps.codexHome,
        projectRoot: deps.projectRoot,
        capturedAt,
        lookbackDays: NEXT_COMMITMENT_RECENT_TASK_LOOKBACK_DAYS,
        maxTasks: NEXT_COMMITMENT_RECENT_TASK_MANIFEST_LIMIT,
      });
      const reviewWorkspace = createNextCommitmentReviewWorkspace({
        projectRoot: deps.projectRoot,
        runRoot,
        projectSnapshot: currentSnapshot,
      });
      const taskSnapshots = await snapshotRecentProjectTasks({
        tasks: discovery.tasks,
        projectRoot: deps.projectRoot,
        outputDir: reviewWorkspace.evidenceDir,
      });
      const manifestPath = join(reviewWorkspace.evidenceDir, "recent-codex-tasks.json");
      const manifest = {
        schemaVersion: 1,
        projectRoot: deps.projectRoot,
        capturedAt,
        selection: {
          lookbackDays: NEXT_COMMITMENT_RECENT_TASK_LOOKBACK_DAYS,
          maxTasks: NEXT_COMMITMENT_RECENT_TASK_MANIFEST_LIMIT,
          manifestTaskCount: taskSnapshots.length,
          eligibleTaskCount: discovery.eligibleTaskCount,
          truncated: discovery.truncated,
          scanTruncated: discovery.scanTruncated,
        },
        tasks: taskSnapshots.map(({ snapshotPath, ...task }) => ({
          ...task,
          snapshotFile: basename(snapshotPath),
        })),
      } as const;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      const isolatedCodexHome = createIsolatedCodexHome({
        sourceCodexHome: deps.codexHome,
        runRoot,
      });
      const evidenceBroker = prepareNextCommitmentEvidenceBroker({
        workspacePath: reviewWorkspace.workspacePath,
        evidenceDir: reviewWorkspace.evidenceDir,
        includedProjectPaths: reviewWorkspace.includedPaths,
      });

      const snapshotAfterCapture = collectRequiredGitSnapshot(deps.projectRoot);
      if (snapshotAfterCapture.hash !== claimed.projectSnapshotHash) {
        const superseded = supersedeNextCommitmentRun({
          id: runId,
          stopReason: "project_changed_during_capture",
          now: now(),
        });
        getRuntimeLogger().info({
          event: NEXT_COMMITMENT_RUN_SUPERSEDED,
          runId,
          phase: "during_capture",
        });
        return superseded;
      }

      const result = await runSchemaConstrainedAgentWithProvider({
        agent: nextCommitmentAgent,
        input: {
          projectRoot: deps.projectRoot,
          capturedAt,
          projectSnapshot: {
            headSha: claimed.headSha,
            worktreeHash: claimed.projectSnapshotHash,
          },
          reviewSnapshot: {
            workspacePath: reviewWorkspace.workspacePath,
            gitStatePath: reviewWorkspace.gitStatePath,
            includedFileCount: reviewWorkspace.includedFileCount,
            excludedFileCount: Object.values(reviewWorkspace.excludedCounts).reduce(
              (total, count) => total + count,
              0
            ),
            truncated: reviewWorkspace.truncated,
          },
          configuredContextPatterns: validateConfiguredContextPatterns({
            projectRoot: deps.projectRoot,
            patterns: deps.getConfiguredContextPatterns(),
          }),
          recentTasks: {
            manifestPath,
            lookbackDays: NEXT_COMMITMENT_RECENT_TASK_LOOKBACK_DAYS,
            manifestTaskCount: taskSnapshots.length,
            eligibleTaskCount: discovery.eligibleTaskCount,
            truncated: discovery.truncated,
            scanTruncated: discovery.scanTruncated,
          },
        },
        workspace: reviewWorkspace.workspacePath,
        resumeChatId: undefined,
        llmProvider: deps.llmProvider,
        isolatedCodexHome,
        readOnlyMcpServer: {
          name: NEXT_COMMITMENT_EVIDENCE_BROKER_SERVER_NAME,
          command: execPath,
          args: [getNextCommitmentEvidenceBrokerEntryPath(), evidenceBroker.configPath],
          cwd: reviewWorkspace.workspacePath,
          enabledTools: [...NEXT_COMMITMENT_EVIDENCE_TOOL_NAMES],
        },
        deadlineAt: Date.now() + NEXT_COMMITMENT_WALL_TIME_MS,
      });

      if (!deps.shouldContinue()) {
        return failNextCommitmentRun({ id: runId, stopReason: "runtime_stopping", now: now() });
      }
      const finalSnapshot = collectRequiredGitSnapshot(deps.projectRoot);
      if (finalSnapshot.hash !== claimed.projectSnapshotHash) {
        const superseded = supersedeNextCommitmentRun({
          id: runId,
          stopReason: "project_changed_during_review",
          now: now(),
        });
        getRuntimeLogger().info({
          event: NEXT_COMMITMENT_RUN_SUPERSEDED,
          runId,
          phase: "during_review",
        });
        return superseded;
      }
      const evidenceAudit = readNextCommitmentEvidenceAudit(evidenceBroker.auditPath);
      assertNextCommitmentResultProvenance({
        result,
        projectRoot: deps.projectRoot,
        manifestTaskIds: taskSnapshots.map((task) => task.id),
        reviewedProjectPaths: reviewWorkspace.includedPaths,
        exposedProjectPaths: evidenceAudit.projectPaths,
        exposedTaskIds: evidenceAudit.taskIds,
        projectStateInspected: evidenceAudit.projectStateInspected,
        taskManifestInspected: evidenceAudit.taskManifestInspected,
      });

      const snapshotBeforePersistence = collectRequiredGitSnapshot(deps.projectRoot);
      if (snapshotBeforePersistence.hash !== claimed.projectSnapshotHash) {
        const superseded = supersedeNextCommitmentRun({
          id: runId,
          stopReason: "project_changed_during_review",
          now: now(),
        });
        getRuntimeLogger().info({
          event: NEXT_COMMITMENT_RUN_SUPERSEDED,
          runId,
          phase: "during_review",
        });
        return superseded;
      }

      const completed = completeNextCommitmentRun({ id: runId, result, now: now() });
      getRuntimeLogger().info({
        event: NEXT_COMMITMENT_RUN_COMPLETED,
        runId,
        status: completed.status,
      });
      return completed;
    } catch (error) {
      const current = findNextCommitmentRunById(runId);
      if (current?.status === "running") {
        const failed = failNextCommitmentRun({
          id: runId,
          stopReason: failureReason(error),
          now: now(),
        });
        logError(error, {
          event: NEXT_COMMITMENT_RUN_FAILED,
          component: "next-commitment",
          operation: "process",
          runId,
          stopReason: failed.stopReason,
        });
        return failed;
      }
      throw error;
    } finally {
      if (runRoot !== null) removeAgentRunTmpDir(runRoot);
    }
  }

  function start(): INextCommitmentRun {
    const queued = queue();
    if (queued.created) {
      void Promise.resolve()
        .then(() => process(queued.run.id))
        .catch((error: unknown) => {
          logError(error, {
            event: NEXT_COMMITMENT_RUN_FAILED,
            component: "next-commitment",
            operation: "background_process",
            runId: queued.run.id,
          });
        });
    }
    return queued.run;
  }

  return { getLatestCurrent, queue, process, start };
}
