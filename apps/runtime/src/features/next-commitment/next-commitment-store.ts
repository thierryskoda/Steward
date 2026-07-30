import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  NextCommitmentResultSchema,
  NextCommitmentRunStatusSchema,
  type INextCommitmentResult,
} from "@steward/contracts/schemas";
import { AppError } from "../../core/app-error.js";
import { getRuntimeDb } from "../../core/db/runtime-db.js";
import { parseJsonFromDb, stringifyJsonForDb } from "../../core/db/sqlite-json.js";
import { ERR_NEXT_COMMITMENT_STATE } from "../../core/error-codes.js";
import { NextCommitmentRunSchema, type INextCommitmentRun } from "./next-commitment.schemas.js";

const nextCommitmentRunRowSchema = z
  .object({
    id: z.string(),
    project_snapshot_hash: z.string(),
    head_sha: z.string().nullable(),
    status: NextCommitmentRunStatusSchema,
    result_json: z.string().nullable(),
    stop_reason: z.string().nullable(),
    started_at: z.number().nullable(),
    completed_at: z.number().nullable(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .strict();

const nextCommitmentRunRowsSchema = z.array(nextCommitmentRunRowSchema);

const createRunInputSchema = z
  .object({
    projectSnapshotHash: z.string().min(1).max(128),
    headSha: z
      .string()
      .regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/)
      .nullable(),
    now: z.number().int().nonnegative(),
  })
  .strict();

const runSelect = `SELECT
  id, project_snapshot_hash, head_sha, status, result_json, stop_reason,
  started_at, completed_at, created_at, updated_at
FROM next_commitment_runs`;

function parseRunRow(row: z.infer<typeof nextCommitmentRunRowSchema>): INextCommitmentRun {
  return NextCommitmentRunSchema.parse({
    id: row.id,
    projectSnapshotHash: row.project_snapshot_hash,
    headSha: row.head_sha,
    status: row.status,
    result:
      row.result_json === null
        ? null
        : parseJsonFromDb({
            raw: row.result_json,
            schema: NextCommitmentResultSchema,
            context: { table: "next_commitment_runs", id: row.id, column: "result_json" },
          }),
    stopReason: row.stop_reason,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function readRuns(whereSql: string, params: unknown[]): INextCommitmentRun[] {
  const rows: unknown = getRuntimeDb()
    .prepare(`${runSelect} ${whereSql}`)
    .all(...params);
  return nextCommitmentRunRowsSchema.parse(rows).map(parseRunRow);
}

function requireRun(id: string): INextCommitmentRun {
  const run = readRuns("WHERE id = ?", [id])[0];
  if (run !== undefined) return run;
  throw new AppError("Next commitment run was not found", ERR_NEXT_COMMITMENT_STATE, {
    runId: id,
    reason: "not_found",
  });
}

export function findNextCommitmentRunById(id: string): INextCommitmentRun | null {
  return readRuns("WHERE id = ?", [id])[0] ?? null;
}

function assertRunStatus(args: {
  run: Pick<INextCommitmentRun, "id" | "status">;
  expected: readonly INextCommitmentRun["status"][];
  target: INextCommitmentRun["status"];
}): void {
  if (args.expected.includes(args.run.status)) return;
  throw new AppError(
    `Cannot transition next commitment run from ${args.run.status} to ${args.target}`,
    ERR_NEXT_COMMITMENT_STATE,
    {
      runId: args.run.id,
      actualStatus: args.run.status,
      expectedStatuses: args.expected.join(","),
      targetStatus: args.target,
    }
  );
}

export function getLatestNextCommitmentRun(): INextCommitmentRun | null {
  return readRuns("ORDER BY created_at DESC, id DESC LIMIT 1", [])[0] ?? null;
}

export function createOrGetActiveNextCommitmentRun(input: z.input<typeof createRunInputSchema>): {
  run: INextCommitmentRun;
  created: boolean;
} {
  const parsed = createRunInputSchema.parse(input);
  const active = readRuns(
    "WHERE status IN ('queued', 'running') ORDER BY created_at DESC, id DESC LIMIT 1",
    []
  )[0];
  if (active !== undefined) return { run: active, created: false };

  const id = randomUUID();
  const insert = getRuntimeDb()
    .prepare(
      `INSERT INTO next_commitment_runs (
        id, project_snapshot_hash, head_sha, status, result_json, stop_reason,
        started_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'queued', NULL, NULL, NULL, NULL, ?, ?)
      ON CONFLICT DO NOTHING`
    )
    .run(id, parsed.projectSnapshotHash, parsed.headSha, parsed.now, parsed.now);
  if (insert.changes === 1) return { run: requireRun(id), created: true };

  const concurrentlyCreated = readRuns(
    "WHERE status IN ('queued', 'running') ORDER BY created_at DESC, id DESC LIMIT 1",
    []
  )[0];
  if (concurrentlyCreated !== undefined) return { run: concurrentlyCreated, created: false };
  throw new AppError("Next commitment run could not be created", ERR_NEXT_COMMITMENT_STATE, {
    projectSnapshotHash: parsed.projectSnapshotHash,
  });
}

export function claimNextCommitmentRun(args: { id: string; now: number }): INextCommitmentRun {
  const run = requireRun(args.id);
  assertRunStatus({ run, expected: ["queued"], target: "running" });
  const update = getRuntimeDb()
    .prepare(
      `UPDATE next_commitment_runs
       SET status = 'running', stop_reason = NULL, started_at = ?, completed_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'queued'`
    )
    .run(args.now, args.now, args.id);
  if (update.changes !== 1) {
    throw new AppError("Next commitment run was claimed concurrently", ERR_NEXT_COMMITMENT_STATE, {
      runId: args.id,
      expectedStatus: "queued",
    });
  }
  return requireRun(args.id);
}

export function completeNextCommitmentRun(args: {
  id: string;
  result: INextCommitmentResult;
  now: number;
}): INextCommitmentRun {
  const run = requireRun(args.id);
  const result = NextCommitmentResultSchema.parse(args.result);
  assertRunStatus({ run, expected: ["running"], target: result.status });
  getRuntimeDb()
    .prepare(
      `UPDATE next_commitment_runs
       SET status = ?, result_json = ?, stop_reason = NULL, completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(result.status, stringifyJsonForDb(result), args.now, args.now, args.id);
  return requireRun(args.id);
}

export function failNextCommitmentRun(args: {
  id: string;
  stopReason: string;
  now: number;
}): INextCommitmentRun {
  const run = requireRun(args.id);
  assertRunStatus({ run, expected: ["running"], target: "failed" });
  getRuntimeDb()
    .prepare(
      `UPDATE next_commitment_runs
       SET status = 'failed', result_json = NULL, stop_reason = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(args.stopReason, args.now, args.now, args.id);
  return requireRun(args.id);
}

export function supersedeNextCommitmentRun(args: {
  id: string;
  stopReason: string;
  now: number;
}): INextCommitmentRun {
  const run = requireRun(args.id);
  assertRunStatus({ run, expected: ["running"], target: "superseded" });
  getRuntimeDb()
    .prepare(
      `UPDATE next_commitment_runs
       SET status = 'superseded', result_json = NULL, stop_reason = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(args.stopReason, args.now, args.now, args.id);
  return requireRun(args.id);
}

export function supersedeNextCommitmentRecommendation(args: {
  id: string;
  stopReason: string;
  now: number;
}): INextCommitmentRun {
  const run = requireRun(args.id);
  assertRunStatus({ run, expected: ["recommendation"], target: "superseded" });
  getRuntimeDb()
    .prepare(
      `UPDATE next_commitment_runs
       SET status = 'superseded', result_json = NULL, stop_reason = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'recommendation'`
    )
    .run(args.stopReason, args.now, args.now, args.id);
  return requireRun(args.id);
}

export function recoverInterruptedNextCommitmentRuns(args: { now: number }): {
  recovered: number;
} {
  const update = getRuntimeDb()
    .prepare(
      `UPDATE next_commitment_runs
       SET status = 'failed', result_json = NULL, stop_reason = 'runtime_restarted',
           completed_at = ?, updated_at = ?
       WHERE status IN ('queued', 'running')`
    )
    .run(args.now, args.now);
  return { recovered: update.changes };
}
