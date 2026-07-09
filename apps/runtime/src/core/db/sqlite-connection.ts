import { mkdirSync } from "fs";
import { dirname } from "path";
import Database from "better-sqlite3";
import { stewardStateDbPath } from "../paths.js";

export type ISqliteConnection = Database.Database;

export function openRuntimeDb(projectRoot: string): ISqliteConnection {
  const dbPath = stewardStateDbPath(projectRoot);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function closeRuntimeDb(db: ISqliteConnection): void {
  db.close();
}
