import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  createNextCommitmentEvidenceBroker,
  prepareNextCommitmentEvidenceBroker,
  readNextCommitmentEvidenceAudit,
} from "./next-commitment-evidence-broker.js";

const fixtureParent = join(
  process.cwd(),
  ".steward",
  "tmp",
  "runs",
  "next-commitment-evidence-broker-tests"
);

let workspacePath: string;
let evidenceDir: string;

function writeTaskManifest(taskCount = 1): void {
  const tasks = Array.from({ length: taskCount }, (_, index) => {
    const taskId = `task-${index + 1}`;
    const snapshotFile = `${taskId}.jsonl`;
    const content = `${JSON.stringify({
      type: "task_snapshot",
      taskId,
      title: `Task ${index + 1}`,
      updatedAt: 1_785_000_000_000 - index,
      scope: "user and assistant messages from exact-project turns only",
      sourceTruncated: false,
    })}\n${JSON.stringify({ type: "message", role: "user", phase: null, text: "Finish proof" })}\n`;
    writeFileSync(join(evidenceDir, snapshotFile), content, "utf8");
    return {
      id: taskId,
      title: `Task ${index + 1}`,
      updatedAt: 1_785_000_000_000 - index,
      transcriptBytes: content.length,
      snapshotFile,
      snapshotBytes: Buffer.byteLength(content),
      sourceTruncated: false,
    };
  });
  writeFileSync(
    join(evidenceDir, "recent-codex-tasks.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      projectRoot: "/projects/grocery",
      capturedAt: 1_785_000_000_000,
      selection: {
        lookbackDays: 30,
        maxTasks: 100,
        manifestTaskCount: tasks.length,
        eligibleTaskCount: tasks.length,
        truncated: false,
        scanTruncated: false,
      },
      tasks,
    })}\n`,
    "utf8"
  );
}

function prepare(paths: string[]): { configPath: string; auditPath: string } {
  writeFileSync(
    join(evidenceDir, "git-state.json"),
    `${JSON.stringify({ schemaVersion: 1, changedPaths: ["README.md"] })}\n`,
    "utf8"
  );
  return prepareNextCommitmentEvidenceBroker({
    workspacePath,
    evidenceDir,
    includedProjectPaths: paths,
  });
}

beforeEach(() => {
  mkdirSync(fixtureParent, { recursive: true });
  workspacePath = mkdtempSync(join(fixtureParent, "workspace-"));
  evidenceDir = join(workspacePath, ".steward-review-evidence");
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(join(workspacePath, "docs"));
  writeFileSync(join(workspacePath, "README.md"), "# Grocery\nCurrent goal\n", "utf8");
  writeFileSync(join(workspacePath, "docs", "goals.md"), "One unfinished proof remains.\n", "utf8");
  writeTaskManifest();
});

afterEach(() => {
  rmSync(workspacePath, { recursive: true, force: true });
  rmSync(fixtureParent, { recursive: true, force: true });
});

describe("next commitment evidence broker", () => {
  it("serves only logical bounded evidence and records exactly what it exposes", () => {
    const prepared = prepare(["README.md", "docs/goals.md"]);
    const broker = createNextCommitmentEvidenceBroker(prepared.configPath);
    try {
      expect(broker.callTool("list_project_files", { prefix: "docs" }).isError).toBe(false);
      writeFileSync(join(workspacePath, "README.md"), "tampered after broker startup\n", "utf8");
      const readResult = broker.callTool("read_project_file", { path: "README.md" });
      expect(readResult.isError).toBe(false);
      expect(readResult.content[0]?.text).toContain("Current goal");
      expect(readResult.content[0]?.text).not.toContain("tampered after broker startup");
      expect(broker.callTool("search_project_files", { query: "unfinished" }).isError).toBe(false);
      expect(broker.callTool("read_project_state", {}).isError).toBe(false);
      expect(broker.callTool("list_recent_tasks", {}).isError).toBe(false);
      expect(broker.callTool("read_recent_task", { taskId: "task-1" }).isError).toBe(false);
    } finally {
      broker.close();
    }

    expect(readNextCommitmentEvidenceAudit(prepared.auditPath)).toEqual({
      projectPaths: ["README.md", "docs/goals.md"],
      taskIds: ["task-1"],
      projectStateInspected: true,
      taskManifestInspected: true,
    });
  });

  it.each(["../outside.md", "/private/tmp/outside.md", "docs\\goals.md", ".", "missing.md"])(
    "rejects non-allowlisted or unsafe project path %s",
    (path) => {
      const prepared = prepare(["README.md", "docs/goals.md"]);
      const broker = createNextCommitmentEvidenceBroker(prepared.configPath);
      try {
        expect(broker.callTool("read_project_file", { path }).isError).toBe(true);
      } finally {
        broker.close();
      }
      expect(readNextCommitmentEvidenceAudit(prepared.auditPath).projectPaths).toEqual([]);
    }
  );

  it("rejects a symlink even when a corrupt host config tries to allowlist it", () => {
    const outsidePath = join(fixtureParent, "outside.md");
    writeFileSync(outsidePath, "secret\n", "utf8");
    symlinkSync(outsidePath, join(workspacePath, "escape.md"));
    const prepared = prepare(["escape.md"]);

    expect(() => createNextCommitmentEvidenceBroker(prepared.configPath)).toThrow();
  });

  it("enforces forty project locators including state and four task contents", () => {
    const projectPaths = Array.from({ length: 41 }, (_, index) => `file-${index + 1}.md`);
    for (const path of projectPaths) writeFileSync(join(workspacePath, path), `${path}\n`, "utf8");
    writeTaskManifest(5);
    const prepared = prepare(projectPaths);
    const broker = createNextCommitmentEvidenceBroker(prepared.configPath);
    try {
      expect(broker.callTool("read_project_state", {}).isError).toBe(false);
      for (const path of projectPaths.slice(0, 39)) {
        expect(broker.callTool("read_project_file", { path }).isError).toBe(false);
      }
      expect(broker.callTool("read_project_file", { path: projectPaths[39] }).isError).toBe(true);
      for (const taskId of ["task-1", "task-2", "task-3", "task-4"]) {
        expect(broker.callTool("read_recent_task", { taskId }).isError).toBe(false);
      }
      expect(broker.callTool("read_recent_task", { taskId: "task-5" }).isError).toBe(true);
    } finally {
      broker.close();
    }
    const audit = readNextCommitmentEvidenceAudit(prepared.auditPath);
    expect(audit.projectPaths).toHaveLength(39);
    expect(audit.projectStateInspected).toBe(true);
    expect(audit.taskIds).toHaveLength(4);
    expect(audit.projectPaths).not.toContain(basename(projectPaths[39] ?? ""));
    expect(audit.taskIds).not.toContain("task-5");
  });
});
