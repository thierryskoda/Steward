import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { stewardStateDbPath } from "../paths.js";
import { openRuntimeDb, closeRuntimeDb, type ISqliteConnection } from "./sqlite-connection.js";
import { runSqliteMigrations } from "./sqlite-migrations.js";

const roots: string[] = [];
const dbs: ISqliteConnection[] = [];

function createDb(): { projectRoot: string; db: ISqliteConnection } {
  const projectRoot = mkdtempSync(join(tmpdir(), "cto-runtime-db-"));
  roots.push(projectRoot);
  const db = openRuntimeDb(projectRoot);
  dbs.push(db);
  return { projectRoot, db };
}

afterEach(() => {
  while (dbs.length > 0) {
    const db = dbs.pop();
    if (db) closeRuntimeDb(db);
  }
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("sqlite migrations", () => {
  it("creates the runtime state database with expected tables and indexes", () => {
    const { projectRoot, db } = createDb();

    runSqliteMigrations(db);

    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[];
    const tableNames = tableRows.map((row) => row.name);
    expect(tableNames).toContain("project_config");
    expect(tableNames).toContain("findings");
    expect(tableNames).toContain("rules");
    expect(tableNames).toContain("generated_snapshots");
    expect(tableNames).toContain("source_checkpoints");
    expect(tableNames).toContain("option_hints");
    expect(tableNames).toContain("continual_learning_index");
    expect(tableNames).toContain("scanning_status");
    expect(tableNames).not.toContain("project_activity");

    const indexRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
      name: string;
    }[];
    const indexNames = indexRows.map((row) => row.name);
    expect(indexNames).toContain("findings_status_idx");
    expect(indexNames).toContain("findings_category_dedupe_key_idx");
    expect(indexNames).toContain("rules_status_idx");

    expect(stewardStateDbPath(projectRoot)).toMatch(/\.steward\/state\.db$/);
  });

  it("migrates old project activity state into scanning status and removes the old table", () => {
    const { db } = createDb();
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1), (2, 2), (3, 3);

      CREATE TABLE project_activity (
        id TEXT PRIMARY KEY CHECK (id = 'active'),
        status TEXT NOT NULL CHECK (status IN ('running', 'stopped')),
        updated_at INTEGER NOT NULL
      );
      INSERT INTO project_activity (id, status, updated_at)
      VALUES ('active', 'stopped', 123);
    `);

    runSqliteMigrations(db);

    const row = db
      .prepare("SELECT status, updated_at FROM scanning_status WHERE id = 'active'")
      .get() as { status: string; updated_at: number } | undefined;
    expect(row).toEqual({ status: "paused", updated_at: 123 });
    const projectActivityTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_activity'")
      .get();
    expect(projectActivityTable).toBeUndefined();
  });

  it("applies connection pragmas needed for local-first workflow state", () => {
    const { db } = createDb();

    const journalMode = db.pragma("journal_mode", { simple: true });
    const foreignKeys = db.pragma("foreign_keys", { simple: true });
    const busyTimeout = db.pragma("busy_timeout", { simple: true });

    expect(journalMode).toBe("wal");
    expect(foreignKeys).toBe(1);
    expect(busyTimeout).toBe(5000);
  });

  it("deletes legacy finding card payloads so stale humanized shapes are regenerated", () => {
    const { db } = createDb();
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1), (2, 2);

      CREATE TABLE findings (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        activities_json TEXT NOT NULL,
        lifecycle_json TEXT,
        workflow_chat_id TEXT NOT NULL,
        dedupe_key TEXT,
        context_fingerprint TEXT,
        selected_option_id TEXT,
        rejected_reason TEXT,
        failure_reason TEXT,
        claimed_at INTEGER,
        agent_started_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const insert = db.prepare(
      `INSERT INTO findings (
        id, category_id, status, payload_json, activities_json, workflow_chat_id, created_at, updated_at
      ) VALUES (?, 'category', 'needs-review', ?, '[]', 'chat', 1, 1)`
    );
    insert.run(
      "legacy",
      JSON.stringify({
        problem: {
          title: "Legacy human card",
          humanFinding: "Old summary.",
          humanWorkflowSteps: ["Old step"],
        },
        decision: { options: [{ id: "A", humanPlan: "Old plan" }] },
      })
    );
    insert.run(
      "current",
      JSON.stringify({
        problem: {
          title: "Current human card",
          humanSummary: "New summary.",
          humanCurrentBehavior: "Current behavior.",
          humanWhyItMatters: "Why.",
          humanEvidence: ["Evidence"],
          humanDecisionQuestion: "Question?",
        },
        decision: { options: [{ id: "A", humanSummary: "New option" }] },
      })
    );

    runSqliteMigrations(db);

    const rows = db.prepare("SELECT id FROM findings ORDER BY id").all() as { id: string }[];
    expect(rows).toEqual([{ id: "current" }]);
  });
});
