import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APPROVAL_MODE_ALWAYS_APPROVE, ItemStatusSchema, STATUS } from "@steward/contracts/schemas";
import { setRuntimeDb, clearRuntimeDb } from "../../core/db/runtime-db.js";
import {
  closeRuntimeDb,
  openRuntimeDb,
  type ISqliteConnection,
} from "../../core/db/sqlite-connection.js";
import { runSqliteMigrations } from "../../core/db/sqlite-migrations.js";
import { setProjectRoot } from "../../core/project-root.js";
import { writeRepoScopeConfig } from "../context/repo-scope-config.js";
import { writeSnapshot } from "./rules-snapshot.js";
import { setCategoryRegistryDeps } from "./category-registry.js";
import { setCategoriesStoreDeps } from "./categories-store.js";
import { isAllowedItemTransition } from "../workflow/workflow-allowed-transitions.js";
import { generateCategory, type IGenerateCategoryDeps } from "./generate-category.js";
import { detectCategoryAgent } from "./detect-category.agent.js";
import { generateDetectionQuestionsAgent } from "./generate-detection-questions.agent.js";
import { generateFixConstraintsAgent } from "./generate-fix-constraints.agent.js";
import { generateOptionsAgent } from "./generate-options.agent.js";
import { humanizeCategoryAgent } from "./humanize-category.agent.js";
import { judgeGeneratedFindingAgent } from "./judge-generated-finding.agent.js";
import { repairGeneratedFindingAgent } from "./repair-generated-finding.agent.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";

const categoryId = "json-boundary-validation";
const ruleContent = "External JSON must be validated with Zod before business logic reads it.";

let projectRoot: string | null = null;
let db: ISqliteConnection | null = null;

function setupProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cto-category-quality-gate-"));
  writeFileSync(join(root, "AGENTS.md"), ruleContent, "utf-8");
  writeFileSync(
    join(root, "handler.ts"),
    "export function handler(raw: string) { return JSON.parse(raw).id; }\n",
    "utf-8"
  );
  return root;
}

function writeRuntimeState(root: string): void {
  writeRepoScopeConfig(root, {
    schemaVersion: 2,
    ruleSources: ["AGENTS.md"],
    approvalMode: APPROVAL_MODE_ALWAYS_APPROVE,
    projectContext: [],
    features: {
      genericFindingEnabled: true,
      rulesWorkflowEnabled: false,
      continualLearningEnabled: false,
      optionHintsEnabled: false,
    },
  });
  writeSnapshot(root, {
    sourcesHash: "test-hash",
    extractorVersion: "1",
    generatedAt: Date.now(),
    categories: [{ categoryId, rulePath: "AGENTS.md", ruleContent }],
  });
}

function baseDeps(args: {
  judgeDecision: "accept" | "repair" | "drop";
  repairedTitle?: string;
}): IGenerateCategoryDeps {
  let judgeCallCount = 0;
  function outputForAgent(agentId: string): unknown {
    if (agentId === generateDetectionQuestionsAgent.id) {
      return {
        questions: [
          "Where is external JSON parsed?",
          "Where is parsed JSON read without validation?",
          "Which handlers trust parsed payload fields?",
        ],
      };
    }
    if (agentId === detectCategoryAgent.id) {
      return {
        findingKey: "json-parse-unvalidated",
        title: "External JSON Unvalidated",
        finding:
          "handler.ts parses external JSON and reads id before validating the payload with a schema.",
        locations: ["handler.ts"],
      };
    }
    if (agentId === generateFixConstraintsAgent.id) {
      return {
        constraints: [
          "Add a Zod schema for the external payload.",
          "Validate before reading parsed fields.",
          "Fail fast on invalid payloads.",
        ],
      };
    }
    if (agentId === generateOptionsAgent.id) {
      return {
        options: [
          {
            id: "A",
            name: "Validate External Payload",
            technicalPlan:
              "1. Add a Zod schema for handler input. 2. Parse raw JSON as unknown. 3. Validate with safeParse before reading id. 4. Return a clear failure when invalid.",
            ruleConsideration:
              "The category rule requires schema validation before business logic reads external JSON.",
          },
          {
            id: "B",
            name: "Centralize Payload Validation",
            technicalPlan:
              "1. Add a local payload validation helper beside handler.ts. 2. Validate parsed JSON before field access. 3. Keep the helper specific to this boundary. 4. Reuse it only in this handler.",
            ruleConsideration:
              "This keeps validation at the boundary while allowing a named helper for this input shape.",
          },
        ],
      };
    }
    if (agentId === humanizeCategoryAgent.id) {
      return {
        humanSummary: "External payloads are read before validation.",
        humanCurrentBehavior: "The handler trusts parsed JSON fields directly.",
        humanWhyItMatters: "Invalid input can reach business logic unchecked.",
        humanEvidence: ["JSON.parse result read directly"],
        humanDecisionQuestion: "How should payload validation be added?",
        options: [
          {
            id: "A",
            humanSummary: "Validate the payload directly in the handler.",
            humanChooseThisIf: "Choose this if you want the smallest boundary fix.",
            humanTradeoff: "You get a focused fix but no reusable helper.",
          },
          {
            id: "B",
            humanSummary: "Create a small local validator for this payload.",
            humanChooseThisIf: "Choose this if this handler benefits from a named validator.",
            humanTradeoff: "You get clearer structure but one extra local function.",
          },
        ],
      };
    }
    if (agentId === judgeGeneratedFindingAgent.id) {
      judgeCallCount += 1;
      const decision =
        args.judgeDecision === "repair" && judgeCallCount > 1 ? "accept" : args.judgeDecision;
      return {
        decision,
        reasons: decision === "accept" ? [] : ["Needs stronger evidence."],
      };
    }
    if (agentId === repairGeneratedFindingAgent.id) {
      return {
        problem: {
          title: args.repairedTitle ?? "Boundary JSON Validation",
          locations: ["handler.ts"],
          technicalFinding:
            "handler.ts reads id from parsed external JSON before schema-validating the payload.",
          humanSummary: "External payloads are read before validation.",
          humanCurrentBehavior: "The handler trusts parsed JSON fields directly.",
          humanWhyItMatters: "Invalid input can reach business logic unchecked.",
          humanEvidence: ["JSON.parse result read directly"],
          humanDecisionQuestion: "How should payload validation be added?",
        },
        decision: {
          options: [
            {
              id: "A",
              name: "Validate External Payload",
              technicalPlan:
                "1. Parse raw JSON as unknown. 2. Validate the payload with a Zod schema before reading id. 3. Return a clear invalid-input failure.",
              ruleConsideration:
                "The category rule requires validation before reading external JSON fields.",
              humanSummary: "Validate the payload directly in the handler.",
              humanChooseThisIf: "Choose this if you want the smallest boundary fix.",
              humanTradeoff: "You get a focused fix but no reusable helper.",
            },
            {
              id: "B",
              name: "Extract Payload Validator",
              technicalPlan:
                "1. Add a local validator for the handler payload. 2. Call it immediately after parsing. 3. Keep the validator scoped to this boundary.",
              ruleConsideration:
                "The category rule allows a local helper when it keeps validation at the boundary.",
              humanSummary: "Create a small local validator for this payload.",
              humanChooseThisIf: "Choose this if this handler benefits from a named validator.",
              humanTradeoff: "You get clearer structure but one extra local function.",
            },
          ],
        },
      };
    }
    throw new Error(`Unhandled agent in test: ${agentId}`);
  }

  async function runStructuredAgentStub<TInput, TOutput>(args: {
    agent: IAgentSpec<TInput, TOutput>;
    input: TInput;
    workspace: string;
    resumeChatId?: string;
  }): Promise<TOutput> {
    void args.input;
    void args.workspace;
    void args.resumeChatId;
    return args.agent.outputSchema.parse(outputForAgent(args.agent.id));
  }

  return {
    createChatId: async (): Promise<string | null> => "chat-1",
    buildProjectContextForAgent: async (): Promise<string> =>
      "handler.ts parses external JSON and reads id without schema validation.",
    buildCursorRulesContext: (): string => ruleContent,
    getApprovalMode: () => APPROVAL_MODE_ALWAYS_APPROVE,
    readRepoScopeConfigFromDisk: () => ({
      ruleSources: ["AGENTS.md"],
      approvalMode: APPROVAL_MODE_ALWAYS_APPROVE,
      projectContext: [],
      features: { optionHintsEnabled: false },
    }),
    getExclude: () => [".steward"],
    getIgnoreMatcher:
      () =>
      (path: string): boolean =>
        path.includes(".steward"),
    getCurrentContextFingerprint: () => null,
    runStructuredAgent: runStructuredAgentStub,
  };
}

beforeEach(() => {
  projectRoot = setupProject();
  db = openRuntimeDb(projectRoot);
  setRuntimeDb(db);
  runSqliteMigrations(db);
  setProjectRoot(projectRoot);
  writeRuntimeState(projectRoot);
  setCategoryRegistryDeps({
    readRepoScopeConfigFromDisk: () => ({ ruleSources: ["AGENTS.md"] }),
  });
  setCategoriesStoreDeps({
    isAllowedItemTransition: (from: string, to: string): boolean =>
      isAllowedItemTransition(ItemStatusSchema.parse(from), ItemStatusSchema.parse(to)),
  });
});

afterEach(() => {
  clearRuntimeDb();
  if (db !== null) {
    closeRuntimeDb(db);
    db = null;
  }
  if (projectRoot !== null) {
    rmSync(projectRoot, { recursive: true, force: true });
    projectRoot = null;
  }
});

describe("generateCategory quality gate", () => {
  it("persists a generated finding when the quality judge accepts it", async () => {
    const root = projectRoot!;

    const result = await generateCategory({
      projectRoot: root,
      categoryId,
      deps: baseDeps({ judgeDecision: "accept" }),
    });

    expect(result).toEqual({ didRun: true, findingsCount: 1 });
    const rows = db!.prepare("SELECT status FROM findings").all() as { status: string }[];
    expect(rows).toEqual([{ status: STATUS.NEEDS_REVIEW }]);
  });

  it("drops a generated finding before persistence when the quality judge rejects it", async () => {
    const root = projectRoot!;

    const result = await generateCategory({
      projectRoot: root,
      categoryId,
      deps: baseDeps({ judgeDecision: "drop" }),
    });

    expect(result).toEqual({ didRun: true, findingsCount: 0 });
    const rows = db!.prepare("SELECT id FROM findings").all();
    expect(rows).toEqual([]);
  });

  it("repairs once and persists the repaired finding when the quality judge requests repair", async () => {
    const root = projectRoot!;

    const result = await generateCategory({
      projectRoot: root,
      categoryId,
      deps: baseDeps({ judgeDecision: "repair", repairedTitle: "Boundary JSON Validation" }),
    });

    expect(result).toEqual({ didRun: true, findingsCount: 1 });
    const rows = db!.prepare("SELECT payload_json FROM findings").all() as {
      payload_json: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.payload_json).problem.title).toBe("Boundary JSON Validation");
  });
});
