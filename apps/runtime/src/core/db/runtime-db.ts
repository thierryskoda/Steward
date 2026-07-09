import { AppError } from "../app-error.js";
import { ERR_DEPS_NOT_SET } from "../error-codes.js";
import type { ISqliteConnection } from "./sqlite-connection.js";

let runtimeDb: ISqliteConnection | null = null;

export function setRuntimeDb(db: ISqliteConnection): void {
  runtimeDb = db;
}

export function getRuntimeDb(): ISqliteConnection {
  if (runtimeDb === null) {
    throw new AppError("Runtime SQLite connection has not been initialized", ERR_DEPS_NOT_SET, {
      component: "runtime-db",
    });
  }
  return runtimeDb;
}

export function clearRuntimeDb(): void {
  runtimeDb = null;
}
