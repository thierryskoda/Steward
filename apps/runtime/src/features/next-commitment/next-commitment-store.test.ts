import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeRuntimeDb,
  openRuntimeDb,
  type ISqliteConnection,
} from "../../core/db/sqlite-connection.js";
import { runSqliteMigrations } from "../../core/db/sqlite-migrations.js";
import { clearRuntimeDb, setRuntimeDb } from "../../core/db/runtime-db.js";
import {
  claimNextCommitmentRun,
  completeNextCommitmentRun,
  createOrGetActiveNextCommitmentRun,
  getLatestNextCommitmentRun,
  recoverInterruptedNextCommitmentRuns,
} from "./next-commitment-store.js";

let projectRoot: string;
let db: ISqliteConnection;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "steward-next-commitment-store-"));
  db = openRuntimeDb(projectRoot);
  setRuntimeDb(db);
  runSqliteMigrations(db);
});

afterEach(() => {
  clearRuntimeDb();
  closeRuntimeDb(db);
  rmSync(projectRoot, { recursive: true, force: true });
});

const recommendation = {
  status: "recommendation" as const,
  summary: "Finish the partially shipped retailer matching flow.",
  inspectedProjectPaths: ["README.md", "src/offers.ts"],
  inspectedTaskIds: ["task-grocery"],
  evidence: [
    {
      source: "project-file" as const,
      location: "README.md",
      finding: "The documented target requires all six retailers.",
    },
    {
      source: "codex-task" as const,
      location: "task-grocery",
      finding: "The latest task reports that streaming results remain incomplete.",
    },
  ],
  uncertainties: [],
  commitment: {
    title: "Stream retailer matches as each store completes",
    whyNow: "It is the remaining gap in the active end-to-end flow.",
    expectedOutcome: "Users see useful matches before the full batch finishes.",
    definitionOfDone: ["Each retailer result renders independently."],
    firstAction: "Trace the response boundary and write the failing UI test.",
  },
  whyThisWins: "It completes active work tied directly to the product goal.",
  strongestCounterargument: "The batch flow works and another gap may have more impact.",
  alternatives: [],
};

describe("next commitment store", () => {
  it("deduplicates repeated starts while one run is active and persists its result", () => {
    const first = createOrGetActiveNextCommitmentRun({
      headSha: "a".repeat(40),
      projectSnapshotHash: "snapshot-one",
      now: 1_000,
    });
    const duplicate = createOrGetActiveNextCommitmentRun({
      headSha: "b".repeat(40),
      projectSnapshotHash: "snapshot-two",
      now: 1_001,
    });

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.run.id).toBe(first.run.id);
    expect(claimNextCommitmentRun({ id: first.run.id, now: 1_100 }).status).toBe("running");

    const completed = completeNextCommitmentRun({
      id: first.run.id,
      result: recommendation,
      now: 1_200,
    });

    expect(completed.status).toBe("recommendation");
    expect(completed.result).toEqual(recommendation);
    expect(getLatestNextCommitmentRun()).toEqual(completed);
  });

  it("rejects an invalid transition instead of overwriting a terminal result", () => {
    const created = createOrGetActiveNextCommitmentRun({
      headSha: null,
      projectSnapshotHash: "snapshot",
      now: 2_000,
    }).run;
    claimNextCommitmentRun({ id: created.id, now: 2_100 });
    completeNextCommitmentRun({ id: created.id, result: recommendation, now: 2_200 });

    expect(() => claimNextCommitmentRun({ id: created.id, now: 2_300 })).toThrow(
      /Cannot transition next commitment run/
    );
  });

  it("marks queued and running work failed on restart so the user can retry explicitly", () => {
    const queued = createOrGetActiveNextCommitmentRun({
      headSha: null,
      projectSnapshotHash: "queued-snapshot",
      now: 3_000,
    }).run;
    claimNextCommitmentRun({ id: queued.id, now: 3_100 });

    const recovery = recoverInterruptedNextCommitmentRuns({ now: 3_200 });

    expect(recovery.recovered).toBe(1);
    expect(getLatestNextCommitmentRun()).toMatchObject({
      id: queued.id,
      status: "failed",
      stopReason: "runtime_restarted",
      completedAt: 3_200,
    });
  });
});
