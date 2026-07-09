#!/usr/bin/env -S npx tsx
/**
 * Backend E2E for generated finding cards. It creates a realistic temp project,
 * runs the real category generation pipeline, validates the persisted JSON contract,
 * then uses an LLM judge for semantic quality.
 */
import "./load-env.js";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import {
  APPROVAL_MODE_ALWAYS_APPROVE,
  InboxFindingItemSchema,
  ItemStatusSchema,
  STATUS,
} from "@steward/contracts/schemas";
import { closeRuntimeDb, openRuntimeDb } from "../src/core/db/sqlite-connection.js";
import { clearRuntimeDb, setRuntimeDb } from "../src/core/db/runtime-db.js";
import { runSqliteMigrations } from "../src/core/db/sqlite-migrations.js";
import { loadEnv } from "../src/core/env.js";
import {
  createLlmProvider,
  getLlmProvider,
  setLlmProvider,
} from "../src/core/llm/llm-provider-factory.js";
import { runStructuredAgent } from "../src/core/llm/run-structured.agent.js";
import { resolveLogsDir } from "../src/core/log-paths.js";
import { initRuntimeLogger } from "../src/core/logger.js";
import { setProjectRoot } from "../src/core/project-root.js";
import { buildCursorRulesContext } from "../src/features/context/cursor-rules-context.js";
import {
  readRepoScopeConfigFromDisk,
  writeGeneratedExclude,
  writeRepoScopeConfig,
} from "../src/features/context/repo-scope-config.js";
import {
  computeSourcesHash,
  readSourceDocs,
  writeSnapshot,
} from "../src/features/categories/rules-snapshot.js";
import {
  generateCategory,
  type IGenerateCategoryDeps,
} from "../src/features/categories/generate-category.js";
import { setCategoryRegistryDeps } from "../src/features/categories/category-registry.js";
import {
  listReviewFindingsForCategory,
  setCategoriesStoreDeps,
} from "../src/features/categories/categories-store.js";
import { isAllowedItemTransition } from "../src/features/workflow/workflow-allowed-transitions.js";
import { categoryGenerationE2eJudgeAgent } from "../src/features/categories/category-generation-e2e-judge.agent.js";
import {
  CONFIG_SCHEMA_VERSION,
  PROJECT_CONFIG_DEFAULT_FEATURES,
} from "../src/features/config/project-config-store.js";

const scenarioId = "category-generation-decision-card";
const categoryId = "external-json-schema-validation";
const rulePath = "AGENTS.md";

const ruleContent = `# Backend Review Rules

## External JSON Schema Validation

When backend code handles external JSON or webhook payloads, it must validate the parsed payload with an explicit schema before business logic reads fields. Report places where code trusts JSON.parse output, casts parsed data to a domain type, or silently falls back after parse failures.`;

const webhookHandler = `type BillingWebhook = {
  event: "invoice.paid" | "invoice.failed";
  customerId: string;
  invoiceId: string;
};

export function handleBillingWebhook(rawBody: string): string {
  const payload = JSON.parse(rawBody) as BillingWebhook;

  if (payload.event === "invoice.paid") {
    return \`mark-paid:\${payload.customerId}:\${payload.invoiceId}\`;
  }

  return \`needs-review:\${payload.customerId}\`;
}
`;

const importHandler = `type ImportRequest = {
  source: string;
  requestedBy: string;
};

export function parseImportRequest(rawBody: string): ImportRequest {
  try {
    return JSON.parse(rawBody) as ImportRequest;
  } catch {
    return { source: "unknown", requestedBy: "unknown" };
  }
}
`;

const projectEvidence = `The temp project contains two backend files:
- src/billing-webhook.ts parses raw webhook JSON and casts it to BillingWebhook before reading event, customerId, and invoiceId.
- src/import-request.ts parses raw request JSON as ImportRequest and silently falls back to unknown values after parse failure.

Both files handle external request payloads. Neither file validates parsed JSON with Zod or another explicit schema before business logic reads fields.`;

function writeProjectFixture(projectRoot: string): void {
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, rulePath), ruleContent, "utf-8");
  writeFileSync(join(projectRoot, "README.md"), "# Payments Runtime\n", "utf-8");
  writeFileSync(join(projectRoot, "src", "billing-webhook.ts"), webhookHandler, "utf-8");
  writeFileSync(join(projectRoot, "src", "import-request.ts"), importHandler, "utf-8");
}

function seedRuntimeConfig(projectRoot: string): void {
  writeRepoScopeConfig(projectRoot, {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    ruleSources: [rulePath],
    approvalMode: APPROVAL_MODE_ALWAYS_APPROVE,
    projectContext: [],
    features: PROJECT_CONFIG_DEFAULT_FEATURES,
  });
  writeGeneratedExclude(projectRoot, ["node_modules", ".git", ".steward"]);
  const sourceEntries = readSourceDocs(projectRoot, [rulePath]);
  const sourcesHash = computeSourcesHash(sourceEntries);
  writeSnapshot(projectRoot, {
    sourcesHash,
    extractorVersion: "1",
    generatedAt: Date.now(),
    categories: [
      {
        categoryId,
        rulePath,
        ruleContent,
      },
    ],
  });
}

async function createRequiredChatId(): Promise<string | null> {
  const chatId = await getLlmProvider().createConversationId();
  if (chatId === null) {
    throw new Error("LLM provider did not create a conversation id for category generation.");
  }
  return chatId;
}

function buildCategoryDeps(): IGenerateCategoryDeps {
  return {
    createChatId: createRequiredChatId,
    runStructuredAgent,
    buildProjectContextForAgent: async () => projectEvidence,
    buildCursorRulesContext: (root) =>
      buildCursorRulesContext(root, { getSourceDocs: readSourceDocs }),
    getApprovalMode: () => APPROVAL_MODE_ALWAYS_APPROVE,
    readRepoScopeConfigFromDisk,
    getExclude: () => ["node_modules", ".git", ".steward"],
    getIgnoreMatcher: () => {
      const excluded = new Set(["node_modules", ".git", ".steward"]);
      return (path: string): boolean =>
        path
          .replaceAll("\\", "/")
          .split("/")
          .some((segment) => excluded.has(segment));
    },
    getCurrentContextFingerprint: () => null,
  };
}

function writeArtifact(args: { logsRoot: string; name: string; payload: unknown }): string {
  const artifactsDir = join(args.logsRoot, "e2e-artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  const path = join(artifactsDir, `${args.name}.json`);
  writeFileSync(path, JSON.stringify(args.payload, null, 2), "utf-8");
  return path;
}

function readArtifact(path: string): unknown {
  if (!existsSync(path)) {
    throw new Error(`Expected artifact was not written: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

async function main(): Promise<number> {
  const env = loadEnv();
  const e2eTmpRoot = join(process.cwd(), "scripts", "logs", "e2e");
  mkdirSync(e2eTmpRoot, { recursive: true });
  const projectRoot = await mkdtemp(join(e2eTmpRoot, "category-generation-project-"));
  const logsRoot = await mkdtemp(join(e2eTmpRoot, "category-generation-logs-"));
  initRuntimeLogger(resolveLogsDir({ logsRootOverride: logsRoot }));
  setLlmProvider(createLlmProvider());
  setProjectRoot(projectRoot);
  setCategoryRegistryDeps({ readRepoScopeConfigFromDisk });
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
    seedRuntimeConfig(projectRoot);

    const result = await generateCategory({
      projectRoot,
      categoryId,
      deps: buildCategoryDeps(),
    });
    assert.equal(result.didRun, true, "category generation should run");
    assert.equal(result.findingsCount, 1, "category generation should persist one finding");

    const findings = listReviewFindingsForCategory(projectRoot, categoryId);
    assert.equal(findings.length, 1, "one finding should be pending review");
    const finding = findings[0];
    assert.ok(finding, "generated finding should be present");
    assert.equal(finding.status, STATUS.NEEDS_REVIEW);
    assert.ok(finding.problem, "generated finding should include a problem");
    assert.ok(finding.decision, "generated finding should include a decision");

    const inboxFinding = InboxFindingItemSchema.parse({
      type: "finding",
      categoryId,
      id: finding.id,
      problem: finding.problem,
      decision: finding.decision,
      createdAt: finding.createdAt,
    });
    assert.equal(
      inboxFinding.decision.options.length,
      2,
      "always_approve should produce two options"
    );

    const generatedArtifactPath = writeArtifact({
      logsRoot,
      name: `${scenarioId}-generated`,
      payload: {
        scenarioId,
        provider: env.CTO_LLM_PROVIDER,
        projectRoot,
        categoryId,
        ruleContent,
        projectEvidence,
        finding: inboxFinding,
      },
    });

    const judgeResult = await runStructuredAgent({
      agent: categoryGenerationE2eJudgeAgent,
      input: {
        scenarioId,
        categoryId,
        ruleContent,
        projectEvidence,
        problem: inboxFinding.problem,
        decision: inboxFinding.decision,
      },
      workspace: projectRoot,
    });

    const judgeArtifactPath = writeArtifact({
      logsRoot,
      name: `${scenarioId}-judge`,
      payload: {
        scenarioId,
        generatedArtifactPath,
        judgeResult,
      },
    });

    assert.equal(
      judgeResult.is_correct,
      true,
      `${scenarioId}: ${judgeResult.reason}; artifact: ${judgeArtifactPath}`
    );
    assert.equal(
      judgeResult.reason,
      "",
      `${scenarioId}: judge reason must be empty when passing; artifact: ${judgeArtifactPath}`
    );
    assert.deepEqual(
      readArtifact(judgeArtifactPath),
      {
        scenarioId,
        generatedArtifactPath,
        judgeResult,
      },
      "judge artifact should be readable"
    );

    console.log(`PASS ${scenarioId}`);
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
