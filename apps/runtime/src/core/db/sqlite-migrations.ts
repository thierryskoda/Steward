import type { ISqliteConnection } from "./sqlite-connection.js";

type IMigration = {
  version: number;
  name: string;
  up: (db: ISqliteConnection) => void;
};

const migrations: IMigration[] = [
  {
    version: 1,
    name: "initial_state_db",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );

        CREATE TABLE project_config (
          id TEXT PRIMARY KEY CHECK (id = 'active'),
          schema_version INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

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

        CREATE TABLE rules (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          activities_json TEXT NOT NULL,
          lifecycle_json TEXT,
          source_message_id TEXT NOT NULL,
          source_chat_id TEXT,
          failure_reason TEXT,
          claimed_at INTEGER,
          agent_started_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE generated_snapshots (
          kind TEXT PRIMARY KEY,
          sources_hash TEXT NOT NULL,
          generator_version TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          generated_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE source_checkpoints (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE option_hints (
          id TEXT PRIMARY KEY,
          category_id TEXT NOT NULL,
          trigger TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE continual_learning_index (
          id TEXT PRIMARY KEY CHECK (id = 'active'),
          payload_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX findings_status_idx ON findings(status);
        CREATE INDEX findings_category_status_idx ON findings(category_id, status);
        CREATE UNIQUE INDEX findings_category_dedupe_key_idx
          ON findings(category_id, dedupe_key)
          WHERE dedupe_key IS NOT NULL;

        CREATE INDEX rules_status_idx ON rules(status);
        CREATE INDEX rules_source_message_idx ON rules(source_message_id);
        CREATE INDEX option_hints_category_idx ON option_hints(category_id);
      `);
    },
  },
  {
    version: 2,
    name: "scanning_status",
    up(db) {
      db.exec(`
        CREATE TABLE scanning_status (
          id TEXT PRIMARY KEY CHECK (id = 'active'),
          status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
          updated_at INTEGER NOT NULL
        );

        INSERT INTO scanning_status (id, status, updated_at)
        VALUES ('active', 'active', strftime('%s', 'now') * 1000);
      `);
    },
  },
  {
    version: 3,
    name: "delete_legacy_humanized_finding_cards",
    up(db) {
      db.exec(`
        DELETE FROM findings
        WHERE json_type(payload_json, '$.problem.humanFinding') IS NOT NULL
          OR json_type(payload_json, '$.problem.humanWorkflowSteps') IS NOT NULL
          OR EXISTS (
            SELECT 1
            FROM json_each(payload_json, '$.decision.options')
            WHERE json_type(json_each.value, '$.humanPlan') IS NOT NULL
              OR json_type(json_each.value, '$.humanWorkflowSteps') IS NOT NULL
          );
      `);
    },
  },
  {
    version: 4,
    name: "replace_project_activity_with_scanning_status",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scanning_status (
          id TEXT PRIMARY KEY CHECK (id = 'active'),
          status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_activity (
          id TEXT PRIMARY KEY CHECK (id = 'active'),
          status TEXT NOT NULL CHECK (status IN ('running', 'stopped')),
          updated_at INTEGER NOT NULL
        );

        INSERT INTO scanning_status (id, status, updated_at)
        SELECT
          'active',
          CASE status
            WHEN 'running' THEN 'active'
            WHEN 'stopped' THEN 'paused'
            ELSE 'active'
          END,
          updated_at
        FROM project_activity
        WHERE id = 'active'
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          updated_at = excluded.updated_at;

        INSERT OR IGNORE INTO scanning_status (id, status, updated_at)
        VALUES ('active', 'active', strftime('%s', 'now') * 1000);

        DROP TABLE IF EXISTS project_activity;
      `);
    },
  },
];

export function runSqliteMigrations(db: ISqliteConnection): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = db.prepare("SELECT version FROM schema_migrations").all() as {
    version: number;
  }[];
  const applied = new Set(appliedRows.map((row) => row.version));

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        Date.now()
      );
    })();
  }
}
