import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENTATION_REFRESH_CATEGORY_ID, STATUS } from "@steward/contracts/schemas";
import { clearRuntimeDb, setRuntimeDb } from "../../core/db/runtime-db.js";
import {
  closeRuntimeDb,
  openRuntimeDb,
  type ISqliteConnection,
} from "../../core/db/sqlite-connection.js";
import { runSqliteMigrations } from "../../core/db/sqlite-migrations.js";
import { collectGitSnapshot, type IGitSnapshot } from "../../core/git/git-snapshot.js";
import type { IProjectChangeBatch } from "../../core/git/git-poll-tick.js";
import type {
  ILLMProvider,
  ILLMRunResult,
  ILLMStructuredRunArgs,
} from "../../core/llm/llm-provider.types.js";
import {
  createFinding,
  deleteFindingById,
  listFindingsByStatuses,
  patchFindingFromAgent,
  saveFinding,
} from "../categories/categories-store.js";

let appDataRoot = "";

vi.mock("../../core/project-key.js", () => ({
  getAppDataRoot: (): string => appDataRoot,
}));

import { createDocumentationRefreshRunner } from "./documentation-refresh-runner.js";
import type { IDocumentationRefreshAgentOutput } from "./documentation-refresh.schemas.js";

function runGit(projectRoot: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}

function commitAll(projectRoot: string, message: string): void {
  runGit(projectRoot, ["add", "-A"]);
  runGit(projectRoot, ["commit", "-m", message]);
}

function toChangeBatch(snapshot: IGitSnapshot): IProjectChangeBatch {
  return Object.freeze({
    fingerprint: snapshot.hash,
    snapshot: Object.freeze({
      ...snapshot,
      entries: Object.freeze(snapshot.entries.map((entry) => Object.freeze({ ...entry }))),
    }),
    changedPaths: Object.freeze(snapshot.entries.map((entry) => entry.path)),
  });
}

function successfulResult(output: unknown): ILLMRunResult {
  return {
    success: true,
    reason: "exit",
    outputText: JSON.stringify(output),
    diagnosticText: "",
    runtimeMs: 10,
  };
}

function createSequentialProvider(args: {
  results: ILLMRunResult[];
  onRun?: (runNumber: number) => void;
}): ILLMProvider & {
  structuredRunCount: () => number;
  structuredDeadlines: () => Array<number | undefined>;
} {
  let runCount = 0;
  const deadlines: Array<number | undefined> = [];
  return {
    runStructured: async (runArgs: ILLMStructuredRunArgs): Promise<ILLMRunResult> => {
      runCount += 1;
      deadlines.push(runArgs.deadlineAt);
      args.onRun?.(runCount);
      const result = args.results[runCount - 1];
      if (result === undefined) throw new Error(`Missing fake result for run ${runCount}`);
      return result;
    },
    runMutation: async (): Promise<ILLMRunResult> => successfulResult({ unused: true }),
    createConversationId: async (): Promise<string> => "documentation-test-conversation",
    structuredRunCount: (): number => runCount,
    structuredDeadlines: (): Array<number | undefined> => [...deadlines],
  };
}

const cleanOutput = {
  status: "clean",
  summary: "The scoped documentation matches the current project authority.",
  documentCount: 1,
  checkedDocumentPaths: ["README.md"],
  checkedAuthorityPaths: ["package.json"],
  verifiedClaims: [
    {
      documentPath: "README.md",
      claim: "The development command is pnpm dev.",
      authorityPath: "package.json",
      evidence: "package.json defines the dev script.",
    },
  ],
  commandsRun: [],
  uncertainties: [],
};

const report = {
  title: "README command drift",
  humanSummary: "The README references a command that no longer exists.",
  humanCurrentBehavior: "package.json defines pnpm dev, while README says npm start.",
  humanWhyItMatters: "Contributors cannot follow the documented setup path.",
  humanEvidence: ["README.md and package.json name different commands."],
  humanDecisionQuestion: "Should the README command be corrected?",
  locations: ["README.md", "package.json"],
  recommendation: {
    title: "Correct README command",
    humanSummary: "Use the current package script in the README.",
    technicalPlan: "Replace only the obsolete command and its directly related sentence.",
  },
};

const driftOutput = {
  ...cleanOutput,
  status: "drift",
  summary: "The README command is stale.",
  report,
};

function driftOutputForDocumentationPaths(args: {
  documentationPaths: string[];
  reportPath: string;
  title: string;
}): IDocumentationRefreshAgentOutput {
  return {
    status: "drift",
    summary: `${args.reportPath} contains stale guidance.`,
    documentCount: args.documentationPaths.length,
    checkedDocumentPaths: args.documentationPaths,
    checkedAuthorityPaths: [],
    verifiedClaims: [],
    commandsRun: [],
    uncertainties: [],
    report: {
      ...report,
      title: args.title,
      locations: [args.reportPath],
    },
  };
}

function cleanOutputForDocumentationPaths(
  documentationPaths: string[]
): IDocumentationRefreshAgentOutput {
  return {
    status: "clean",
    summary: "The bounded documentation scope matches current project authority.",
    documentCount: documentationPaths.length,
    checkedDocumentPaths: documentationPaths,
    checkedAuthorityPaths: [],
    verifiedClaims: [],
    commandsRun: [],
    uncertainties: [],
  };
}

function createFindingStoreDeps() {
  return {
    listOpenFindings: (projectRoot: string) =>
      listFindingsByStatuses(projectRoot, [STATUS.NEEDS_REVIEW, STATUS.APPROVED]).filter(
        (finding) => finding.categoryId === DOCUMENTATION_REFRESH_CATEGORY_ID
      ),
    createFinding,
    saveFinding,
    patchFinding: patchFindingFromAgent,
    deleteFinding: deleteFindingById,
  };
}

describe("documentation refresh runner", () => {
  let projectRoot: string;
  let db: ISqliteConnection;

  beforeEach((): void => {
    appDataRoot = mkdtempSync(join(tmpdir(), "steward-documentation-runner-global-"));
    projectRoot = mkdtempSync(join(tmpdir(), "steward-documentation-runner-project-"));
    runGit(projectRoot, ["init"]);
    runGit(projectRoot, ["config", "user.email", "documentation@example.com"]);
    runGit(projectRoot, ["config", "user.name", "Documentation Test"]);
    writeFileSync(join(projectRoot, ".gitignore"), ".steward/\nnode_modules/\ndist/\n");
    writeFileSync(join(projectRoot, "README.md"), "Run `pnpm dev`.\n");
    writeFileSync(
      join(projectRoot, "package.json"),
      JSON.stringify({ scripts: { dev: "node src/app.js" } }, null, 2) + "\n"
    );
    writeFileSync(join(projectRoot, "src-app.js"), "console.log('ready');\n");
    commitAll(projectRoot, "initial project");
    db = openRuntimeDb(projectRoot);
    runSqliteMigrations(db);
    setRuntimeDb(db);
  });

  afterEach((): void => {
    clearRuntimeDb();
    closeRuntimeDb(db);
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(appDataRoot, { recursive: true, force: true });
  });

  it("runs a clean baseline, publishes one drift report, and spends nothing when reviewed dirty content is committed unchanged", async () => {
    const provider = createSequentialProvider({
      results: [successfulResult(cleanOutput), successfulResult(driftOutput)],
    });
    const runner = createDocumentationRefreshRunner({
      projectRoot,
      projectKey: "project-test",
      ownerId: "runtime-test",
      llmProvider: provider,
      findingStore: createFindingStoreDeps(),
      shouldContinue: () => true,
    });
    const initialSnapshot = collectGitSnapshot(projectRoot);
    const baselineStartedAt = Date.now();

    const baseline = await runner.run(toChangeBatch(initialSnapshot));

    expect(baseline?.status).toBe("clean");
    expect(provider.structuredDeadlines()[0]).toBeGreaterThan(baselineStartedAt);
    expect(provider.structuredDeadlines()[0]).toBeLessThanOrEqual(
      baselineStartedAt + 10 * 60 * 1_000
    );
    expect(collectGitSnapshot(projectRoot).hash).toBe(initialSnapshot.hash);

    writeFileSync(join(projectRoot, "README.md"), "Run `npm start`.\n");
    const dirtySnapshot = collectGitSnapshot(projectRoot);
    const drift = await runner.run(toChangeBatch(dirtySnapshot));

    expect(drift?.status).toBe("needs-review");
    expect(provider.structuredRunCount()).toBe(2);
    const openFindings = createFindingStoreDeps().listOpenFindings(projectRoot);
    expect(openFindings).toHaveLength(1);
    expect(openFindings[0]?.categoryId).toBe(DOCUMENTATION_REFRESH_CATEGORY_ID);
    expect(openFindings[0]?.decision?.options).toHaveLength(1);
    expect(collectGitSnapshot(projectRoot).hash).toBe(dirtySnapshot.hash);

    commitAll(projectRoot, "commit reviewed documentation drift");
    const committedSnapshot = collectGitSnapshot(projectRoot);
    const duplicate = await runner.run(toChangeBatch(committedSnapshot));

    expect(duplicate?.id).toBe(drift?.id);
    expect(provider.structuredRunCount()).toBe(2);
    expect(createFindingStoreDeps().listOpenFindings(projectRoot)).toHaveLength(1);
  });

  it("keeps unresolved findings from separate bounded baseline batches", async () => {
    const addedDocumentationPaths = Array.from(
      { length: 25 },
      (_, index) => `docs/document-${String(index + 1).padStart(2, "0")}.md`
    );
    mkdirSync(join(projectRoot, "docs"), { recursive: true });
    for (const path of addedDocumentationPaths) {
      writeFileSync(join(projectRoot, path), `# ${path}\n`);
    }
    commitAll(projectRoot, "add bounded documentation inventory");
    const documentationPaths = ["README.md", ...addedDocumentationPaths].sort((left, right) =>
      left.localeCompare(right)
    );
    const firstBatch = documentationPaths.slice(0, 25);
    const secondBatch = documentationPaths.slice(25);
    const provider = createSequentialProvider({
      results: [
        successfulResult(
          driftOutputForDocumentationPaths({
            documentationPaths: firstBatch,
            reportPath: firstBatch[0]!,
            title: "First bounded documentation drift",
          })
        ),
        successfulResult(
          driftOutputForDocumentationPaths({
            documentationPaths: secondBatch,
            reportPath: secondBatch[0]!,
            title: "Second bounded documentation drift",
          })
        ),
      ],
    });
    const runner = createDocumentationRefreshRunner({
      projectRoot,
      projectKey: "project-test",
      ownerId: "runtime-batches",
      llmProvider: provider,
      findingStore: createFindingStoreDeps(),
      shouldContinue: () => true,
    });
    const snapshot = collectGitSnapshot(projectRoot);

    await runner.run(toChangeBatch(snapshot));
    await runner.run(toChangeBatch(snapshot));

    const openFindings = createFindingStoreDeps().listOpenFindings(projectRoot);
    expect(openFindings).toHaveLength(2);
    expect(openFindings.map((finding) => finding.problem?.title).sort()).toEqual([
      "First bounded documentation drift",
      "Second bounded documentation drift",
    ]);
  });

  it("keeps an earlier unresolved finding when a later bounded baseline batch is clean", async () => {
    const addedDocumentationPaths = Array.from(
      { length: 25 },
      (_, index) => `docs/document-${String(index + 1).padStart(2, "0")}.md`
    );
    mkdirSync(join(projectRoot, "docs"), { recursive: true });
    for (const path of addedDocumentationPaths) {
      writeFileSync(join(projectRoot, path), `# ${path}\n`);
    }
    commitAll(projectRoot, "add documentation for clean second batch");
    const documentationPaths = ["README.md", ...addedDocumentationPaths].sort((left, right) =>
      left.localeCompare(right)
    );
    const firstBatch = documentationPaths.slice(0, 25);
    const secondBatch = documentationPaths.slice(25);
    const provider = createSequentialProvider({
      results: [
        successfulResult(
          driftOutputForDocumentationPaths({
            documentationPaths: firstBatch,
            reportPath: firstBatch[0]!,
            title: "Earlier unresolved documentation drift",
          })
        ),
        successfulResult(cleanOutputForDocumentationPaths(secondBatch)),
      ],
    });
    const runner = createDocumentationRefreshRunner({
      projectRoot,
      projectKey: "project-test",
      ownerId: "runtime-clean-scope",
      llmProvider: provider,
      findingStore: createFindingStoreDeps(),
      shouldContinue: () => true,
    });
    const snapshot = collectGitSnapshot(projectRoot);

    await runner.run(toChangeBatch(snapshot));
    await runner.run(toChangeBatch(snapshot));

    const openFindings = createFindingStoreDeps().listOpenFindings(projectRoot);
    expect(openFindings).toHaveLength(1);
    expect(openFindings[0]?.problem?.title).toBe("Earlier unresolved documentation drift");
  });

  it("keeps a multi-document finding until one clean scope rechecks every reported document", async () => {
    const addedDocumentationPaths = Array.from(
      { length: 30 },
      (_, index) => `docs/document-${String(index + 1).padStart(2, "0")}.md`
    );
    mkdirSync(join(projectRoot, "docs"), { recursive: true });
    for (const path of addedDocumentationPaths) {
      writeFileSync(join(projectRoot, path), `# ${path}\n`);
    }
    commitAll(projectRoot, "add documentation for multi-document cleanup");
    const documentationPaths = ["README.md", ...addedDocumentationPaths].sort((left, right) =>
      left.localeCompare(right)
    );
    const firstBatch = documentationPaths.slice(0, 25);
    const secondBatch = documentationPaths.slice(25);
    const firstReportedPath = addedDocumentationPaths.at(-2)!;
    const secondReportedPath = addedDocumentationPaths.at(-1)!;
    const driftDocumentationPaths = [
      ...new Set([firstReportedPath, secondReportedPath, "README.md", ...documentationPaths]),
    ].slice(0, 25);
    const partialCleanDocumentationPaths = [
      ...new Set([firstReportedPath, "README.md", ...documentationPaths]),
    ].slice(0, 25);
    const provider = createSequentialProvider({
      results: [
        successfulResult(cleanOutputForDocumentationPaths(firstBatch)),
        successfulResult(cleanOutputForDocumentationPaths(secondBatch)),
        successfulResult({
          ...driftOutputForDocumentationPaths({
            documentationPaths: driftDocumentationPaths,
            reportPath: firstReportedPath,
            title: "Two Document Drift Report",
          }),
          report: {
            ...report,
            title: "Two Document Drift Report",
            locations: [firstReportedPath, secondReportedPath],
          },
        }),
        successfulResult(cleanOutputForDocumentationPaths(partialCleanDocumentationPaths)),
        successfulResult(cleanOutputForDocumentationPaths(driftDocumentationPaths)),
      ],
    });
    const runner = createDocumentationRefreshRunner({
      projectRoot,
      projectKey: "project-test",
      ownerId: "runtime-multi-document-cleanup",
      llmProvider: provider,
      findingStore: createFindingStoreDeps(),
      shouldContinue: () => true,
    });
    const baselineSnapshot = collectGitSnapshot(projectRoot);

    await runner.run(toChangeBatch(baselineSnapshot));
    await runner.run(toChangeBatch(baselineSnapshot));

    writeFileSync(join(projectRoot, firstReportedPath), "# First drift\n");
    writeFileSync(join(projectRoot, secondReportedPath), "# Second drift\n");
    const drift = await runner.run(toChangeBatch(collectGitSnapshot(projectRoot)));
    expect(provider.structuredRunCount()).toBe(3);
    expect(drift?.status).toBe("needs-review");
    expect(createFindingStoreDeps().listOpenFindings(projectRoot)).toHaveLength(1);

    writeFileSync(join(projectRoot, firstReportedPath), "# First clean revision\n");
    await runner.run(toChangeBatch(collectGitSnapshot(projectRoot)));
    expect(createFindingStoreDeps().listOpenFindings(projectRoot)).toHaveLength(1);

    writeFileSync(join(projectRoot, firstReportedPath), "# First final revision\n");
    writeFileSync(join(projectRoot, secondReportedPath), "# Second final revision\n");
    await runner.run(toChangeBatch(collectGitSnapshot(projectRoot)));
    expect(createFindingStoreDeps().listOpenFindings(projectRoot)).toHaveLength(0);
  });

  it("clears a resolved finding when the same reviewed scope reports different drift", async () => {
    writeFileSync(join(projectRoot, "GUIDE.md"), "# Current guide\n");
    commitAll(projectRoot, "add second root document");
    const documentationPaths = ["GUIDE.md", "README.md"];
    const provider = createSequentialProvider({
      results: [
        successfulResult(
          driftOutputForDocumentationPaths({
            documentationPaths,
            reportPath: "README.md",
            title: "README Documentation Drift",
          })
        ),
        successfulResult(
          driftOutputForDocumentationPaths({
            documentationPaths,
            reportPath: "GUIDE.md",
            title: "Guide Documentation Drift",
          })
        ),
      ],
    });
    const runner = createDocumentationRefreshRunner({
      projectRoot,
      projectKey: "project-test",
      ownerId: "runtime-replaced-drift",
      llmProvider: provider,
      findingStore: createFindingStoreDeps(),
      shouldContinue: () => true,
    });

    await runner.run(toChangeBatch(collectGitSnapshot(projectRoot)));
    expect(createFindingStoreDeps().listOpenFindings(projectRoot)).toHaveLength(1);

    writeFileSync(join(projectRoot, "GUIDE.md"), "# Stale guide\n");
    await runner.run(toChangeBatch(collectGitSnapshot(projectRoot)));

    const openFindings = createFindingStoreDeps().listOpenFindings(projectRoot);
    expect(openFindings).toHaveLength(1);
    expect(openFindings[0]?.problem?.title).toBe("Guide Documentation Drift");
  });

  it("records blocked, failed, and superseded exits without publishing stale evidence", async () => {
    const blockedProvider = createSequentialProvider({
      results: [
        successfulResult({
          ...cleanOutput,
          status: "blocked",
          uncertainties: ["The authoritative deployment command is not present in the repository."],
          blocker: "The required authority is missing.",
          nextAction: "Confirm the deployment owner and command.",
          report,
        }),
      ],
    });
    const blockedRunner = createDocumentationRefreshRunner({
      projectRoot,
      projectKey: "project-test",
      ownerId: "runtime-blocked",
      llmProvider: blockedProvider,
      findingStore: createFindingStoreDeps(),
      shouldContinue: () => true,
    });
    const blocked = await blockedRunner.run(toChangeBatch(collectGitSnapshot(projectRoot)));
    expect(blocked?.status).toBe("blocked");
    expect(createFindingStoreDeps().listOpenFindings(projectRoot)).toHaveLength(1);

    for (const finding of createFindingStoreDeps().listOpenFindings(projectRoot)) {
      deleteFindingById(projectRoot, finding.id);
    }
    writeFileSync(join(projectRoot, "README.md"), "Run `pnpm dev` after setup.\n");
    const failureProvider = createSequentialProvider({
      results: [
        { success: false, reason: "timeout", outputText: "", diagnosticText: "timed out" },
        { success: false, reason: "timeout", outputText: "", diagnosticText: "timed out" },
      ],
    });
    const failureRunner = createDocumentationRefreshRunner({
      projectRoot,
      projectKey: "project-test",
      ownerId: "runtime-failed",
      llmProvider: failureProvider,
      findingStore: createFindingStoreDeps(),
      shouldContinue: () => true,
    });
    const failed = await failureRunner.run(toChangeBatch(collectGitSnapshot(projectRoot)));
    expect(failed?.status).toBe("failed");
    expect(failed?.attemptCount).toBe(2);
    expect(createFindingStoreDeps().listOpenFindings(projectRoot)).toHaveLength(0);

    writeFileSync(join(projectRoot, "README.md"), "Run `pnpm dev` now.\n");
    const movingSnapshot = collectGitSnapshot(projectRoot);
    const movingProvider = createSequentialProvider({
      results: [successfulResult(cleanOutput)],
      onRun: () => {
        writeFileSync(join(projectRoot, "src-app.js"), "console.log('changed concurrently');\n");
      },
    });
    const movingRunner = createDocumentationRefreshRunner({
      projectRoot,
      projectKey: "project-test",
      ownerId: "runtime-moving",
      llmProvider: movingProvider,
      findingStore: createFindingStoreDeps(),
      shouldContinue: () => true,
    });
    const superseded = await movingRunner.run(toChangeBatch(movingSnapshot));
    expect(superseded?.status).toBe("superseded");
    expect(createFindingStoreDeps().listOpenFindings(projectRoot)).toHaveLength(0);
  });

  it("reports deletion of the last documentation file without asking Codex to inspect a missing path", async () => {
    const provider = createSequentialProvider({ results: [successfulResult(cleanOutput)] });
    const runner = createDocumentationRefreshRunner({
      projectRoot,
      projectKey: "project-test",
      ownerId: "runtime-test",
      llmProvider: provider,
      findingStore: createFindingStoreDeps(),
      shouldContinue: () => true,
    });

    const baseline = await runner.run(toChangeBatch(collectGitSnapshot(projectRoot)));
    expect(baseline?.status).toBe("clean");

    rmSync(join(projectRoot, "README.md"));
    const deletion = await runner.run(toChangeBatch(collectGitSnapshot(projectRoot)));

    expect(deletion?.status).toBe("blocked");
    expect(deletion?.blocker).toContain("no inspectable documentation files");
    expect(provider.structuredRunCount()).toBe(1);
    expect(createFindingStoreDeps().listOpenFindings(projectRoot)).toHaveLength(1);
  });

  it("blocks a change above 100 paths without invoking the provider or hashing an unbounded scope", async () => {
    const provider = createSequentialProvider({ results: [successfulResult(cleanOutput)] });
    const runner = createDocumentationRefreshRunner({
      projectRoot,
      projectKey: "project-test",
      ownerId: "runtime-budget",
      llmProvider: provider,
      findingStore: createFindingStoreDeps(),
      shouldContinue: () => true,
    });
    await runner.run(toChangeBatch(collectGitSnapshot(projectRoot)));

    mkdirSync(join(projectRoot, "src"), { recursive: true });
    for (let index = 0; index < 101; index += 1) {
      writeFileSync(
        join(projectRoot, "src", `changed-${index}.ts`),
        `export const value = ${index};\n`
      );
    }
    const changedSnapshot = collectGitSnapshot(projectRoot);
    const blocked = await runner.run(toChangeBatch(changedSnapshot));

    expect(blocked?.status).toBe("blocked");
    expect(blocked?.blocker).toContain("101 project paths");
    expect(blocked?.scopedContentHashes).toHaveLength(100);
    expect(provider.structuredRunCount()).toBe(1);
    expect(collectGitSnapshot(projectRoot).hash).toBe(changedSnapshot.hash);
  });
});
