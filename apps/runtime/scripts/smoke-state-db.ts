import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { openRuntimeDb, closeRuntimeDb } from "../src/core/db/sqlite-connection.js";
import { runSqliteMigrations } from "../src/core/db/sqlite-migrations.js";
import { stewardStateDbPath } from "../src/core/paths.js";

const projectRoot = mkdtempSync(join(tmpdir(), "cto-state-db-smoke-"));

try {
  const db = openRuntimeDb(projectRoot);
  try {
    runSqliteMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = new Set(tables.map((table) => table.name));
    for (const required of ["project_config", "findings", "rules", "generated_snapshots"]) {
      if (!names.has(required)) {
        throw new Error(`Missing state table: ${required}`);
      }
    }
    if (!stewardStateDbPath(projectRoot).endsWith(".steward/state.db")) {
      throw new Error("State database path is not under .steward/state.db");
    }
  } finally {
    closeRuntimeDb(db);
  }
} finally {
  rmSync(projectRoot, { recursive: true, force: true });
}
