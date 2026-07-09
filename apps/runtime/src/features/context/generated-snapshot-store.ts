import type { z } from "zod";
import { getRuntimeDb } from "../../core/db/runtime-db.js";
import { parseJsonFromDb, stringifyJsonForDb } from "../../core/db/sqlite-json.js";

export type IGeneratedSnapshotKind = "exclude" | "rules" | "project-context";

type IGeneratedSnapshotRow = {
  kind: string;
  sources_hash: string;
  generator_version: string;
  payload_json: string;
  generated_at: number;
};

export type IGeneratedSnapshot<T> = {
  kind: IGeneratedSnapshotKind;
  sourcesHash: string;
  generatorVersion: string;
  generatedAt: number;
  payload: T;
};

export function readGeneratedSnapshot<T>(args: {
  kind: IGeneratedSnapshotKind;
  schema: z.ZodType<T>;
}): IGeneratedSnapshot<T> | null {
  const row = getRuntimeDb()
    .prepare(
      "SELECT kind, sources_hash, generator_version, payload_json, generated_at FROM generated_snapshots WHERE kind = ?"
    )
    .get(args.kind) as IGeneratedSnapshotRow | undefined;
  if (!row) return null;
  return {
    kind: args.kind,
    sourcesHash: row.sources_hash,
    generatorVersion: row.generator_version,
    generatedAt: row.generated_at,
    payload: parseJsonFromDb({
      raw: row.payload_json,
      schema: args.schema,
      context: { table: "generated_snapshots", kind: args.kind },
    }),
  };
}

export function writeGeneratedSnapshot<T>(args: {
  kind: IGeneratedSnapshotKind;
  sourcesHash: string;
  generatorVersion: string;
  payload: T;
}): void {
  const now = Date.now();
  getRuntimeDb()
    .prepare(
      `INSERT INTO generated_snapshots
        (kind, sources_hash, generator_version, payload_json, generated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind) DO UPDATE SET
         sources_hash = excluded.sources_hash,
         generator_version = excluded.generator_version,
         payload_json = excluded.payload_json,
         generated_at = excluded.generated_at,
         updated_at = excluded.updated_at`
    )
    .run(
      args.kind,
      args.sourcesHash,
      args.generatorVersion,
      stringifyJsonForDb(args.payload),
      now,
      now
    );
}
