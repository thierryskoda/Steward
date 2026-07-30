import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverRecentProjectTasks } from "./recent-project-tasks.js";

const tempDirs: string[] = [];

function createCodexHome(): string {
  const codexHome = mkdtempSync(join(tmpdir(), "steward-codex-tasks-"));
  tempDirs.push(codexHome);
  mkdirSync(join(codexHome, "sessions", "2026", "07", "21"), { recursive: true });
  mkdirSync(join(codexHome, "archived_sessions"), { recursive: true });
  return codexHome;
}

function appendIndexEntry(args: {
  codexHome: string;
  id: string;
  title: string;
  updatedAt: string;
}): void {
  writeFileSync(
    join(args.codexHome, "session_index.jsonl"),
    `${JSON.stringify({
      id: args.id,
      thread_name: args.title,
      updated_at: args.updatedAt,
    })}\n`,
    { encoding: "utf8", flag: "a" }
  );
}

function writeSession(args: {
  codexHome: string;
  id: string;
  projectRoot: string;
  source?: "vscode" | "exec" | { subagent: { other: string } };
  sessionId?: string;
  omitSessionId?: boolean;
  parentThreadId?: string | null;
  threadSource?: unknown;
  archived?: boolean;
}): string {
  const dir = args.archived
    ? join(args.codexHome, "archived_sessions")
    : join(args.codexHome, "sessions", "2026", "07", "21");
  const path = join(dir, `rollout-2026-07-21T12-00-00-${args.id}.jsonl`);
  writeFileSync(
    path,
    `${JSON.stringify({
      timestamp: "2026-07-21T12:00:00.000Z",
      type: "session_meta",
      payload: {
        id: args.id,
        ...(args.omitSessionId ? {} : { session_id: args.sessionId ?? args.id }),
        cwd: args.projectRoot,
        source: args.source ?? "vscode",
        parent_thread_id: args.parentThreadId ?? null,
        ...(args.threadSource === undefined ? {} : { thread_source: args.threadSource }),
      },
    })}\n`,
    "utf8"
  );
  return path;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("discoverRecentProjectTasks", () => {
  it("returns only recent indexed root tasks for the exact selected project", () => {
    const codexHome = createCodexHome();
    const projectRoot = "/projects/grocery";
    const matchingPath = writeSession({
      codexHome,
      id: "task-grocery",
      projectRoot,
    });
    const currentFormatPath = writeSession({
      codexHome,
      id: "task-current-format",
      projectRoot,
      omitSessionId: true,
      threadSource: "user",
    });
    writeSession({
      codexHome,
      id: "task-other-project",
      projectRoot: "/projects/jobs",
    });
    writeSession({
      codexHome,
      id: "task-subagent",
      projectRoot,
      source: { subagent: { other: "guardian" } },
      sessionId: "task-grocery",
      parentThreadId: "task-grocery",
    });
    writeSession({
      codexHome,
      id: "task-current-subagent",
      projectRoot,
      omitSessionId: true,
      threadSource: { subagent: { thread_id: "task-grocery" } },
    });
    writeSession({
      codexHome,
      id: "task-automation",
      projectRoot,
      omitSessionId: true,
      threadSource: "automation",
    });
    writeSession({
      codexHome,
      id: "task-unindexed-probe",
      projectRoot,
      source: "exec",
    });

    appendIndexEntry({
      codexHome,
      id: "task-grocery",
      title: "Audit grocery codebase",
      updatedAt: "2026-07-21T15:00:00.000Z",
    });
    appendIndexEntry({
      codexHome,
      id: "task-current-format",
      title: "Newest grocery task",
      updatedAt: "2026-07-21T16:00:00.000Z",
    });
    appendIndexEntry({
      codexHome,
      id: "task-other-project",
      title: "Apply for jobs",
      updatedAt: "2026-07-21T14:00:00.000Z",
    });
    appendIndexEntry({
      codexHome,
      id: "task-subagent",
      title: "Internal review",
      updatedAt: "2026-07-21T13:00:00.000Z",
    });
    appendIndexEntry({
      codexHome,
      id: "task-current-subagent",
      title: "Internal current-format review",
      updatedAt: "2026-07-21T12:30:00.000Z",
    });
    appendIndexEntry({
      codexHome,
      id: "task-automation",
      title: "Automated maintenance",
      updatedAt: "2026-07-21T12:00:00.000Z",
    });
    appendIndexEntry({
      codexHome,
      id: "task-stale",
      title: "Old grocery work",
      updatedAt: "2026-05-01T13:00:00.000Z",
    });
    writeSession({
      codexHome,
      id: "task-stale",
      projectRoot,
      archived: true,
    });

    const result = discoverRecentProjectTasks({
      codexHome,
      projectRoot,
      capturedAt: Date.parse("2026-07-22T12:00:00.000Z"),
      lookbackDays: 30,
      maxTasks: 10,
    });

    expect(result.tasks).toEqual([
      {
        id: "task-current-format",
        title: "Newest grocery task",
        updatedAt: Date.parse("2026-07-21T16:00:00.000Z"),
        transcriptPath: currentFormatPath,
        transcriptBytes: expect.any(Number),
      },
      {
        id: "task-grocery",
        title: "Audit grocery codebase",
        updatedAt: Date.parse("2026-07-21T15:00:00.000Z"),
        transcriptPath: matchingPath,
        transcriptBytes: expect.any(Number),
      },
    ]);
    expect(result.eligibleTaskCount).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.scanTruncated).toBe(false);
  });

  it("prioritizes current sessions over a full archive scan budget and reports the skipped archive", () => {
    const codexHome = createCodexHome();
    const projectRoot = "/projects/grocery";
    const currentPath = writeSession({
      codexHome,
      id: "task-current",
      projectRoot,
    });
    appendIndexEntry({
      codexHome,
      id: "task-current",
      title: "Current grocery work",
      updatedAt: "2026-07-22T11:00:00.000Z",
    });

    for (let index = 0; index < 10_000; index += 1) {
      writeFileSync(
        join(
          codexHome,
          "archived_sessions",
          `rollout-2025-01-01T00-00-00-archive-${index.toString().padStart(5, "0")}.jsonl`
        ),
        "{}\n",
        "utf8"
      );
    }

    const result = discoverRecentProjectTasks({
      codexHome,
      projectRoot,
      capturedAt: Date.parse("2026-07-22T12:00:00.000Z"),
      lookbackDays: 30,
      maxTasks: 10,
    });

    expect(result.tasks).toEqual([
      {
        id: "task-current",
        title: "Current grocery work",
        updatedAt: Date.parse("2026-07-22T11:00:00.000Z"),
        transcriptPath: currentPath,
        transcriptBytes: expect.any(Number),
      },
    ]);
    expect(result.scanTruncated).toBe(true);
  });

  it("keeps the latest index title, orders newest first, and reports truncation", () => {
    const codexHome = createCodexHome();
    const projectRoot = "/projects/grocery";
    for (const [id, updatedAt] of [
      ["task-one", "2026-07-20T10:00:00.000Z"],
      ["task-two", "2026-07-21T10:00:00.000Z"],
      ["task-three", "2026-07-22T10:00:00.000Z"],
    ] as const) {
      writeSession({ codexHome, id, projectRoot });
      appendIndexEntry({ codexHome, id, title: `Initial ${id}`, updatedAt });
    }
    appendIndexEntry({
      codexHome,
      id: "task-three",
      title: "Latest title",
      updatedAt: "2026-07-22T11:00:00.000Z",
    });

    const result = discoverRecentProjectTasks({
      codexHome,
      projectRoot,
      capturedAt: Date.parse("2026-07-22T12:00:00.000Z"),
      lookbackDays: 30,
      maxTasks: 2,
    });

    expect(result.tasks.map((task) => [task.id, task.title])).toEqual([
      ["task-three", "Latest title"],
      ["task-two", "Initial task-two"],
    ]);
    expect(result.eligibleTaskCount).toBe(3);
    expect(result.truncated).toBe(true);
  });
});
