import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { INextCommitmentResult } from "@steward/contracts/schemas";
import {
  closeRuntimeDb,
  openRuntimeDb,
  type ISqliteConnection,
} from "../../core/db/sqlite-connection.js";
import { runSqliteMigrations } from "../../core/db/sqlite-migrations.js";
import { clearRuntimeDb, setRuntimeDb } from "../../core/db/runtime-db.js";
import type {
  ILLMMutationRunArgs,
  ILLMProvider,
  ILLMRunResult,
  ILLMStructuredRunArgs,
} from "../../core/llm/llm-provider.types.js";
import { createIsolatedCodexHome, createNextCommitmentRunner } from "./next-commitment-runner.js";
import { createNextCommitmentEvidenceBroker } from "./next-commitment-evidence-broker.js";

let projectRoot: string;
let codexHome: string;
let db: ISqliteConnection;
let transcriptPath: string;
const fixtureRoot = join(process.cwd(), ".steward", "tmp", "runs", "next-commitment-runner-tests");

const recommendation = {
  status: "recommendation" as const,
  summary: "Finish the partially shipped retailer matching flow.",
  inspectedProjectPaths: ["README.md", "src/offers.ts"],
  inspectedTaskIds: ["task-grocery"],
  evidence: [
    {
      source: "project-file" as const,
      location: "README.md",
      finding: "The documented target requires all six retailers.",
    },
    {
      source: "codex-task" as const,
      location: "task-grocery",
      finding: "The latest task reports that streaming results remain incomplete.",
    },
  ],
  uncertainties: [],
  commitment: {
    title: "Stream retailer matches as each store completes",
    whyNow: "It is the remaining gap in the active end-to-end flow.",
    expectedOutcome: "Users see useful matches before the full batch finishes.",
    definitionOfDone: ["Each retailer result renders independently."],
    firstAction: "Trace the response boundary and write the failing UI test.",
  },
  whyThisWins: "It completes active work tied directly to the product goal.",
  strongestCounterargument: "The batch flow works and another gap may have more impact.",
  alternatives: [],
};

const noCommitment = {
  status: "none" as const,
  summary: "Current evidence does not support one sufficiently valuable next commitment.",
  inspectedProjectPaths: ["README.md"],
  inspectedTaskIds: [],
  evidence: [
    {
      source: "project-file" as const,
      location: "README.md",
      finding: "The current project goal is complete and no active constraint is documented.",
    },
  ],
  uncertainties: [],
  reason: "Recommending work now would manufacture activity without a demonstrated project need.",
  reconsiderWhen: "A new goal, blocker, or partially completed workflow appears.",
};

function seedCodexTask(): void {
  const taskDir = join(codexHome, "sessions", "2026", "07", "21");
  mkdirSync(taskDir, { recursive: true });
  mkdirSync(join(codexHome, "archived_sessions"), { recursive: true });
  writeFileSync(join(codexHome, "auth.json"), "{}\n", "utf8");
  writeFileSync(
    join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({
      id: "task-grocery",
      thread_name: "Audit grocery codebase",
      updated_at: "2026-07-21T15:00:00.000Z",
    })}\n`,
    "utf8"
  );
  transcriptPath = join(taskDir, "rollout-2026-07-21T12-00-00-task-grocery.jsonl");
  writeFileSync(
    transcriptPath,
    [
      JSON.stringify({
        timestamp: "2026-07-21T12:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "task-grocery",
          session_id: "task-grocery",
          cwd: projectRoot,
          source: "vscode",
          parent_thread_id: null,
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "TRANSCRIPT_BODY_MUST_NOT_BE_IN_PROMPT" }],
        },
      }),
    ].join("\n") + "\n",
    "utf8"
  );
}

function createProvider(args: {
  onRun: (run: ILLMStructuredRunArgs) => void;
  output?: INextCommitmentResult;
}): ILLMProvider {
  return {
    async runStructured(run): Promise<ILLMRunResult> {
      args.onRun(run);
      const output = args.output ?? recommendation;
      const configPath = run.readOnlyMcpServer?.args[1];
      if (configPath === undefined) throw new Error("Expected the read-only evidence broker");
      const broker = createNextCommitmentEvidenceBroker(configPath);
      try {
        for (const path of output.inspectedProjectPaths) {
          broker.callTool(
            path === "." ? "read_project_state" : "read_project_file",
            path === "." ? {} : { path }
          );
        }
        for (const taskId of output.inspectedTaskIds) {
          broker.callTool("read_recent_task", { taskId });
        }
        if (output.evidence.some((entry) => entry.source === "task-manifest")) {
          broker.callTool("list_recent_tasks", {});
        }
      } finally {
        broker.close();
      }
      return {
        outputText: JSON.stringify(output),
        diagnosticText: "",
        reason: "exit",
        success: true,
      };
    },
    async runMutation(_run: ILLMMutationRunArgs): Promise<ILLMRunResult> {
      throw new Error("Mutation execution must not be used");
    },
    createConversationId(): Promise<string | null> {
      return Promise.resolve(null);
    },
  };
}

beforeEach(() => {
  mkdirSync(fixtureRoot, { recursive: true });
  projectRoot = mkdtempSync(join(fixtureRoot, "steward-next-commitment-project-"));
  codexHome = mkdtempSync(join(fixtureRoot, "steward-next-commitment-codex-"));
  writeFileSync(join(projectRoot, "README.md"), "# Grocery\n", "utf8");
  mkdirSync(join(projectRoot, "src"));
  writeFileSync(join(projectRoot, "src", "offers.ts"), "export const offers = [];\n", "utf8");
  execFileSync("git", ["init", "--quiet"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.email", "steward@example.test"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.name", "Steward Test"], { cwd: projectRoot });
  execFileSync("git", ["add", "README.md", "src/offers.ts"], { cwd: projectRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: projectRoot });
  seedCodexTask();
  db = openRuntimeDb(projectRoot);
  setRuntimeDb(db);
  runSqliteMigrations(db);
});

afterEach(() => {
  clearRuntimeDb();
  closeRuntimeDb(db);
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(codexHome, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("next commitment runner", () => {
  it("rejects a canonical Codex credential file stored under an operating-system temp root", () => {
    const unsafeCodexHome = mkdtempSync(join(tmpdir(), "steward-unsafe-codex-home-"));
    writeFileSync(join(unsafeCodexHome, "auth.json"), "{}\n", "utf8");
    try {
      expect(() =>
        createIsolatedCodexHome({
          sourceCodexHome: unsafeCodexHome,
          runRoot: join(projectRoot, ".steward", "tmp", "runs", "unsafe-auth"),
        })
      ).toThrowError(expect.objectContaining({ code: "ERR_AGENT_CLI_CONTRACT" }));
    } finally {
      rmSync(unsafeCodexHome, { recursive: true, force: true });
    }
  });

  it("runs from locator metadata, persists the result, and removes its temporary manifest", async () => {
    let manifestPath = "";
    let manifestDuringRun: unknown;
    let snapshotDuringRun = "";
    const provider = createProvider({
      onRun(run) {
        expect(run.workspace).not.toBe(projectRoot);
        expect(run.isolatedCodexHome).toContain("/codex-home");
        const isolatedAuthPath = join(run.isolatedCodexHome ?? "", "auth.json");
        const sourceAuthPath = join(codexHome, "auth.json");
        expect(lstatSync(isolatedAuthPath).isSymbolicLink()).toBe(true);
        expect(readFileSync(isolatedAuthPath)).toEqual(readFileSync(sourceAuthPath));
        expect(realpathSync(isolatedAuthPath)).toBe(realpathSync(sourceAuthPath));
        expect(existsSync(join(run.workspace, ".git"))).toBe(true);
        expect(run.prompt).not.toContain("TRANSCRIPT_BODY_MUST_NOT_BE_IN_PROMPT");
        const match = run.prompt.match(/"manifestPath": "([^"]+)"/);
        manifestPath = match?.[1] ?? "";
        const manifestText = readFileSync(manifestPath, "utf8");
        expect(manifestText).not.toContain(transcriptPath);
        manifestDuringRun = JSON.parse(manifestText);
        const parsedManifest = z
          .object({ tasks: z.array(z.object({ snapshotFile: z.string() }).passthrough()) })
          .passthrough()
          .parse(manifestDuringRun);
        const snapshotPath = join(
          run.workspace,
          ".steward-review-evidence",
          parsedManifest.tasks[0]?.snapshotFile ?? ""
        );
        snapshotDuringRun = readFileSync(snapshotPath, "utf8");
        writeFileSync(transcriptPath, "APPENDED_AFTER_CAPTURE\n", { flag: "a" });
        expect(readFileSync(snapshotPath, "utf8")).toBe(snapshotDuringRun);
      },
    });
    const runner = createNextCommitmentRunner({
      projectRoot,
      codexHome,
      llmProvider: provider,
      getConfiguredContextPatterns: () => ["README.md"],
      shouldContinue: () => true,
      now: () => Date.parse("2026-07-22T12:00:00.000Z"),
    });
    const queued = runner.queue();

    const completed = await runner.process(queued.run.id);

    expect(queued.created).toBe(true);
    expect(completed.status, JSON.stringify(completed)).toBe("recommendation");
    expect(completed.result).toEqual(recommendation);
    expect(manifestDuringRun).toMatchObject({
      projectRoot,
      selection: { eligibleTaskCount: 1, manifestTaskCount: 1 },
      tasks: [{ id: "task-grocery", title: "Audit grocery codebase" }],
    });
    expect(snapshotDuringRun).toContain("TRANSCRIPT_BODY_MUST_NOT_BE_IN_PROMPT");
    expect(existsSync(manifestPath)).toBe(false);
  });

  it("supersedes an answer when project evidence changes during the review", async () => {
    const provider = createProvider({
      onRun() {
        writeFileSync(join(projectRoot, "README.md"), "# Grocery\nChanged\n", "utf8");
      },
    });
    const runner = createNextCommitmentRunner({
      projectRoot,
      codexHome,
      llmProvider: provider,
      getConfiguredContextPatterns: () => ["README.md"],
      shouldContinue: () => true,
      now: () => Date.parse("2026-07-22T12:00:00.000Z"),
    });
    const queued = runner.queue();

    const completed = await runner.process(queued.run.id);

    expect(completed).toMatchObject({
      status: "superseded",
      result: null,
      stopReason: "project_changed_during_review",
    });
  });

  it("supersedes a persisted recommendation when project evidence changes before handoff", async () => {
    const runner = createNextCommitmentRunner({
      projectRoot,
      codexHome,
      llmProvider: createProvider({ onRun() {} }),
      getConfiguredContextPatterns: () => ["README.md"],
      shouldContinue: () => true,
      now: () => Date.parse("2026-07-22T12:00:00.000Z"),
    });
    const queued = runner.queue();
    const completed = await runner.process(queued.run.id);
    expect(completed.status).toBe("recommendation");

    writeFileSync(join(projectRoot, "README.md"), "# Grocery\nChanged after review\n", "utf8");

    expect(runner.getLatestCurrent()).toMatchObject({
      id: queued.run.id,
      status: "superseded",
      result: null,
      stopReason: "project_changed_before_codex_handoff",
    });
  });

  it("persists an explicit no-recommendation result as a successful review", async () => {
    const runner = createNextCommitmentRunner({
      projectRoot,
      codexHome,
      llmProvider: createProvider({ onRun() {}, output: noCommitment }),
      getConfiguredContextPatterns: () => ["README.md"],
      shouldContinue: () => true,
      now: () => Date.parse("2026-07-22T12:00:00.000Z"),
    });
    const queued = runner.queue();

    const completed = await runner.process(queued.run.id);

    expect(completed).toMatchObject({ status: "none", result: noCommitment, stopReason: null });
  });

  it("fails the run instead of persisting provenance outside the captured manifest", async () => {
    const runner = createNextCommitmentRunner({
      projectRoot,
      codexHome,
      llmProvider: createProvider({
        onRun() {},
        output: {
          ...recommendation,
          inspectedTaskIds: ["fabricated-task"],
        },
      }),
      getConfiguredContextPatterns: () => ["README.md"],
      shouldContinue: () => true,
      now: () => Date.parse("2026-07-22T12:00:00.000Z"),
    });
    const queued = runner.queue();

    const completed = await runner.process(queued.run.id);

    expect(completed).toMatchObject({
      status: "failed",
      result: null,
      stopReason: "ERR_NEXT_COMMITMENT_EVIDENCE",
    });
  });

  it("transitions to failed when run-scoped temporary setup cannot be created", async () => {
    writeFileSync(join(projectRoot, ".steward", "tmp"), "not a directory\n", "utf8");
    const runner = createNextCommitmentRunner({
      projectRoot,
      codexHome,
      llmProvider: createProvider({ onRun() {} }),
      getConfiguredContextPatterns: () => ["README.md"],
      shouldContinue: () => true,
      now: () => Date.parse("2026-07-22T12:00:00.000Z"),
    });
    const queued = runner.queue();

    const completed = await runner.process(queued.run.id);

    expect(completed).toMatchObject({ status: "failed", result: null });
  });
});
