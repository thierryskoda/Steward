#!/usr/bin/env -S npx tsx
/**
 * Backend E2E for the transcript-to-rule learning loop. It creates a temp repo,
 * starts the real transcript ingestion service on a Cursor-style transcript path,
 * appends a user-stated code standard, verifies a rule proposal is captured,
 * approves it, runs the real rule apply worker, and judges the applied rule.
 */
import "./load-env.js";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ItemStatusSchema, STATUS } from "@steward/contracts/schemas";
import { closeRuntimeDb, openRuntimeDb } from "../src/core/db/sqlite-connection.js";
import { runSqliteMigrations } from "../src/core/db/sqlite-migrations.js";
import { clearRuntimeDb, setRuntimeDb } from "../src/core/db/runtime-db.js";
import { createLlmProvider, setLlmProvider } from "../src/core/llm/llm-provider-factory.js";
import { runStructuredAgent } from "../src/core/llm/run-structured.agent.js";
import { createTranscriptIngestionService } from "../src/core/sources/transcript-ingestion-service.js";
import { createSqliteCheckpointStore } from "../src/core/sources/sqlite-checkpoint-store.js";
import { resolveLogsDir } from "../src/core/log-paths.js";
import { initRuntimeLogger } from "../src/core/logger.js";
import { setProjectRoot } from "../src/core/project-root.js";
import { cursorRulesDir } from "../src/core/paths.js";
import {
  cursorProjectDirFromRoot,
  findTranscriptPaths,
} from "../src/features/context/project-context-builder.js";
import {
  computeSourcesHash,
  readSourceDocs,
  writeSnapshot,
} from "../src/features/categories/rules-snapshot.js";
import { createRulesTranscriptSubscriber } from "../src/features/rules/transcript-subscriber.js";
import { createRuleCaptureAgentRunner } from "../src/features/rules/rule-capture.js";
import {
  findRuleById,
  listReviewRules,
  setRulesStoreDeps,
  transitionRuleStatus,
} from "../src/features/rules/rules-store.js";
import { runRuleApplyWorker } from "../src/features/rules/rule-apply-worker.js";
import { isAllowedRuleTransition } from "../src/features/workflow/workflow-allowed-transitions.js";
import { transcriptRuleE2eJudgeAgent } from "../src/features/rules/transcript-rule-e2e-judge.agent.js";

const scenarioId = "transcript-rule-capture-apply";
const rulePath = "AGENTS.md";
const chatId = "transcript-rule-e2e-chat";
const transcriptMessage =
  "Going forward, whenever backend code parses external JSON from webhooks or API requests, validate the parsed value with a Zod schema before reading fields. Do not cast JSON.parse results directly to domain types.";

const initialRules = `# Project Rules

## General TypeScript

- Keep backend request handlers small and explicit.
`;

type IWaitForProposalResult = {
  id: string;
  title: string;
  ruleText: string;
  rationale: string;
};

function writeProjectFixture(projectRoot: string): void {
  writeFileSync(join(projectRoot, rulePath), initialRules, "utf-8");
  mkdirSync(cursorRulesDir(projectRoot), { recursive: true });
}

function seedRulesSnapshot(projectRoot: string): void {
  const sourceEntries = readSourceDocs(projectRoot, [rulePath]);
  writeSnapshot(projectRoot, {
    sourcesHash: computeSourcesHash(sourceEntries),
    extractorVersion: "1",
    generatedAt: Date.now(),
    categories: [
      {
        categoryId: "general-typescript",
        rulePath,
        ruleContent: initialRules,
      },
    ],
  });
}

function writeEmptyTranscript(args: { cursorProjectsRoot: string; projectRoot: string }): string {
  const transcriptsDir = join(
    args.cursorProjectsRoot,
    cursorProjectDirFromRoot(args.projectRoot),
    "agent-transcripts"
  );
  mkdirSync(transcriptsDir, { recursive: true });
  const transcriptPath = join(transcriptsDir, `${chatId}.jsonl`);
  writeFileSync(transcriptPath, "", "utf-8");
  return transcriptPath;
}

function appendTranscriptMessage(transcriptPath: string): void {
  const line = JSON.stringify({
    role: "user",
    message: {
      content: [{ type: "text", text: transcriptMessage }],
    },
  });
  writeFileSync(transcriptPath, `${line}\n`, { encoding: "utf-8", flag: "a" });
}

function readRuleSourcesContent(projectRoot: string): string {
  return readSourceDocs(projectRoot, [rulePath])
    .map((entry) => entry.content)
    .join("\n\n---\n\n");
}

async function waitForRuleProposal(projectRoot: string): Promise<IWaitForProposalResult> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 90_000) {
    const proposals = listReviewRules(projectRoot);
    if (proposals.length > 0) {
      const proposal = proposals[0]!;
      return {
        id: proposal.id,
        title: proposal.title,
        ruleText: proposal.ruleText,
        rationale: proposal.rationale,
      };
    }
    await delay(500);
  }
  throw new Error("Timed out waiting for transcript rule proposal.");
}

function findAppliedRuleFile(projectRoot: string): { path: string; content: string } {
  const rulesDir = cursorRulesDir(projectRoot);
  if (!existsSync(rulesDir)) {
    throw new Error(`Rules directory was not created: ${rulesDir}`);
  }
  const candidates = readdirSync(rulesDir)
    .filter((name) => name.endsWith(".mdc") || name.endsWith(".md"))
    .sort();
  for (const candidate of candidates) {
    const path = join(rulesDir, candidate);
    const content = readFileSync(path, "utf-8");
    if (content.includes("JSON") || content.includes("Zod") || content.includes("schema")) {
      return { path, content };
    }
  }
  throw new Error(
    `No applied rule file containing JSON/Zod/schema guidance found under ${rulesDir}. Files: ${candidates.join(", ")}`
  );
}

function writeArtifact(args: { logsRoot: string; name: string; payload: unknown }): string {
  const artifactsDir = join(args.logsRoot, "e2e-artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  const path = join(artifactsDir, `${args.name}.json`);
  writeFileSync(path, JSON.stringify(args.payload, null, 2), "utf-8");
  return path;
}

async function main(): Promise<number> {
  const e2eTmpRoot = join(process.cwd(), "scripts", "logs", "e2e");
  mkdirSync(e2eTmpRoot, { recursive: true });
  const projectRoot = await mkdtemp(join(e2eTmpRoot, "transcript-rule-project-"));
  const logsRoot = await mkdtemp(join(e2eTmpRoot, "transcript-rule-logs-"));
  const cursorProjectsRoot = await mkdtemp(join(tmpdir(), "cto-transcript-rule-cursor-projects-"));
  initRuntimeLogger(resolveLogsDir({ logsRootOverride: logsRoot }));
  setLlmProvider(createLlmProvider());
  setProjectRoot(projectRoot);
  setRulesStoreDeps({
    isAllowedRuleTransition: (from, to) =>
      isAllowedRuleTransition(from, ItemStatusSchema.parse(to)),
  });

  const db = openRuntimeDb(projectRoot);
  let passed = false;
  let stopIngestion: (() => void) | undefined;
  try {
    setRuntimeDb(db);
    runSqliteMigrations(db);
    writeProjectFixture(projectRoot);
    seedRulesSnapshot(projectRoot);

    const transcriptPath = writeEmptyTranscript({ cursorProjectsRoot, projectRoot });
    const seenIds = new Set<string>();
    const subscriber = createRulesTranscriptSubscriber({
      projectRoot,
      seenIds,
      createRuleCaptureAgentRunner,
      getRuleSourcesContent: readRuleSourcesContent,
      getFeatureFlags: () => ({ rulesWorkflowEnabled: true }),
    });
    const ingestionService = createTranscriptIngestionService({
      getPaths: () => findTranscriptPaths({ projectRoot, cursorProjectsRoot }),
      checkpointStore: createSqliteCheckpointStore(),
      pollIntervalMs: 100,
      subscribers: [subscriber],
    });
    stopIngestion = () => ingestionService.stop();
    ingestionService.start();
    appendTranscriptMessage(transcriptPath);

    const proposal = await waitForRuleProposal(projectRoot);
    assert.ok(proposal.ruleText.toLowerCase().includes("json"));
    assert.ok(
      proposal.ruleText.toLowerCase().includes("zod") ||
        proposal.ruleText.toLowerCase().includes("schema"),
      `proposal should mention Zod or schema validation; got ${proposal.ruleText}`
    );
    assert.ok(
      proposal.ruleText.toLowerCase().includes("before") ||
        proposal.ruleText.toLowerCase().includes("prior"),
      `proposal should preserve ordering before field reads; got ${proposal.ruleText}`
    );

    assert.equal(
      transitionRuleStatus(projectRoot, proposal.id, STATUS.APPROVED),
      true,
      "captured rule proposal should be approvable"
    );
    await runRuleApplyWorker({
      projectRoot,
      implementingMaxRetries: 0,
      isRulesWorkflowEnabled: true,
    });

    const appliedRule = findRuleById(projectRoot, proposal.id)?.rule;
    assert.ok(appliedRule, "applied rule should still be readable from SQLite");
    assert.equal(appliedRule.status, STATUS.IMPLEMENTED);
    const appliedFile = findAppliedRuleFile(projectRoot);
    assert.ok(
      appliedFile.content.toLowerCase().includes("json") &&
        (appliedFile.content.toLowerCase().includes("zod") ||
          appliedFile.content.toLowerCase().includes("schema")),
      `applied rule file should contain JSON schema guidance; got ${appliedFile.content}`
    );

    const generatedArtifactPath = writeArtifact({
      logsRoot,
      name: `${scenarioId}-generated`,
      payload: {
        scenarioId,
        projectRoot,
        transcriptPath,
        transcriptMessage,
        proposal,
        appliedFile,
      },
    });

    const judgeResult = await runStructuredAgent({
      agent: transcriptRuleE2eJudgeAgent,
      input: {
        scenarioId,
        transcriptMessage,
        proposalTitle: proposal.title,
        proposalRuleText: proposal.ruleText,
        appliedRuleFileContent: appliedFile.content,
      },
      workspace: projectRoot,
    });
    const judgeArtifactPath = writeArtifact({
      logsRoot,
      name: `${scenarioId}-judge`,
      payload: { scenarioId, generatedArtifactPath, judgeResult },
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

    console.log(`PASS ${scenarioId}`);
    passed = true;
    return 0;
  } catch (error) {
    console.error(`FAIL ${scenarioId}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Project preserved for debugging: ${projectRoot}`);
    console.error(`Logs/artifacts preserved for debugging: ${logsRoot}`);
    return 1;
  } finally {
    stopIngestion?.();
    clearRuntimeDb();
    closeRuntimeDb(db);
    if (passed) {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(logsRoot, { recursive: true, force: true });
    }
    rmSync(cursorProjectsRoot, { recursive: true, force: true });
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
