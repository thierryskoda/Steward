import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STATUS } from "@steward/contracts/schemas";
import { clearRuntimeDb, setRuntimeDb } from "../../core/db/runtime-db.js";
import {
  closeRuntimeDb,
  openRuntimeDb,
  type ISqliteConnection,
} from "../../core/db/sqlite-connection.js";
import { runSqliteMigrations } from "../../core/db/sqlite-migrations.js";
import {
  createFinding,
  getFindingById,
  listAllFindings,
  listFindingsByStatuses,
  saveFinding,
} from "./categories-store.js";

describe("category finding store direct queries", () => {
  let projectRoot: string;
  let db: ISqliteConnection;

  beforeEach((): void => {
    projectRoot = mkdtempSync(join(tmpdir(), "steward-categories-store-"));
    db = openRuntimeDb(projectRoot);
    runSqliteMigrations(db);
    setRuntimeDb(db);
  });

  afterEach((): void => {
    clearRuntimeDb();
    closeRuntimeDb(db);
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("finds static and dynamic category rows without enumerating a category registry", () => {
    const documentationFinding = createFinding({
      categoryId: "documentation-refresh",
      title: "Documentation drift",
      status: STATUS.NEEDS_REVIEW,
    });
    const genericFinding = createFinding({
      categoryId: "dynamic-code-quality",
      title: "Generic finding",
      status: STATUS.APPROVED,
    });
    saveFinding(projectRoot, documentationFinding);
    saveFinding(projectRoot, genericFinding);

    expect(getFindingById(projectRoot, documentationFinding.id)).toEqual({
      categoryId: "documentation-refresh",
      item: expect.objectContaining({ id: documentationFinding.id }),
    });
    expect(
      new Set(
        listFindingsByStatuses(projectRoot, [STATUS.NEEDS_REVIEW, STATUS.APPROVED]).map(
          (item) => item.id
        )
      )
    ).toEqual(new Set([documentationFinding.id, genericFinding.id]));
    expect(new Set(listAllFindings(projectRoot).map((item) => item.categoryId))).toEqual(
      new Set(["documentation-refresh", "dynamic-code-quality"])
    );
  });
});
