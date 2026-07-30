import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../core/app-error.js";
import { getRuntimeDb } from "../../core/db/runtime-db.js";
import { parseJsonFromDb, stringifyJsonForDb } from "../../core/db/sqlite-json.js";
import { ERR_DOCUMENTATION_REFRESH_STATE } from "../../core/error-codes.js";
import {
  DocumentationRefreshEvidenceSchema,
  DocumentationRefreshRelativePathSchema,
  DocumentationRefreshRunKindSchema,
  DocumentationRefreshRunSchema,
  DocumentationRefreshScopedContentHashSchema,
  DocumentationRefreshStatusSchema,
  type IDocumentationRefreshEvidence,
  type IDocumentationRefreshRun,
} from "./documentation-refresh.schemas.js";

const MAX_ATTEMPTS = 2;

const documentationRefreshRunRowSchema = z
  .object({
    id: z.string(),
    kind: DocumentationRefreshRunKindSchema,
    input_fingerprint: z.string(),
    head_sha: z.string().nullable(),
    scoped_content_hashes_json: z.string(),
    status: DocumentationRefreshStatusSchema,
    baseline_cursor: z.string().nullable(),
    attempt_count: z.number(),
    evidence_json: z.string().nullable(),
    finding_id: z.string().nullable(),
    lease_observed_at: z.number().nullable(),
    stop_reason: z.string().nullable(),
    blocker: z.string().nullable(),
    next_action: z.string().nullable(),
    started_at: z.number().nullable(),
    completed_at: z.number().nullable(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .strict();

const documentationRefreshRunRowsSchema = z.array(documentationRefreshRunRowSchema);

const createRunInputSchema = z
  .object({
    kind: DocumentationRefreshRunKindSchema,
    inputFingerprint: z.string().regex(/^[a-f0-9]{32,64}$/),
    headSha: z
      .string()
      .regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/)
      .nullable(),
    scopedContentHashes: z.array(DocumentationRefreshScopedContentHashSchema).max(500),
    baselineCursor: DocumentationRefreshRelativePathSchema.nullable(),
    now: z.number().int().nonnegative(),
  })
  .strict();

type ICreateDocumentationRefreshRunInput = z.infer<typeof createRunInputSchema>;

const runSelect = `SELECT
  id, kind, input_fingerprint, head_sha, scoped_content_hashes_json, status,
  baseline_cursor, attempt_count, evidence_json, finding_id, lease_observed_at,
  stop_reason, blocker, next_action, started_at, completed_at, created_at, updated_at
FROM documentation_refresh_runs`;

function parseRunRow(
  row: z.infer<typeof documentationRefreshRunRowSchema>
): IDocumentationRefreshRun {
  return DocumentationRefreshRunSchema.parse({
    id: row.id,
    kind: row.kind,
    inputFingerprint: row.input_fingerprint,
    headSha: row.head_sha,
    scopedContentHashes: parseJsonFromDb({
      raw: row.scoped_content_hashes_json,
      schema: z.array(DocumentationRefreshScopedContentHashSchema).max(500),
      context: { table: "documentation_refresh_runs", id: row.id },
    }),
    status: row.status,
    baselineCursor: row.baseline_cursor,
    attemptCount: row.attempt_count,
    evidence:
      row.evidence_json === null
        ? null
        : parseJsonFromDb({
            raw: row.evidence_json,
            schema: DocumentationRefreshEvidenceSchema,
            context: { table: "documentation_refresh_runs", id: row.id, column: "evidence_json" },
          }),
    findingId: row.finding_id,
    leaseObservedAt: row.lease_observed_at,
    stopReason: row.stop_reason,
    blocker: row.blocker,
    nextAction: row.next_action,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function readRuns(whereSql: string, params: unknown[]): IDocumentationRefreshRun[] {
  const rawRows: unknown = getRuntimeDb()
    .prepare(`${runSelect} ${whereSql}`)
    .all(...params);
  return documentationRefreshRunRowsSchema.parse(rawRows).map(parseRunRow);
}

export function findDocumentationRefreshRunById(id: string): IDocumentationRefreshRun | null {
  return readRuns("WHERE id = ?", [id])[0] ?? null;
}

export function findDocumentationRefreshRunByInput(args: {
  kind: IDocumentationRefreshRun["kind"];
  inputFingerprint: string;
}): IDocumentationRefreshRun | null {
  return (
    readRuns("WHERE kind = ? AND input_fingerprint = ?", [args.kind, args.inputFingerprint])[0] ??
    null
  );
}

export function getLatestDocumentationRefreshRun(): IDocumentationRefreshRun | null {
  return readRuns("ORDER BY created_at DESC, id DESC LIMIT 1", [])[0] ?? null;
}

export function getLatestCompletedDocumentationRefreshRun(): IDocumentationRefreshRun | null {
  return (
    readRuns(
      "WHERE completed_at IS NOT NULL ORDER BY completed_at DESC, updated_at DESC, id DESC LIMIT 1",
      []
    )[0] ?? null
  );
}

export function listDocumentationRefreshRuns(): IDocumentationRefreshRun[] {
  return readRuns("ORDER BY created_at ASC, id ASC", []);
}

function requireRun(id: string): IDocumentationRefreshRun {
  const run = findDocumentationRefreshRunById(id);
  if (run === null) {
    throw new AppError("Documentation refresh run was not found", ERR_DOCUMENTATION_REFRESH_STATE, {
      runId: id,
      reason: "not_found",
    });
  }
  return run;
}

function assertRunStatus(args: {
  run: Pick<IDocumentationRefreshRun, "id" | "status">;
  expected: readonly IDocumentationRefreshRun["status"][];
  target: IDocumentationRefreshRun["status"];
}): void {
  if (args.expected.includes(args.run.status)) return;
  throw new AppError(
    `Cannot transition documentation refresh run from ${args.run.status} to ${args.target}`,
    ERR_DOCUMENTATION_REFRESH_STATE,
    {
      runId: args.run.id,
      actualStatus: args.run.status,
      expectedStatuses: args.expected.join(","),
      targetStatus: args.target,
    }
  );
}

export function createDocumentationRefreshRun(
  input: ICreateDocumentationRefreshRunInput
): IDocumentationRefreshRun {
  const parsed = createRunInputSchema.parse(input);
  const id = randomUUID();
  getRuntimeDb()
    .prepare(
      `INSERT INTO documentation_refresh_runs (
        id, kind, input_fingerprint, head_sha, scoped_content_hashes_json, status,
        baseline_cursor, attempt_count, evidence_json, finding_id, lease_observed_at,
        stop_reason, blocker, next_action, started_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', ?, 0, NULL, NULL, NULL, NULL, NULL, 'claim', NULL, NULL, ?, ?)
      ON CONFLICT(kind, input_fingerprint) DO NOTHING`
    )
    .run(
      id,
      parsed.kind,
      parsed.inputFingerprint,
      parsed.headSha,
      stringifyJsonForDb(parsed.scopedContentHashes),
      parsed.baselineCursor,
      parsed.now,
      parsed.now
    );
  const run = findDocumentationRefreshRunByInput(parsed);
  if (run === null) {
    throw new AppError(
      "Documentation refresh run could not be created or loaded",
      ERR_DOCUMENTATION_REFRESH_STATE,
      { kind: parsed.kind, inputFingerprint: parsed.inputFingerprint }
    );
  }
  return run;
}

export function claimDocumentationRefreshRun(args: {
  id: string;
  now: number;
  leaseObservedAt: number;
}): IDocumentationRefreshRun {
  const run = requireRun(args.id);
  assertRunStatus({ run, expected: ["queued"], target: "running" });
  if (run.attemptCount >= MAX_ATTEMPTS) {
    throw new AppError(
      "Documentation refresh run exhausted its attempt budget",
      ERR_DOCUMENTATION_REFRESH_STATE,
      { runId: run.id, attemptCount: run.attemptCount, maxAttempts: MAX_ATTEMPTS }
    );
  }
  const update = getRuntimeDb()
    .prepare(
      `UPDATE documentation_refresh_runs
       SET status = 'running', attempt_count = attempt_count + 1,
           stop_reason = NULL, blocker = NULL, next_action = 'complete_bounded_review',
           lease_observed_at = ?, started_at = ?, completed_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'queued'`
    )
    .run(args.leaseObservedAt, args.now, args.now, args.id);
  if (update.changes !== 1) {
    throw new AppError(
      "Documentation refresh run was claimed concurrently",
      ERR_DOCUMENTATION_REFRESH_STATE,
      { runId: args.id, expectedStatus: "queued" }
    );
  }
  return requireRun(args.id);
}

export function requeueDocumentationRefreshRun(args: {
  id: string;
  stopReason: string;
  now: number;
}): IDocumentationRefreshRun {
  const run = requireRun(args.id);
  assertRunStatus({ run, expected: ["running"], target: "queued" });
  if (run.attemptCount >= MAX_ATTEMPTS) {
    throw new AppError(
      "Documentation refresh run cannot be requeued after exhausting attempts",
      ERR_DOCUMENTATION_REFRESH_STATE,
      { runId: run.id, attemptCount: run.attemptCount, maxAttempts: MAX_ATTEMPTS }
    );
  }
  getRuntimeDb()
    .prepare(
      `UPDATE documentation_refresh_runs
       SET status = 'queued', stop_reason = ?, next_action = 'claim',
           started_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(args.stopReason, args.now, args.id);
  return requireRun(args.id);
}

export function completeDocumentationRefreshRun(args: {
  id: string;
  status: "clean" | "needs-review";
  evidence: IDocumentationRefreshEvidence;
  findingId: string | null;
  baselineCursor: string | null;
  stopReason: string;
  nextAction: string;
  now: number;
}): IDocumentationRefreshRun {
  const run = requireRun(args.id);
  assertRunStatus({ run, expected: ["running"], target: args.status });
  const evidence = DocumentationRefreshEvidenceSchema.parse(args.evidence);
  if (args.status === "needs-review" && args.findingId === null) {
    throw new AppError(
      "A needs-review documentation run must link its current finding",
      ERR_DOCUMENTATION_REFRESH_STATE,
      { runId: run.id, targetStatus: args.status }
    );
  }
  getRuntimeDb()
    .prepare(
      `UPDATE documentation_refresh_runs
       SET status = ?, evidence_json = ?, finding_id = ?, baseline_cursor = ?,
           stop_reason = ?, blocker = NULL, next_action = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(
      args.status,
      stringifyJsonForDb(evidence),
      args.findingId,
      args.baselineCursor,
      args.stopReason,
      args.nextAction,
      args.now,
      args.now,
      args.id
    );
  return requireRun(args.id);
}

export function blockDocumentationRefreshRun(args: {
  id: string;
  evidence: IDocumentationRefreshEvidence;
  blocker: string;
  findingId: string | null;
  baselineCursor: string | null;
  stopReason: string;
  nextAction: string;
  now: number;
}): IDocumentationRefreshRun {
  const run = requireRun(args.id);
  assertRunStatus({ run, expected: ["running"], target: "blocked" });
  const evidence = DocumentationRefreshEvidenceSchema.parse(args.evidence);
  if (args.findingId === null) {
    throw new AppError(
      "A blocked documentation run must link its current finding",
      ERR_DOCUMENTATION_REFRESH_STATE,
      { runId: run.id, targetStatus: "blocked" }
    );
  }
  getRuntimeDb()
    .prepare(
      `UPDATE documentation_refresh_runs
       SET status = 'blocked', evidence_json = ?, finding_id = ?, baseline_cursor = ?,
           stop_reason = ?, blocker = ?, next_action = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(
      stringifyJsonForDb(evidence),
      args.findingId,
      args.baselineCursor,
      args.stopReason,
      args.blocker,
      args.nextAction,
      args.now,
      args.now,
      args.id
    );
  return requireRun(args.id);
}

export function failDocumentationRefreshRun(args: {
  id: string;
  stopReason: string;
  nextAction: string;
  now: number;
}): IDocumentationRefreshRun {
  const run = requireRun(args.id);
  assertRunStatus({ run, expected: ["running"], target: "failed" });
  getRuntimeDb()
    .prepare(
      `UPDATE documentation_refresh_runs
       SET status = 'failed', stop_reason = ?, next_action = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(args.stopReason, args.nextAction, args.now, args.now, args.id);
  return requireRun(args.id);
}

export function supersedeDocumentationRefreshRun(args: {
  id: string;
  stopReason: string;
  now: number;
}): IDocumentationRefreshRun {
  const run = requireRun(args.id);
  assertRunStatus({ run, expected: ["queued", "running"], target: "superseded" });
  getRuntimeDb()
    .prepare(
      `UPDATE documentation_refresh_runs
       SET status = 'superseded', stop_reason = ?, next_action = 'queue_latest_fingerprint',
           completed_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running')`
    )
    .run(args.stopReason, args.now, args.now, args.id);
  return requireRun(args.id);
}

export function recoverDocumentationRefreshRuns(args: { now: number; staleAfterMs: number }): {
  requeued: number;
  failed: number;
} {
  if (args.staleAfterMs <= 0) {
    throw new AppError(
      "Documentation refresh stale-run threshold must be positive",
      ERR_DOCUMENTATION_REFRESH_STATE,
      { staleAfterMs: args.staleAfterMs }
    );
  }
  const staleRuns = readRuns("WHERE status = 'running' AND updated_at <= ?", [
    args.now - args.staleAfterMs,
  ]);
  let requeued = 0;
  let failed = 0;
  getRuntimeDb().transaction((): void => {
    for (const run of staleRuns) {
      if (run.attemptCount < MAX_ATTEMPTS) {
        getRuntimeDb()
          .prepare(
            `UPDATE documentation_refresh_runs
             SET status = 'queued', stop_reason = 'stale_running_requeued',
                 next_action = 'claim', started_at = NULL, updated_at = ?
             WHERE id = ? AND status = 'running'`
          )
          .run(args.now, run.id);
        requeued += 1;
        continue;
      }
      getRuntimeDb()
        .prepare(
          `UPDATE documentation_refresh_runs
           SET status = 'failed', stop_reason = 'stale_running_retry_exhausted',
               next_action = 'inspect_runtime_and_retry_manually', completed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'running'`
        )
        .run(args.now, args.now, run.id);
      failed += 1;
    }
  })();
  return { requeued, failed };
}
