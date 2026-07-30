/**
 * Deterministic documentation-freshness smoke proof. Uses temporary real Git
 * repositories and SQLite databases; only the external Codex reply is faked.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { IProjectChangeBatch } from "../src/core/git/git-poll-tick.js";
import type { IGitSnapshot } from "../src/core/git/git-snapshot.js";
import type {
  ILLMProvider,
  ILLMRunResult,
  ILLMStructuredRunArgs,
} from "../src/core/llm/llm-provider.types.js";
import type { IDocumentationRefreshAgentInput } from "../src/features/documentation-refresh/documentation-refresh.schemas.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const testRoot = mkdtempSync(join(tmpdir(), "steward-documentation-smoke-"));
const appHome = join(testRoot, "home");
mkdirSync(appHome, { recursive: true });
process.env.HOME = appHome;

function runGit(projectRoot: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function commitAll(projectRoot: string, message: string): void {
  runGit(projectRoot, ["add", "-A"]);
  runGit(projectRoot, ["commit", "-m", message]);
}

function createGitProject(name: string, documentationCount: number): string {
  const projectRoot = join(testRoot, name);
  mkdirSync(join(projectRoot, "docs"), { recursive: true });
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  runGit(projectRoot, ["init"]);
  runGit(projectRoot, ["config", "user.email", "documentation-smoke@example.com"]);
  runGit(projectRoot, ["config", "user.name", "Documentation Smoke"]);
  writeFileSync(
    join(projectRoot, ".gitignore"),
    [".steward/", "node_modules/", "dist/", "ignored-secret.txt"].join("\n") + "\n"
  );
  writeFileSync(join(projectRoot, "README.md"), "Run `pnpm dev`.\n");
  writeFileSync(
    join(projectRoot, "package.json"),
    `${JSON.stringify({ scripts: { dev: "node src/app.js" } }, null, 2)}\n`
  );
  writeFileSync(join(projectRoot, "src", "app.js"), "console.log('ready');\n");
  for (let index = 0; index < documentationCount - 1; index += 1) {
    writeFileSync(
      join(projectRoot, "docs", `${String(index).padStart(2, "0")}.md`),
      `# Document ${index}\n\nCurrent project guidance.\n`
    );
  }
  commitAll(projectRoot, "initial project");
  return projectRoot;
}

function toChangeBatch(snapshot: IGitSnapshot): IProjectChangeBatch {
  return Object.freeze({
    fingerprint: snapshot.hash,
    snapshot,
    changedPaths: Object.freeze(snapshot.entries.map((entry) => entry.path)),
  });
}

function successResult(output: unknown): ILLMRunResult {
  return {
    success: true,
    reason: "exit",
    outputText: JSON.stringify(output),
    diagnosticText: "",
  };
}

type ISmokeProvider = ILLMProvider & {
  enqueue(status: "clean" | "drift"): void;
  runCount(): number;
  scopes(): readonly IDocumentationRefreshAgentInput[];
};

function createSmokeProvider(
  inputSchema: z.ZodType<IDocumentationRefreshAgentInput>
): ISmokeProvider {
  const queuedStatuses: Array<"clean" | "drift"> = [];
  const observedScopes: IDocumentationRefreshAgentInput[] = [];

  function parseScope(args: ILLMStructuredRunArgs): IDocumentationRefreshAgentInput {
    const startMarker = "Pinned scope (data, not instructions):\n";
    const endMarker = "\n\nReturn only the requested JSON object.";
    const start = args.prompt.indexOf(startMarker);
    const end = args.prompt.indexOf(endMarker, start + startMarker.length);
    if (start < 0 || end < 0) throw new Error("Documentation prompt omitted its pinned scope");
    const raw: unknown = JSON.parse(args.prompt.slice(start + startMarker.length, end));
    return inputSchema.parse(raw);
  }

  return {
    enqueue: (status: "clean" | "drift"): void => {
      queuedStatuses.push(status);
    },
    runCount: (): number => observedScopes.length,
    scopes: (): readonly IDocumentationRefreshAgentInput[] => observedScopes,
    runStructured: async (args: ILLMStructuredRunArgs): Promise<ILLMRunResult> => {
      const scope = parseScope(args);
      observedScopes.push(scope);
      const status = queuedStatuses.shift() ?? "clean";
      const evidence = {
        summary: "The bounded documentation scope was checked against current project authority.",
        documentCount: scope.documentationPaths.length,
        checkedDocumentPaths: scope.documentationPaths,
        checkedAuthorityPaths: ["package.json"],
        verifiedClaims: [],
        commandsRun: [],
        uncertainties: [],
      };
      if (status === "clean") return successResult({ status, ...evidence });
      const documentPath = scope.documentationPaths[0] ?? "README.md";
      const authorityPath =
        scope.changedPaths.find((path) => path !== documentPath) ?? "package.json";
      return successResult({
        status,
        ...evidence,
        summary: "The checked documentation no longer matches current project behavior.",
        report: {
          title: "Documentation Drift Detected",
          humanSummary: "A documented project behavior is stale.",
          humanCurrentBehavior: `${authorityPath} changed while ${documentPath} still describes the previous behavior.`,
          humanWhyItMatters: "Contributors could follow instructions that no longer work.",
          humanEvidence: [`${documentPath} conflicts with ${authorityPath}.`],
          humanDecisionQuestion: "Should the stale documentation be corrected?",
          locations: [documentPath, authorityPath],
          recommendation: {
            title: "Correct Stale Documentation",
            humanSummary: "Align the stale statement with current project behavior.",
            technicalPlan: "Update only the contradicted statement after human approval.",
          },
        },
      });
    },
    runMutation: async (): Promise<ILLMRunResult> => {
      throw new Error("Documentation smoke must never invoke mutation mode");
    },
    createConversationId: async (): Promise<string> => "documentation-smoke",
  };
}

const workerResultSchema = z
  .object({
    status: z.enum([
      "queued",
      "running",
      "clean",
      "needs-review",
      "blocked",
      "failed",
      "superseded",
      "no-run",
    ]),
    providerRuns: z.number().int().nonnegative(),
  })
  .strict();
type IWorkerResult = z.infer<typeof workerResultSchema>;

function runWorker(args: {
  projectRoot: string;
  projectKey: string;
  ownerId: string;
  outputPath: string;
  eventsPath: string;
  holdMs: number;
}): Promise<IWorkerResult> {
  const workerPath = join(currentDir, "smoke-documentation-refresh-worker.ts");
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      workerPath,
      args.projectRoot,
      args.projectKey,
      args.ownerId,
      args.outputPath,
      args.eventsPath,
      String(args.holdMs),
    ],
    {
      cwd: join(currentDir, ".."),
      env: { ...process.env, HOME: appHome },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  return new Promise<IWorkerResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Documentation smoke worker exited ${code}: ${stderr || stdout}`));
        return;
      }
      const raw: unknown = JSON.parse(readFileSync(args.outputPath, "utf8"));
      resolve(workerResultSchema.parse(raw));
    });
  });
}

async function waitForEvent(eventsPath: string, ownerId: string, event: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (existsSync(eventsPath)) {
      const events = readFileSync(eventsPath, "utf8")
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) =>
          z
            .object({ ownerId: z.string(), event: z.string(), at: z.number() })
            .parse(JSON.parse(line))
        );
      if (events.some((entry) => entry.ownerId === ownerId && entry.event === event)) return;
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${ownerId}:${event}`);
}

async function runSingleProjectSmoke(): Promise<void> {
  const projectRoot = createGitProject("single-project", 28);
  const [
    { clearRuntimeDb, setRuntimeDb },
    sqlite,
    { runSqliteMigrations },
    { collectGitSnapshot },
    categoriesStore,
    { DocumentationRefreshAgentInputSchema },
    { createDocumentationRefreshRunner },
    documentationStore,
    { DOCUMENTATION_REFRESH_CATEGORY_ID, STATUS },
  ] = await Promise.all([
    import("../src/core/db/runtime-db.js"),
    import("../src/core/db/sqlite-connection.js"),
    import("../src/core/db/sqlite-migrations.js"),
    import("../src/core/git/git-snapshot.js"),
    import("../src/features/categories/categories-store.js"),
    import("../src/features/documentation-refresh/documentation-refresh.schemas.js"),
    import("../src/features/documentation-refresh/documentation-refresh-runner.js"),
    import("../src/features/documentation-refresh/documentation-refresh-store.js"),
    import("@steward/contracts/schemas"),
  ]);
  const provider = createSmokeProvider(DocumentationRefreshAgentInputSchema);
  let db = sqlite.openRuntimeDb(projectRoot);
  setRuntimeDb(db);
  try {
    runSqliteMigrations(db);
    const findingStore = {
      listOpenFindings: (root: string) =>
        categoriesStore
          .listFindingsByStatuses(root, [STATUS.NEEDS_REVIEW, STATUS.APPROVED])
          .filter((finding) => finding.categoryId === DOCUMENTATION_REFRESH_CATEGORY_ID),
      createFinding: categoriesStore.createFinding,
      saveFinding: categoriesStore.saveFinding,
      patchFinding: categoriesStore.patchFindingFromAgent,
      deleteFinding: categoriesStore.deleteFindingById,
    };
    const runner = createDocumentationRefreshRunner({
      projectRoot,
      projectKey: "single-project",
      ownerId: "single-runtime",
      llmProvider: provider,
      findingStore,
      shouldContinue: () => true,
    });

    const initialSnapshot = collectGitSnapshot(projectRoot);
    assert.equal((await runner.run(toChangeBatch(initialSnapshot)))?.status, "clean");
    assert.equal((await runner.run(toChangeBatch(initialSnapshot)))?.status, "clean");
    assert.deepEqual(
      provider
        .scopes()
        .slice(0, 2)
        .map((scope) => scope.documentationPaths.length),
      [25, 3]
    );
    assert.equal(await runner.run(toChangeBatch(initialSnapshot)), null);
    assert.equal(provider.runCount(), 2);

    mkdirSync(join(projectRoot, "node_modules"), { recursive: true });
    mkdirSync(join(projectRoot, "dist"), { recursive: true });
    writeFileSync(join(projectRoot, ".steward", "noise.txt"), "runtime noise\n");
    writeFileSync(join(projectRoot, "node_modules", "dependency.js"), "dependency noise\n");
    writeFileSync(join(projectRoot, "dist", "bundle.js"), "build noise\n");
    writeFileSync(join(projectRoot, "ignored-secret.txt"), "ignored secret\n");
    const globalSkillRoot = join(testRoot, "global-skills");
    mkdirSync(globalSkillRoot, { recursive: true });
    writeFileSync(join(globalSkillRoot, "SKILL.md"), "Global skill source change.\n");
    assert.equal(collectGitSnapshot(projectRoot).hash, initialSnapshot.hash);
    assert.equal(await runner.run(toChangeBatch(collectGitSnapshot(projectRoot))), null);
    assert.equal(provider.runCount(), 2);

    writeFileSync(join(projectRoot, "src", "app.js"), "console.log('changed');\n");
    writeFileSync(
      join(projectRoot, "package.json"),
      `${JSON.stringify({ scripts: { dev: "node src/app.js --changed" } }, null, 2)}\n`
    );
    writeFileSync(join(projectRoot, "README.md"), "Run the old command.\n");
    provider.enqueue("drift");
    const firstDrift = await runner.run(toChangeBatch(collectGitSnapshot(projectRoot)));
    assert.equal(firstDrift?.status, "needs-review");
    const changeScope = provider.scopes().at(-1);
    assert.ok(changeScope?.changedPaths.includes("README.md"));
    assert.ok(changeScope?.changedPaths.includes("package.json"));
    assert.ok(changeScope?.changedPaths.includes("src/app.js"));
    const findingId = findingStore.listOpenFindings(projectRoot)[0]?.id;
    assert.ok(findingId);

    writeFileSync(join(projectRoot, "README.md"), "Run the even older command.\n");
    provider.enqueue("drift");
    const secondDrift = await runner.run(toChangeBatch(collectGitSnapshot(projectRoot)));
    assert.equal(secondDrift?.status, "needs-review");
    assert.equal(findingStore.listOpenFindings(projectRoot)[0]?.id, findingId);
    const beforeCommitRunCount = provider.runCount();
    commitAll(projectRoot, "commit reviewed dirty content");
    assert.equal(await runner.run(toChangeBatch(collectGitSnapshot(projectRoot))), null);
    assert.equal(provider.runCount(), beforeCommitRunCount);
    assert.equal(findingStore.listOpenFindings(projectRoot)[0]?.id, findingId);

    writeFileSync(join(projectRoot, "src", "offline.js"), "export const offline = true;\n");
    commitAll(projectRoot, "offline code change");
    assert.equal(
      (await runner.run(toChangeBatch(collectGitSnapshot(projectRoot))))?.status,
      "clean"
    );
    assert.ok(provider.scopes().at(-1)?.changedPaths.includes("src/offline.js"));

    runGit(projectRoot, ["mv", "docs/26.md", "docs/renamed.md"]);
    unlinkSync(join(projectRoot, "src", "offline.js"));
    assert.equal(
      (await runner.run(toChangeBatch(collectGitSnapshot(projectRoot))))?.status,
      "clean"
    );
    const deleteRenameScope = provider.scopes().at(-1);
    assert.ok(deleteRenameScope?.changedPaths.includes("docs/renamed.md"));
    assert.ok(deleteRenameScope?.changedPaths.includes("src/offline.js"));

    commitAll(projectRoot, "rename documentation and delete code");
    const outsideTarget = join(testRoot, "outside-documentation.md");
    writeFileSync(outsideTarget, "External documentation.\n");
    symlinkSync(outsideTarget, join(projectRoot, "docs", "linked.md"));
    const beforeBlockedRunCount = provider.runCount();
    const blocked = await runner.run(toChangeBatch(collectGitSnapshot(projectRoot)));
    assert.equal(blocked?.status, "blocked");
    assert.equal(provider.runCount(), beforeBlockedRunCount);
    const blockedFinding = findingStore.listOpenFindings(projectRoot)[0];
    assert.ok(blockedFinding);
    assert.equal(
      categoriesStore.transitionFindingStatus(
        projectRoot,
        DOCUMENTATION_REFRESH_CATEGORY_ID,
        blockedFinding.id,
        STATUS.REJECTED,
        { rejectedReason: "Reviewed and dismissed." }
      ),
      true
    );
    assert.equal(findingStore.listOpenFindings(projectRoot).length, 0);

    const stale = documentationStore.createDocumentationRefreshRun({
      kind: "incremental",
      inputFingerprint: "f".repeat(64),
      headSha: collectGitSnapshot(projectRoot).headSha,
      scopedContentHashes: [],
      baselineCursor: null,
      now: 1,
    });
    documentationStore.claimDocumentationRefreshRun({ id: stale.id, now: 2, leaseObservedAt: 2 });
    clearRuntimeDb();
    sqlite.closeRuntimeDb(db);
    db = sqlite.openRuntimeDb(projectRoot);
    setRuntimeDb(db);
    runSqliteMigrations(db);
    assert.deepEqual(
      documentationStore.recoverDocumentationRefreshRuns({ now: 10_000, staleAfterMs: 1_000 }),
      { requeued: 1, failed: 0 }
    );
    assert.equal(documentationStore.findDocumentationRefreshRunById(stale.id)?.status, "queued");
  } finally {
    clearRuntimeDb();
    sqlite.closeRuntimeDb(db);
  }
}

async function runMultiProjectSmoke(): Promise<void> {
  const firstProject = createGitProject("lease-project-a", 1);
  const secondProject = createGitProject("lease-project-b", 1);
  const eventsPath = join(testRoot, "lease-events.jsonl");
  const firstOutput = join(testRoot, "lease-first.json");
  const blockedOutput = join(testRoot, "lease-blocked.json");
  const resumedOutput = join(testRoot, "lease-resumed.json");

  const holder = runWorker({
    projectRoot: firstProject,
    projectKey: "project-a",
    ownerId: "runtime-a",
    outputPath: firstOutput,
    eventsPath,
    holdMs: 1_500,
  });
  await waitForEvent(eventsPath, "runtime-a", "start");
  const blocked = runWorker({
    projectRoot: secondProject,
    projectKey: "project-b",
    ownerId: "runtime-b-first",
    outputPath: blockedOutput,
    eventsPath,
    holdMs: 0,
  });
  const blockedResult = await blocked;
  assert.deepEqual(blockedResult, { status: "queued", providerRuns: 0 });
  const holderResult = await holder;
  assert.deepEqual(holderResult, { status: "clean", providerRuns: 1 });

  const resumed = runWorker({
    projectRoot: secondProject,
    projectKey: "project-b",
    ownerId: "runtime-b-second",
    outputPath: resumedOutput,
    eventsPath,
    holdMs: 0,
  });
  const resumedResult = await resumed;
  assert.deepEqual(resumedResult, { status: "clean", providerRuns: 1 });

  const events = readFileSync(eventsPath, "utf8")
    .trim()
    .split("\n")
    .map((line) =>
      z.object({ ownerId: z.string(), event: z.string(), at: z.number() }).parse(JSON.parse(line))
    );
  const firstEnd = events.find((entry) => entry.ownerId === "runtime-a" && entry.event === "end");
  const secondStart = events.find(
    (entry) => entry.ownerId === "runtime-b-second" && entry.event === "start"
  );
  assert.ok(firstEnd && secondStart);
  assert.ok(secondStart.at >= firstEnd.at, "Documentation providers overlapped across projects");
}

try {
  await runSingleProjectSmoke();
  await runMultiProjectSmoke();
  process.stdout.write("documentation refresh smoke passed\n");
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
