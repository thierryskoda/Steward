import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRuntimeDb } from "../../core/db/runtime-db.js";
import {
  openRuntimeDb,
  closeRuntimeDb,
  type ISqliteConnection,
} from "../../core/db/sqlite-connection.js";
import { runSqliteMigrations } from "../../core/db/sqlite-migrations.js";
import { readScanningStatus, writeScanningStatus } from "./scanning-status-store.js";
import { AppError } from "../../core/app-error.js";

let projectRoot: string | null = null;
let db: ISqliteConnection | null = null;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "cto-scanning-status-store-"));
  db = openRuntimeDb(projectRoot);
  setRuntimeDb(db);
  runSqliteMigrations(db);
});

afterEach(() => {
  if (db) {
    closeRuntimeDb(db);
    db = null;
  }
  if (projectRoot) {
    rmSync(projectRoot, { recursive: true, force: true });
    projectRoot = null;
  }
});

describe("scanning-status-store", () => {
  it("reads the active status seeded by migration", () => {
    const status = readScanningStatus();
    expect(status).toBe("active");
  });

  it("persists and reads the status successfully", () => {
    writeScanningStatus("paused");
    expect(readScanningStatus()).toBe("paused");

    writeScanningStatus("active");
    expect(readScanningStatus()).toBe("active");
  });

  it("throws AppError when the required row is missing", () => {
    db?.prepare("DELETE FROM scanning_status WHERE id = 'active'").run();
    expect(() => readScanningStatus()).toThrow(AppError);
  });

  it("throws AppError on database read errors", () => {
    // Close the database to force a read error
    if (db) {
      closeRuntimeDb(db);
    }
    expect(() => readScanningStatus()).toThrow(AppError);
  });
});
