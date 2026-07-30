import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearRuntimeDb, setRuntimeDb } from "../../core/db/runtime-db.js";
import {
  closeRuntimeDb,
  openRuntimeDb,
  type ISqliteConnection,
} from "../../core/db/sqlite-connection.js";
import { runSqliteMigrations } from "../../core/db/sqlite-migrations.js";
import { AppError } from "../../core/app-error.js";
import { ERR_DOCUMENTATION_REFRESH_STATE } from "../../core/error-codes.js";
import {
  blockDocumentationRefreshRun,
  claimDocumentationRefreshRun,
  completeDocumentationRefreshRun,
  createDocumentationRefreshRun,
  findDocumentationRefreshRunById,
  recoverDocumentationRefreshRuns,
} from "./documentation-refresh-store.js";

const FINGERPRINT = "a".repeat(64);
const HEAD_SHA = "b".repeat(40);

describe("documentation refresh run store", () => {
  let projectRoot: string;
  let db: ISqliteConnection;

  beforeEach((): void => {
    projectRoot = mkdtempSync(join(tmpdir(), "steward-documentation-refresh-store-"));
    db = openRuntimeDb(projectRoot);
    runSqliteMigrations(db);
    setRuntimeDb(db);
  });

  afterEach((): void => {
    clearRuntimeDb();
    closeRuntimeDb(db);
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("deduplicates the same immutable input and completes a claimed baseline batch", () => {
    const input = {
      kind: "baseline" as const,
      inputFingerprint: FINGERPRINT,
      headSha: HEAD_SHA,
      scopedContentHashes: [{ path: "README.md", hash: "c".repeat(64) }],
      baselineCursor: null,
      now: 100,
    };
    const created = createDocumentationRefreshRun(input);
    const duplicate = createDocumentationRefreshRun({ ...input, now: 200 });
    expect(duplicate.id).toBe(created.id);
    expect(duplicate.createdAt).toBe(100);

    const running = claimDocumentationRefreshRun({
      id: created.id,
      now: 300,
      leaseObservedAt: 300,
    });
    expect(running.status).toBe("running");
    expect(running.attemptCount).toBe(1);

    const completed = completeDocumentationRefreshRun({
      id: created.id,
      status: "clean",
      evidence: {
        checkedPaths: ["README.md"],
        summary: "The checked documentation reflects the pinned code state.",
        verificationCommands: ["git diff -- README.md"],
        uncertainties: [],
      },
      findingId: null,
      baselineCursor: "README.md",
      stopReason: "baseline_batch_clean",
      nextAction: "queue_next_baseline_batch",
      now: 400,
    });
    expect(completed.status).toBe("clean");
    expect(completed.baselineCursor).toBe("README.md");
    expect(completed.evidence?.checkedPaths).toEqual(["README.md"]);

    let transitionError: unknown;
    try {
      blockDocumentationRefreshRun({
        id: created.id,
        evidence: completed.evidence ?? {
          checkedPaths: [],
          summary: "Missing evidence.",
          verificationCommands: [],
          uncertainties: [],
        },
        blocker: "Cannot block an already completed run.",
        findingId: null,
        baselineCursor: completed.baselineCursor,
        stopReason: "invalid_transition",
        nextAction: "none",
        now: 500,
      });
    } catch (error) {
      transitionError = error;
    }
    expect(transitionError).toBeInstanceOf(AppError);
    if (transitionError instanceof AppError) {
      expect(transitionError.code).toBe(ERR_DOCUMENTATION_REFRESH_STATE);
    }
  });

  it("requeues one stale running attempt, then fails after the retry budget is exhausted", () => {
    const created = createDocumentationRefreshRun({
      kind: "incremental",
      inputFingerprint: "d".repeat(64),
      headSha: HEAD_SHA,
      scopedContentHashes: [{ path: "src/app.ts", hash: "e".repeat(64) }],
      baselineCursor: "README.md",
      now: 100,
    });
    claimDocumentationRefreshRun({ id: created.id, now: 200, leaseObservedAt: 200 });

    const firstRecovery = recoverDocumentationRefreshRuns({ now: 2_000, staleAfterMs: 1_000 });
    expect(firstRecovery).toEqual({ requeued: 1, failed: 0 });
    const requeued = findDocumentationRefreshRunById(created.id);
    expect(requeued?.status).toBe("queued");
    expect(requeued?.attemptCount).toBe(1);
    expect(requeued?.stopReason).toBe("stale_running_requeued");

    claimDocumentationRefreshRun({ id: created.id, now: 2_100, leaseObservedAt: 2_100 });
    const exhausted = recoverDocumentationRefreshRuns({ now: 4_000, staleAfterMs: 1_000 });
    expect(exhausted).toEqual({ requeued: 0, failed: 1 });
    const failed = findDocumentationRefreshRunById(created.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.attemptCount).toBe(2);
    expect(failed?.stopReason).toBe("stale_running_retry_exhausted");
    expect(failed?.nextAction).toBe("inspect_runtime_and_retry_manually");
  });
});
