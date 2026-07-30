/**
 * Child-process side of the documentation refresh smoke test. It uses a real
 * project Git repository and SQLite state while replacing only the Codex call.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import type { ILLMProvider, ILLMRunResult } from "../src/core/llm/llm-provider.types.js";

const [projectRoot, projectKey, ownerId, outputPath, eventsPath, holdMsRaw] = process.argv.slice(2);
if (
  projectRoot === undefined ||
  projectKey === undefined ||
  ownerId === undefined ||
  outputPath === undefined ||
  eventsPath === undefined ||
  holdMsRaw === undefined
) {
  throw new Error("Documentation smoke worker requires six arguments");
}
const holdMs = Number(holdMsRaw);
if (!Number.isInteger(holdMs) || holdMs < 0 || holdMs > 10_000) {
  throw new Error(`Invalid documentation smoke hold duration: ${holdMsRaw}`);
}

const [
  { clearRuntimeDb, setRuntimeDb },
  { closeRuntimeDb, openRuntimeDb },
  { runSqliteMigrations },
  { collectGitSnapshot },
  categoriesStore,
  { createDocumentationRefreshRunner },
] = await Promise.all([
  import("../src/core/db/runtime-db.js"),
  import("../src/core/db/sqlite-connection.js"),
  import("../src/core/db/sqlite-migrations.js"),
  import("../src/core/git/git-snapshot.js"),
  import("../src/features/categories/categories-store.js"),
  import("../src/features/documentation-refresh/documentation-refresh-runner.js"),
]);
const { DOCUMENTATION_REFRESH_CATEGORY_ID, STATUS } = await import("@steward/contracts/schemas");

let providerRuns = 0;
const provider: ILLMProvider = {
  runStructured: async (): Promise<ILLMRunResult> => {
    providerRuns += 1;
    appendFileSync(eventsPath, `${JSON.stringify({ ownerId, event: "start", at: Date.now() })}\n`);
    await delay(holdMs);
    appendFileSync(eventsPath, `${JSON.stringify({ ownerId, event: "end", at: Date.now() })}\n`);
    return {
      success: true,
      reason: "exit",
      outputText: JSON.stringify({
        status: "clean",
        summary: "The bounded documentation scope matches current project authority.",
        documentCount: 1,
        checkedDocumentPaths: ["README.md"],
        checkedAuthorityPaths: ["package.json"],
        verifiedClaims: [],
        commandsRun: [],
        uncertainties: [],
      }),
      diagnosticText: "",
    };
  },
  runMutation: async (): Promise<ILLMRunResult> => {
    throw new Error("Documentation smoke must never invoke mutation mode");
  },
  createConversationId: async (): Promise<string> => "documentation-smoke",
};

const db = openRuntimeDb(projectRoot);
setRuntimeDb(db);
try {
  runSqliteMigrations(db);
  const runner = createDocumentationRefreshRunner({
    projectRoot,
    projectKey,
    ownerId,
    llmProvider: provider,
    findingStore: {
      listOpenFindings: (root: string) =>
        categoriesStore
          .listFindingsByStatuses(root, [STATUS.NEEDS_REVIEW, STATUS.APPROVED])
          .filter((finding) => finding.categoryId === DOCUMENTATION_REFRESH_CATEGORY_ID),
      createFinding: categoriesStore.createFinding,
      saveFinding: categoriesStore.saveFinding,
      patchFinding: categoriesStore.patchFindingFromAgent,
      deleteFinding: categoriesStore.deleteFindingById,
    },
    shouldContinue: () => true,
  });
  const snapshot = collectGitSnapshot(projectRoot);
  const result = await runner.run({
    fingerprint: snapshot.hash,
    snapshot,
    changedPaths: snapshot.entries.map((entry) => entry.path),
  });
  writeFileSync(
    outputPath,
    JSON.stringify({ status: result?.status ?? "no-run", providerRuns }),
    "utf8"
  );
} finally {
  clearRuntimeDb();
  closeRuntimeDb(db);
}
