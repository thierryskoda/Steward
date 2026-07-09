import { getRuntimeDb } from "../db/runtime-db.js";
import type { CheckpointStore } from "./types.js";

export function createSqliteCheckpointStore(): CheckpointStore {
  return {
    get(key: string): string | null {
      const row = getRuntimeDb()
        .prepare("SELECT value FROM source_checkpoints WHERE key = ?")
        .get(key) as { value: string } | undefined;
      return row?.value ?? null;
    },
    set(key: string, value: string): void {
      getRuntimeDb()
        .prepare(
          `INSERT INTO source_checkpoints (key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = excluded.updated_at`
        )
        .run(key, value, Date.now());
    },
  };
}
