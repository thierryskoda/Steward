#!/usr/bin/env -S npx tsx
/**
 * Backend E2E for the approved-finding implementation flow. It creates a temp
 * repo, seeds a real approved finding in SQLite, runs the workspace mutation
 * implement processor, verifies the code behavior changed, then runs undo and
 * verifies the original file is restored.
 */
import "./load-env.js";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { STATUS, ItemStatusSchema } from "@steward/contracts/schemas";
import { closeRuntimeDb, openRuntimeDb } from "../src/core/db/sqlite-connection.js";
import { runSqliteMigrations } from "../src/core/db/sqlite-migrations.js";
import { clearRuntimeDb, setRuntimeDb } from "../src/core/db/runtime-db.js";
import { loadEnv } from "../src/core/env.js";
import { createLlmProvider, setLlmProvider } from "../src/core/llm/llm-provider-factory.js";
import {
  createTranscriptFetcher,
  setTranscriptFetcher,
} from "../src/core/sources/transcript-fetcher-factory.js";
import { resolveLogsDir } from "../src/core/log-paths.js";
import { initRuntimeLogger } from "../src/core/logger.js";
import { setProjectRoot } from "../src/core/project-root.js";
import { cursorProjectDirFromRoot } from "../src/features/context/project-context-builder.js";
import { buildLocationsExcerpt } from "../src/features/categories/build-locations-excerpt.js";
import {
  createFinding,
  getFindingByCategoryAndId,
  saveFinding,
  setCategoriesStoreDeps,
  transitionFindingStatus,
} from "../src/features/categories/categories-store.js";
import {
  processCategoryImplementing,
  type IProcessCategoryImplementingDeps,
} from "../src/features/categories/category-implementing-processor.js";
import {
  processUndoCategory,
  type IProcessUndoCategoryDeps,
} from "../src/features/categories/undo-category-processor.js";
import { isAllowedItemTransition } from "../src/features/workflow/workflow-allowed-transitions.js";
import { writeGeneratedExclude } from "../src/features/context/repo-scope-config.js";

const scenarioId = "implementation-undo-approved-finding";
const categoryId = "display-name-normalization";
const sourcePath = "src/user-display-name.js";
const testPath = "test/user-display-name.test.mjs";

const originalSource = `export function buildDisplayName(input) {
  const firstName = input.firstName ?? "";
  const lastName = input.lastName ?? "";
  return \`\${firstName} \${lastName}\`;
}
`;

const behaviorTest = `import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDisplayName } from "../src/user-display-name.js";

test("buildDisplayName trims names and omits empty parts", () => {
  assert.equal(buildDisplayName({ firstName: " Ada ", lastName: " Lovelace " }), "Ada Lovelace");
  assert.equal(buildDisplayName({ firstName: " Ada ", lastName: "" }), "Ada");
  assert.equal(buildDisplayName({ firstName: "", lastName: " Lovelace " }), "Lovelace");
  assert.equal(buildDisplayName({ firstName: " ", lastName: " " }), "");
});
`;

type ICommandResult = {
  exitCode: number;
  output: string;
};

function writeProjectFixture(projectRoot: string): void {
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  mkdirSync(join(projectRoot, "test"), { recursive: true });
  writeFileSync(join(projectRoot, "package.json"), `{"type":"module"}\n`, "utf-8");
  writeFileSync(join(projectRoot, sourcePath), originalSource, "utf-8");
  writeFileSync(join(projectRoot, testPath), behaviorTest, "utf-8");
}

function runBehaviorTest(projectRoot: string): ICommandResult {
  try {
    const output = execFileSync("node", ["--test", testPath], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, output };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      "stdout" in error &&
      "stderr" in error
    ) {
      const status = typeof error.status === "number" ? error.status : 1;
      const stdout = typeof error.stdout === "string" ? error.stdout : "";
      const stderr = typeof error.stderr === "string" ? error.stderr : "";
      return { exitCode: status, output: `${stdout}${stderr}` };
    }
    throw error;
  }
}

function seedApprovedFinding(projectRoot: string): string {
  writeGeneratedExclude(projectRoot, ["node_modules", ".git", ".steward"]);
  const finding = createFinding({
    categoryId,
    workflowChatId: "implementation-undo-e2e-chat",
    status: STATUS.APPROVED,
    problem: {
      title: "Display Name Spacing",
      locations: [sourcePath],
      technicalFinding:
        "buildDisplayName interpolates raw firstName and lastName values, so whitespace-only and one-sided names keep extra spaces.",
      humanSummary: "Display names keep extra spaces when one of the name fields is blank.",
      humanCurrentBehavior:
        "The function joins names without trimming them or removing blank parts.",
      humanWhyItMatters: "User-facing names can look broken in account and team screens.",
      humanEvidence: [
        "firstName and lastName are read without trimming",
        "the return value always inserts one space",
      ],
      humanDecisionQuestion:
        "Should display names normalize whitespace before returning the final label?",
    },
    decision: {
      selectedOptionId: "A",
      options: [
        {
          id: "A",
          name: "Normalize Display Name",
          technicalPlan:
            "Update src/user-display-name.js so buildDisplayName trims firstName and lastName, removes empty parts, and joins the remaining parts with one space. Do not modify tests or unrelated files.",
          ruleConsideration:
            "Fixes the display-name behavior at the source with the smallest user-visible change.",
          humanSummary: "Trim the two name fields before building the display name.",
          humanChooseThisIf:
            "Choose this if blank or padded name fields should never leak into the UI.",
          humanTradeoff:
            "Names containing intentional leading or trailing spaces will be normalized.",
        },
        {
          id: "B",
          name: "Validate Before Formatting",
          technicalPlan:
            "Normalize firstName and lastName before callers pass them to buildDisplayName.",
          ruleConsideration: "Moves cleanup upstream but leaves this formatter easy to misuse.",
          humanSummary: "Clean the data before this function receives it.",
          humanChooseThisIf:
            "Choose this if every caller already has a shared input-validation layer.",
          humanTradeoff: "Future callers can still bypass the validation and recreate the bug.",
        },
      ],
    },
    dedupeKey: scenarioId,
  });
  saveFinding(projectRoot, finding);
  return finding.id;
}

function getRequiredFinding(
  projectRoot: string,
  findingId: string
): ReturnType<typeof getFindingByCategoryAndId> {
  const found = getFindingByCategoryAndId(projectRoot, categoryId, findingId);
  assert.ok(found, `Expected finding ${findingId} to exist.`);
  return found;
}

function buildImplementDeps(): IProcessCategoryImplementingDeps {
  return {
    cursorProjectDirFromRoot,
    implementingMaxRetries: 0,
    getCurrentContextFingerprintForItem: () => null,
    buildRulesContextExcerpt: () => "",
    buildProjectContextExcerpt: async () => "",
    buildLocationsExcerpt,
  };
}

function buildUndoDeps(): IProcessUndoCategoryDeps {
  return {
    cursorProjectDirFromRoot,
  };
}

function assertSourceChanged(projectRoot: string): void {
  const current = readFileSync(join(projectRoot, sourcePath), "utf-8");
  assert.notEqual(current, originalSource, "implementation should change the source file");
  assert.equal(
    readFileSync(join(projectRoot, testPath), "utf-8"),
    behaviorTest,
    "implementation should not modify the behavior test fixture"
  );
}

async function main(): Promise<number> {
  const env = loadEnv();
  const e2eTmpRoot = join(process.cwd(), "scripts", "logs", "e2e");
  mkdirSync(e2eTmpRoot, { recursive: true });
  const projectRoot = await mkdtemp(join(e2eTmpRoot, "implementation-undo-project-"));
  const logsRoot = await mkdtemp(join(e2eTmpRoot, "implementation-undo-logs-"));
  initRuntimeLogger(resolveLogsDir({ logsRootOverride: logsRoot }));
  setLlmProvider(createLlmProvider());
  setTranscriptFetcher(createTranscriptFetcher({ cursorProjectDirFromRoot }));
  setProjectRoot(projectRoot);
  setCategoriesStoreDeps({
    isAllowedItemTransition: (from, to) =>
      isAllowedItemTransition(ItemStatusSchema.parse(from), ItemStatusSchema.parse(to)),
  });

  const db = openRuntimeDb(projectRoot);
  let passed = false;
  try {
    setRuntimeDb(db);
    runSqliteMigrations(db);
    writeProjectFixture(projectRoot);

    const initialTest = runBehaviorTest(projectRoot);
    assert.notEqual(initialTest.exitCode, 0, "fixture test should fail before implementation");

    const findingId = seedApprovedFinding(projectRoot);
    assert.equal(
      transitionFindingStatus(projectRoot, categoryId, findingId, STATUS.CLAIMED),
      true,
      "approved finding should be claimable before implementation"
    );

    await processCategoryImplementing({
      projectRoot,
      categoryId,
      itemId: findingId,
      deps: buildImplementDeps(),
    });

    const implemented = getRequiredFinding(projectRoot, findingId);
    assert.equal(implemented?.item.status, STATUS.IMPLEMENTED);
    assert.ok(
      implemented?.item.lastImplementationResult?.fileChanges.some(
        (change) => change.path === sourcePath
      ),
      "implementation result should report the source file change"
    );
    assertSourceChanged(projectRoot);
    const implementedTest = runBehaviorTest(projectRoot);
    assert.equal(
      implementedTest.exitCode,
      0,
      `fixture test should pass after implementation:\n${implementedTest.output}`
    );

    const undoResult = await processUndoCategory({
      projectRoot,
      categoryId,
      itemId: findingId,
      deps: buildUndoDeps(),
    });
    assert.equal(undoResult.ok, true, "undo processor should report success");

    const reverted = getRequiredFinding(projectRoot, findingId);
    assert.equal(reverted?.item.status, STATUS.IMPLEMENTED);
    assert.equal(reverted?.item.hasBeenReverted, true);
    assert.ok(
      reverted?.item.lastUndoResult?.revertedFiles.includes(sourcePath),
      "undo result should report the source file as reverted"
    );
    assert.equal(
      readFileSync(join(projectRoot, sourcePath), "utf-8"),
      originalSource,
      "undo should restore the original source"
    );
    const revertedTest = runBehaviorTest(projectRoot);
    assert.notEqual(revertedTest.exitCode, 0, "fixture test should fail again after undo");

    console.log(`PASS ${scenarioId} provider=${env.CTO_LLM_PROVIDER}`);
    passed = true;
    return 0;
  } catch (error) {
    console.error(`FAIL ${scenarioId}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Project preserved for debugging: ${projectRoot}`);
    console.error(`Logs/artifacts preserved for debugging: ${logsRoot}`);
    return 1;
  } finally {
    clearRuntimeDb();
    closeRuntimeDb(db);
    if (passed) {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(logsRoot, { recursive: true, force: true });
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
