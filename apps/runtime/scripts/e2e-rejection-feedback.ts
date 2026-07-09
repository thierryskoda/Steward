#!/usr/bin/env -S npx tsx
/**
 * Backend E2E for the rejected-finding feedback loop. It creates a realistic
 * temp project, rejects a prior finding with a human reason, persists the real
 * option hint, regenerates a similar finding, then uses an LLM judge to verify
 * the generated options reflect the learned feedback.
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
import { runSqliteMigrations } from "../src/core/db/sqlite-migrations.js";
import { clearRuntimeDb, setRuntimeDb } from "../src/core/db/runtime-db.js";
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
  createFinding,
  listReviewFindingsForCategory,
  saveFinding,
  setCategoriesStoreDeps,
  transitionFindingStatus,
} from "../src/features/categories/categories-store.js";
import {
  generateCategory,
  type IGenerateCategoryDeps,
} from "../src/features/categories/generate-category.js";
import { setCategoryRegistryDeps } from "../src/features/categories/category-registry.js";
import {
  createOptionHintFromRejectedFinding,
  readOptionHints,
} from "../src/features/categories/option-hints-store.js";
import { isAllowedItemTransition } from "../src/features/workflow/workflow-allowed-transitions.js";
import {
  CONFIG_SCHEMA_VERSION,
  PROJECT_CONFIG_DEFAULT_FEATURES,
} from "../src/features/config/project-config-store.js";
import { rejectionFeedbackE2eJudgeAgent } from "../src/features/categories/rejection-feedback-e2e-judge.agent.js";

const scenarioId = "rejection-feedback-shapes-options";
const categoryId = "external-json-schema-validation";
const rulePath = "AGENTS.md";

const rejectedReason =
  "Do not suggest schema validation wrapper modules for webhook JSON parse fixes. Keep the fix inline at the JSON.parse request boundary.";

const ruleContent = `# Backend Review Rules

## External JSON Schema Validation

When backend code handles external JSON or webhook payloads, it must validate the parsed payload with an explicit schema before business logic reads fields. Report places where code trusts JSON.parse output, casts parsed data to a domain type, or silently falls back after parse failures.`;

const webhookHandler = `export function handleStripeWebhook(rawBody) {
  const payload = JSON.parse(rawBody);

  if (payload.type === "invoice.paid") {
    return {
      status: "paid",
      customerId: payload.data.object.customer,
      invoiceId: payload.data.object.id,
    };
  }

  return {
    status: "ignored",
    customerId: payload.data.object.customer,
    invoiceId: payload.data.object.id,
  };
}
`;

const projectEvidence = `The temp project contains src/stripe-webhook.js.
- handleStripeWebhook receives raw webhook JSON in rawBody.
- It calls JSON.parse(rawBody) directly.
- It then reads payload.type, payload.data.object.customer, and payload.data.object.id without schema validation.
- The prior human rejection said not to solve this by creating schema validation wrapper modules; future options should keep validation inline or directly at the JSON.parse request boundary.`;

function writeProjectFixture(projectRoot: string): void {
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, rulePath), ruleContent, "utf-8");
  writeFileSync(join(projectRoot, "README.md"), "# Webhook Runtime\n", "utf-8");
  writeFileSync(join(projectRoot, "src", "stripe-webhook.js"), webhookHandler, "utf-8");
}

function seedRuntimeConfig(projectRoot: string): void {
  writeRepoScopeConfig(projectRoot, {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    ruleSources: [rulePath],
    approvalMode: APPROVAL_MODE_ALWAYS_APPROVE,
    projectContext: [],
    features: {
      ...PROJECT_CONFIG_DEFAULT_FEATURES,
      optionHintsEnabled: true,
    },
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

function seedRejectedFindingAndHint(projectRoot: string): string {
  const finding = createFinding({
    categoryId,
    workflowChatId: "rejection-feedback-prior-chat",
    status: STATUS.NEEDS_REVIEW,
    problem: {
      title: "Webhook JSON Validation",
      locations: ["src/stripe-webhook.js"],
      technicalFinding:
        "Webhook JSON is parsed and trusted without schema validation before nested fields are read.",
      humanSummary: "Webhook payloads are trusted before their shape is checked.",
      humanCurrentBehavior:
        "The handler parses raw JSON and immediately reads nested payload fields.",
      humanWhyItMatters: "Malformed or unexpected webhook payloads can break payment handling.",
      humanEvidence: ["JSON.parse(rawBody) is used directly", "Nested payload fields are read"],
      humanDecisionQuestion:
        "Should webhook parsing validate payload shape before reading business fields?",
    },
    decision: {
      options: [
        {
          id: "A",
          name: "Create Validation Wrapper",
          technicalPlan:
            "Create a reusable webhook validation wrapper module and route Stripe webhook parsing through it.",
          ruleConsideration:
            "A wrapper centralizes validation but moves the fix away from the local parse boundary.",
          humanSummary: "Move webhook validation into a shared wrapper.",
          humanChooseThisIf: "Choose this if many webhook handlers need the same validation layer.",
          humanTradeoff: "The fix is broader and adds another module to maintain.",
        },
        {
          id: "B",
          name: "Validate Inline Boundary",
          technicalPlan:
            "Validate the parsed payload directly inside src/stripe-webhook.js before reading nested fields.",
          ruleConsideration: "Inline validation keeps the fix close to the unsafe parse.",
          humanSummary: "Validate the payload where it is parsed.",
          humanChooseThisIf: "Choose this if this handler is the only unsafe boundary.",
          humanTradeoff: "Validation is local instead of shared across handlers.",
        },
      ],
    },
    dedupeKey: "prior-rejected-wrapper-module-option",
  });
  saveFinding(projectRoot, finding);
  assert.equal(
    transitionFindingStatus(projectRoot, categoryId, finding.id, STATUS.REJECTED, {
      rejectedReason,
    }),
    true,
    "prior finding should transition to rejected with the human reason"
  );
  const hintResult = createOptionHintFromRejectedFinding({
    projectRoot,
    categoryId,
    itemId: finding.id,
    rejectedReason,
  });
  assert.equal(hintResult.outcome, "created", "rejection should create an option hint");
  return finding.id;
}

async function createRequiredChatId(): Promise<string | null> {
  const chatId = await getLlmProvider().createConversationId();
  if (chatId === null) {
    throw new Error("LLM provider did not create a conversation id for rejection feedback E2E.");
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
  const e2eTmpRoot = join(process.cwd(), "scripts", "logs", "e2e");
  mkdirSync(e2eTmpRoot, { recursive: true });
  const projectRoot = await mkdtemp(join(e2eTmpRoot, "rejection-feedback-project-"));
  const logsRoot = await mkdtemp(join(e2eTmpRoot, "rejection-feedback-logs-"));
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
    const priorFindingId = seedRejectedFindingAndHint(projectRoot);

    const hints = readOptionHints(projectRoot);
    assert.equal(hints.length, 1, "one option hint should be persisted");
    const hint = hints[0];
    assert.ok(hint, "persisted option hint should be readable");
    assert.equal(hint.categoryId, categoryId);
    assert.equal(hint.evidenceItemId, priorFindingId);
    assert.ok(
      hint.instruction.includes("wrapper modules") ||
        hint.instruction.includes("JSON.parse request boundary"),
      `hint should preserve the rejected reason; got ${hint.instruction}`
    );

    const result = await generateCategory({
      projectRoot,
      categoryId,
      deps: buildCategoryDeps(),
    });
    assert.equal(result.didRun, true, "category generation should run");
    assert.equal(result.findingsCount, 1, "category generation should persist one new finding");

    const findings = listReviewFindingsForCategory(projectRoot, categoryId);
    assert.equal(findings.length, 1, "one future finding should be pending review");
    const finding = findings[0];
    assert.ok(finding, "future finding should be present");
    assert.equal(finding.status, STATUS.NEEDS_REVIEW);
    assert.ok(finding.problem, "future finding should include a problem");
    assert.ok(finding.decision, "future finding should include a decision");

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
      "always_approve should produce two future options"
    );

    const generatedArtifactPath = writeArtifact({
      logsRoot,
      name: `${scenarioId}-generated`,
      payload: {
        scenarioId,
        projectRoot,
        categoryId,
        rejectedReason,
        learnedInstruction: hint.instruction,
        projectEvidence,
        finding: inboxFinding,
      },
    });

    const judgeResult = await runStructuredAgent({
      agent: rejectionFeedbackE2eJudgeAgent,
      input: {
        scenarioId,
        rejectedReason,
        learnedInstruction: hint.instruction,
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
