#!/usr/bin/env -S npx tsx
/**
 * Opt-in live proof for next-commitment quality against a real local project. It keeps probe
 * artifacts in the target's run-scoped .steward temp directory, runs the production isolated
 * prompt and schema read-only, rejects moving-project results, and removes its temp files.
 */
import "./load-env.js";
import { randomUUID } from "node:crypto";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureAgentRunTmpDir, removeAgentRunTmpDir } from "../src/core/agent-tmp-dir.js";
import { loadEnv } from "../src/core/env.js";
import { collectRequiredGitSnapshot } from "../src/core/git/git-snapshot.js";
import { createCodexCliLlmProvider } from "../src/core/llm/codex-cli-llm-provider.js";
import { convertZodSchemaToJsonSchema } from "../src/core/llm/zod-json-schema.js";
import { snapshotRecentProjectTasks } from "../src/core/sources/codex/recent-project-task-snapshots.js";
import { discoverRecentProjectTasks } from "../src/core/sources/codex/recent-project-tasks.js";
import { nextCommitmentAgent } from "../src/features/next-commitment/next-commitment.agent.js";
import {
  NEXT_COMMITMENT_RECENT_TASK_LOOKBACK_DAYS,
  NEXT_COMMITMENT_RECENT_TASK_MANIFEST_LIMIT,
} from "../src/features/next-commitment/next-commitment-limits.js";
import { assertNextCommitmentResultProvenance } from "../src/features/next-commitment/next-commitment-evidence.js";
import { createNextCommitmentReviewWorkspace } from "../src/features/next-commitment/next-commitment-review-workspace.js";
import { createIsolatedCodexHome } from "../src/features/next-commitment/next-commitment-runner.js";
import {
  NEXT_COMMITMENT_EVIDENCE_BROKER_SERVER_NAME,
  NEXT_COMMITMENT_EVIDENCE_TOOL_NAMES,
  prepareNextCommitmentEvidenceBroker,
  readNextCommitmentEvidenceAudit,
} from "../src/features/next-commitment/next-commitment-evidence-broker.js";
import {
  NextCommitmentAgentInputSchema,
  NextCommitmentAgentOutputSchema,
} from "../src/features/next-commitment/next-commitment.schemas.js";

const PROBE_TIMEOUT_MS = 9 * 60 * 1_000 + 45 * 1_000;

function requireProjectRoot(): string {
  const raw = process.argv[2];
  if (raw === undefined || raw.trim().length === 0) {
    throw new Error("Usage: pnpm agent:probe:next-commitment /absolute/path/to/project");
  }
  const projectRoot = resolve(raw);
  if (!isAbsolute(raw) || !statSync(projectRoot).isDirectory()) {
    throw new Error(`Next-commitment probe requires an existing absolute directory: ${raw}`);
  }
  return projectRoot;
}

function buildStructuredPrompt(projectPrompt: string): string {
  return `We only see your reply; we cannot see any files you create. Your entire reply must be the requested output and nothing else—no preamble, no summary, no path to a file. No markdown, no code blocks, no code fences.

Expected output (matching this shape):
${nextCommitmentAgent.outputContractDescription}

${projectPrompt}`;
}

async function main(): Promise<void> {
  const projectRoot = requireProjectRoot();
  const capturedAt = Date.now();
  const snapshot = collectRequiredGitSnapshot(projectRoot);
  const discovery = discoverRecentProjectTasks({
    codexHome: loadEnv().CODEX_HOME ?? join(homedir(), ".codex"),
    projectRoot,
    capturedAt,
    lookbackDays: NEXT_COMMITMENT_RECENT_TASK_LOOKBACK_DAYS,
    maxTasks: NEXT_COMMITMENT_RECENT_TASK_MANIFEST_LIMIT,
  });
  const requestId = randomUUID();
  const runRoot = ensureAgentRunTmpDir(projectRoot, requestId);

  try {
    const reviewWorkspace = createNextCommitmentReviewWorkspace({
      projectRoot,
      runRoot,
      projectSnapshot: snapshot,
    });
    const taskSnapshots = await snapshotRecentProjectTasks({
      tasks: discovery.tasks,
      projectRoot,
      outputDir: reviewWorkspace.evidenceDir,
    });
    const manifestPath = join(reviewWorkspace.evidenceDir, "recent-codex-tasks.json");
    writeFileSync(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          projectRoot,
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
        },
        null,
        2
      )}\n`,
      { encoding: "utf8", mode: 0o600 }
    );

    const input = NextCommitmentAgentInputSchema.parse({
      projectRoot,
      capturedAt,
      projectSnapshot: { headSha: snapshot.headSha, worktreeHash: snapshot.hash },
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
      configuredContextPatterns: [],
      recentTasks: {
        manifestPath,
        lookbackDays: NEXT_COMMITMENT_RECENT_TASK_LOOKBACK_DAYS,
        manifestTaskCount: taskSnapshots.length,
        eligibleTaskCount: discovery.eligibleTaskCount,
        truncated: discovery.truncated,
        scanTruncated: discovery.scanTruncated,
      },
    });
    const snapshotAfterCapture = collectRequiredGitSnapshot(projectRoot);
    if (snapshotAfterCapture.hash !== snapshot.hash) {
      throw new Error("Project changed while capturing the next-commitment review; rerun it.");
    }
    const isolatedCodexHome = createIsolatedCodexHome({
      sourceCodexHome: loadEnv().CODEX_HOME ?? join(homedir(), ".codex"),
      runRoot,
    });
    const evidenceBroker = prepareNextCommitmentEvidenceBroker({
      workspacePath: reviewWorkspace.workspacePath,
      evidenceDir: reviewWorkspace.evidenceDir,
      includedProjectPaths: reviewWorkspace.includedPaths,
    });
    const evidenceBrokerEntryPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../dist/src/features/next-commitment/next-commitment-evidence-broker.js"
    );
    if (!existsSync(evidenceBrokerEntryPath)) {
      throw new Error("Build @steward/runtime before running the next-commitment live probe.");
    }
    const agentTmpDir = ensureAgentRunTmpDir(reviewWorkspace.workspacePath, requestId);
    const provider = createCodexCliLlmProvider({ structuredSecurity: "project-isolated" });
    const result = await provider.runStructured({
      prompt: buildStructuredPrompt(nextCommitmentAgent.buildPrompt(input)),
      model: nextCommitmentAgent.model,
      workspace: reviewWorkspace.workspacePath,
      outputJsonSchema: convertZodSchemaToJsonSchema(NextCommitmentAgentOutputSchema),
      agentTmpDir,
      isolatedCodexHome,
      readOnlyMcpServer: {
        name: NEXT_COMMITMENT_EVIDENCE_BROKER_SERVER_NAME,
        command: process.execPath,
        args: [evidenceBrokerEntryPath, evidenceBroker.configPath],
        cwd: reviewWorkspace.workspacePath,
        enabledTools: [...NEXT_COMMITMENT_EVIDENCE_TOOL_NAMES],
      },
      requestId,
      deadlineAt: Date.now() + PROBE_TIMEOUT_MS,
    });
    if (!result.success) {
      throw new Error(
        `Codex next-commitment probe failed (${result.reason}): ${result.diagnosticText || result.outputText}`
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(result.outputText);
    } catch (error) {
      throw new Error("Codex next-commitment probe returned invalid JSON", { cause: error });
    }
    const decision = NextCommitmentAgentOutputSchema.parse(decoded);
    const evidenceAudit = readNextCommitmentEvidenceAudit(evidenceBroker.auditPath);
    assertNextCommitmentResultProvenance({
      result: decision,
      projectRoot,
      manifestTaskIds: taskSnapshots.map((task) => task.id),
      reviewedProjectPaths: reviewWorkspace.includedPaths,
      exposedProjectPaths: evidenceAudit.projectPaths,
      exposedTaskIds: evidenceAudit.taskIds,
      projectStateInspected: evidenceAudit.projectStateInspected,
      taskManifestInspected: evidenceAudit.taskManifestInspected,
    });
    const finalSnapshot = collectRequiredGitSnapshot(projectRoot);
    if (finalSnapshot.hash !== snapshot.hash) {
      throw new Error("Project changed during the next-commitment probe; discard and rerun it.");
    }
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  } finally {
    removeAgentRunTmpDir(runRoot);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
