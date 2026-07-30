import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotRecentProjectTasks } from "./recent-project-task-snapshots.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "steward-task-snapshot-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function message(role: "user" | "assistant" | "developer", text: string): string {
  return JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
    },
  });
}

describe("snapshotRecentProjectTasks", () => {
  it("keeps only immutable user and assistant evidence from exact-project turns", async () => {
    const projectRoot = join(root, "project");
    const transcriptPath = join(root, "task.jsonl");
    const outputDir = join(root, "snapshots");
    const otherRoot = join(root, "other");
    mkdirSync(projectRoot);
    mkdirSync(outputDir);
    writeFileSync(
      transcriptPath,
      [
        message("developer", "AUTOMATIC_PROJECT_INSTRUCTIONS_MUST_NOT_SURVIVE"),
        message("user", "Initial project request"),
        JSON.stringify({ type: "turn_context", payload: { cwd: otherRoot, turn_id: "outside" } }),
        message("user", "OTHER_PROJECT_SECRET"),
        JSON.stringify({
          type: "response_item",
          payload: { type: "function_call_output", output: "TOOL_SECRET" },
        }),
        JSON.stringify({ type: "turn_context", payload: { cwd: projectRoot, turn_id: "inside" } }),
        message("user", "Finish the grocery acceptance test"),
        message("assistant", "The replay fixture is still missing"),
      ].join("\n") + "\n",
      "utf8"
    );

    const snapshots = await snapshotRecentProjectTasks({
      tasks: [
        {
          id: "task/grocery",
          title: "Grocery review",
          updatedAt: 1,
          transcriptPath,
          transcriptBytes: statSync(transcriptPath).size,
        },
      ],
      projectRoot,
      outputDir,
    });

    expect(snapshots).toHaveLength(1);
    const snapshot = readFileSync(snapshots[0]?.snapshotPath ?? "", "utf8");
    expect(snapshot).toContain("Initial project request");
    expect(snapshot).toContain("Finish the grocery acceptance test");
    expect(snapshot).toContain("The replay fixture is still missing");
    expect(snapshot).not.toContain("AUTOMATIC_PROJECT_INSTRUCTIONS_MUST_NOT_SURVIVE");
    expect(snapshot).not.toContain("OTHER_PROJECT_SECRET");
    expect(snapshot).not.toContain("TOOL_SECRET");
    expect(snapshots[0]?.snapshotPath).not.toContain("task/grocery");

    writeFileSync(transcriptPath, `${message("user", "APPENDED_AFTER_SNAPSHOT")}\n`, {
      flag: "a",
    });
    expect(readFileSync(snapshots[0]?.snapshotPath ?? "", "utf8")).not.toContain(
      "APPENDED_AFTER_SNAPSHOT"
    );
  });
});
