#!/usr/bin/env -S npx tsx
/**
 * Opt-in live E2E for documentation freshness. It runs the real bounded workflow
 * against a temporary Git project, validates its persisted report and zero-write
 * boundary, then asks a separate Codex judge to grade the recommendation.
 */
import "./load-env.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  DOCUMENTATION_REFRESH_CATEGORY_ID,
  InboxFindingItemSchema,
  STATUS,
} from "@steward/contracts/schemas";
import { closeRuntimeDb, openRuntimeDb } from "../src/core/db/sqlite-connection.js";
import { clearRuntimeDb, setRuntimeDb } from "../src/core/db/runtime-db.js";
import { runSqliteMigrations } from "../src/core/db/sqlite-migrations.js";
import type { IProjectChangeBatch } from "../src/core/git/git-poll-tick.js";
import { collectGitSnapshot, type IGitSnapshot } from "../src/core/git/git-snapshot.js";
import { createCodexCliLlmProvider } from "../src/core/llm/codex-cli-llm-provider.js";
import { runSchemaConstrainedAgentWithProvider } from "../src/core/llm/run-structured.agent.js";
import { initRuntimeLogger } from "../src/core/logger.js";
import { getProjectKey } from "../src/core/project-key.js";
import {
  createFinding,
  deleteFindingById,
  listFindingsByStatuses,
  patchFindingFromAgent,
  saveFinding,
} from "../src/features/categories/categories-store.js";
import {
  DOCUMENTATION_REFRESH_E2E_JUDGE_ID,
  DOCUMENTATION_REFRESH_E2E_RUBRIC_VERSION,
  DOCUMENTATION_REFRESH_E2E_SCHEMA_VERSION,
  documentationRefreshE2eJudgeAgent,
} from "../src/features/documentation-refresh/documentation-refresh-e2e-judge.agent.js";
import { createDocumentationRefreshRunner } from "../src/features/documentation-refresh/documentation-refresh-runner.js";
import { DocumentationRefreshRunSchema } from "../src/features/documentation-refresh/documentation-refresh.schemas.js";

const SCENARIO_ID = "documentation-refresh-stale-command-v1";
const JUDGE_DEADLINE_MS = 5 * 60 * 1_000;
const README_CONTENT = `# Example service

Run \`pnpm start\` to launch the service.
`;
const PACKAGE_CONTENT = `${JSON.stringify(
  {
    name: "documentation-refresh-e2e-fixture",
    private: true,
    scripts: {
      dev: "node src/server.js",
      test: "node --test",
    },
  },
  null,
  2
)}\n`;
const SOURCE_CONTENT = "console.log('ready');\n";

const artifactSchema = z
  .object({
    scenarioId: z.literal(SCENARIO_ID),
    createdAt: z.string().datetime(),
    judge: z
      .object({
        id: z.literal(DOCUMENTATION_REFRESH_E2E_JUDGE_ID),
        rubricVersion: z.literal(DOCUMENTATION_REFRESH_E2E_RUBRIC_VERSION),
        schemaVersion: z.literal(DOCUMENTATION_REFRESH_E2E_SCHEMA_VERSION),
        provider: z.literal("codex_cli"),
        model: z.string().min(1),
        executionMode: z.literal("ask"),
        sandbox: z.literal("read-only"),
      })
      .strict(),
    evidence: documentationRefreshE2eJudgeAgent.inputSchema,
    workflowRun: DocumentationRefreshRunSchema,
    finding: InboxFindingItemSchema,
    verdict: documentationRefreshE2eJudgeAgent.outputSchema,
  })
  .strict();

function runGit(projectRoot: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
  });
  if (result.status === 0) return result.stdout.trim();
  throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
}

function createFixture(projectRoot: string): void {
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, ".gitignore"), ".steward/\n", "utf8");
  writeFileSync(join(projectRoot, "README.md"), README_CONTENT, "utf8");
  writeFileSync(join(projectRoot, "package.json"), PACKAGE_CONTENT, "utf8");
  writeFileSync(join(projectRoot, "src", "server.js"), SOURCE_CONTENT, "utf8");
  runGit(projectRoot, ["init", "--quiet"]);
  runGit(projectRoot, ["add", "-A"]);
  runGit(projectRoot, [
    "-c",
    "user.name=Steward E2E",
    "-c",
    "user.email=steward-e2e@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "documentation fixture",
  ]);
}

function toChangeBatch(snapshot: IGitSnapshot): IProjectChangeBatch {
  return Object.freeze({
    fingerprint: snapshot.hash,
    snapshot,
    changedPaths: Object.freeze(snapshot.entries.map((entry) => entry.path)),
  });
}

function writeJson(path: string, payload: unknown): void {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function locationsReferencePath(locations: string[], expectedPath: string): boolean {
  return locations.some(
    (location) => location === expectedPath || location.startsWith(`${expectedPath}:`)
  );
}

async function main(): Promise<number> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const runsRoot = join(repoRoot, ".steward", "tmp", "runs");
  mkdirSync(runsRoot, { recursive: true });
  const runRoot = mkdtempSync(join(runsRoot, "documentation-refresh-judge-"));
  const projectRoot = join(runRoot, "project");
  const logsRoot = join(runRoot, "logs");
  const evidenceArtifactPath = join(runRoot, "generated-evidence.json");
  const judgeArtifactPath = join(runRoot, "judge-verdict.json");
  createFixture(projectRoot);
  initRuntimeLogger(logsRoot);

  const db = openRuntimeDb(projectRoot);
  let passed = false;
  try {
    setRuntimeDb(db);
    runSqliteMigrations(db);
    const findingStore = {
      listOpenFindings: (root: string) =>
        listFindingsByStatuses(root, [STATUS.NEEDS_REVIEW, STATUS.APPROVED]).filter(
          (finding) => finding.categoryId === DOCUMENTATION_REFRESH_CATEGORY_ID
        ),
      createFinding,
      saveFinding,
      patchFinding: patchFindingFromAgent,
      deleteFinding: deleteFindingById,
    };
    const documentationProvider = createCodexCliLlmProvider({ structuredSecurity: "standard" });
    const runner = createDocumentationRefreshRunner({
      projectRoot,
      projectKey: getProjectKey(projectRoot),
      ownerId: `documentation-refresh-live-e2e-${process.pid}`,
      llmProvider: documentationProvider,
      findingStore,
      shouldContinue: () => true,
    });

    const treeBefore = runGit(projectRoot, ["rev-parse", "HEAD^{tree}"]);
    const statusBefore = runGit(projectRoot, ["status", "--porcelain=v1"]);
    const initialSnapshot = collectGitSnapshot(projectRoot);
    const workflowRun = await runner.run(toChangeBatch(initialSnapshot));
    assert.ok(workflowRun, "documentation workflow should create a durable run");
    assert.equal(workflowRun.status, "needs-review", "real Codex review should report drift");

    const openFindings = findingStore.listOpenFindings(projectRoot);
    assert.equal(openFindings.length, 1, "workflow should persist exactly one current report");
    const finding = openFindings[0];
    assert.ok(finding?.problem, "documentation report should contain a complete problem");
    assert.ok(finding.decision, "documentation report should contain one recommendation");
    const inboxFinding = InboxFindingItemSchema.parse({
      type: "finding",
      categoryId: finding.categoryId,
      id: finding.id,
      problem: finding.problem,
      decision: finding.decision,
      createdAt: finding.createdAt,
    });
    assert.equal(inboxFinding.decision.options.length, 1);
    assert.ok(locationsReferencePath(inboxFinding.problem.locations, "README.md"));
    assert.ok(locationsReferencePath(inboxFinding.problem.locations, "package.json"));

    const treeAfter = runGit(projectRoot, ["rev-parse", "HEAD^{tree}"]);
    const statusAfter = runGit(projectRoot, ["status", "--porcelain=v1"]);
    const workspaceChanges =
      treeAfter === treeBefore &&
      statusBefore === "" &&
      statusAfter === "" &&
      readFileSync(join(projectRoot, "README.md"), "utf8") === README_CONTENT &&
      readFileSync(join(projectRoot, "package.json"), "utf8") === PACKAGE_CONTENT
        ? 0
        : 1;
    assert.equal(
      workspaceChanges,
      0,
      "documentation workflow must not change project-authored files"
    );

    const recommendation = inboxFinding.decision.options[0];
    assert.ok(recommendation, "documentation report should contain its one recommendation");
    const evidence = documentationRefreshE2eJudgeAgent.inputSchema.parse({
      scenarioId: SCENARIO_ID,
      judgeId: DOCUMENTATION_REFRESH_E2E_JUDGE_ID,
      rubricVersion: DOCUMENTATION_REFRESH_E2E_RUBRIC_VERSION,
      schemaVersion: DOCUMENTATION_REFRESH_E2E_SCHEMA_VERSION,
      fixture: {
        documentationPath: "README.md",
        documentationContent: README_CONTENT,
        authorityPath: "package.json",
        authorityContent: PACKAGE_CONTENT,
        sourcePath: "src/server.js",
        sourceContent: SOURCE_CONTENT,
      },
      deterministicChecks: {
        workflowStatus: workflowRun.status,
        reportCount: openFindings.length,
        recommendationCount: inboxFinding.decision.options.length,
        workspaceChanges,
      },
      generatedReport: inboxFinding.problem,
      generatedRecommendation: recommendation,
    });
    writeJson(evidenceArtifactPath, {
      scenarioId: SCENARIO_ID,
      createdAt: new Date().toISOString(),
      evidence,
      workflowRun,
      finding: inboxFinding,
    });

    const verdict = await runSchemaConstrainedAgentWithProvider({
      agent: documentationRefreshE2eJudgeAgent,
      input: evidence,
      workspace: projectRoot,
      resumeChatId: undefined,
      llmProvider: createCodexCliLlmProvider({ structuredSecurity: "standard" }),
      deadlineAt: Date.now() + JUDGE_DEADLINE_MS,
    });
    const artifact = artifactSchema.parse({
      scenarioId: SCENARIO_ID,
      createdAt: new Date().toISOString(),
      judge: {
        id: DOCUMENTATION_REFRESH_E2E_JUDGE_ID,
        rubricVersion: DOCUMENTATION_REFRESH_E2E_RUBRIC_VERSION,
        schemaVersion: DOCUMENTATION_REFRESH_E2E_SCHEMA_VERSION,
        provider: "codex_cli",
        model: documentationRefreshE2eJudgeAgent.model,
        executionMode: "ask",
        sandbox: "read-only",
      },
      evidence,
      workflowRun,
      finding: inboxFinding,
      verdict,
    });
    writeJson(judgeArtifactPath, artifact);
    const persistedArtifact: unknown = JSON.parse(readFileSync(judgeArtifactPath, "utf8"));
    artifactSchema.parse(persistedArtifact);
    assert.equal(verdict.pass, true, `${verdict.reason}; artifact: ${judgeArtifactPath}`);
    assert.ok(verdict.score >= 90, `judge score ${verdict.score} is below 90`);

    console.log(
      JSON.stringify({
        status: "pass",
        scenarioId: SCENARIO_ID,
        workflowStatus: workflowRun.status,
        suggestion: recommendation.technicalPlan,
        judgeScore: verdict.score,
        judgeWarnings: verdict.warnings,
        workspaceChanges,
        artifact: judgeArtifactPath,
      })
    );
    passed = true;
    return 0;
  } catch (error) {
    console.error(`FAIL ${SCENARIO_ID}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Fixture and artifacts preserved for debugging: ${runRoot}`);
    return 1;
  } finally {
    clearRuntimeDb();
    closeRuntimeDb(db);
    if (passed) {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(logsRoot, { recursive: true, force: true });
      rmSync(evidenceArtifactPath, { force: true });
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
