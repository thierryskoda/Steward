import { describe, it } from "vitest";
import assert from "node:assert";
import { getCategoryWithOldestRun, recordDetectionRun } from "./detection-run-store.js";

describe("detection-run-store", () => {
  describe("getCategoryWithOldestRun", () => {
    it("returns undefined when categoryIds is empty", () => {
      assert.strictEqual(getCategoryWithOldestRun([]), undefined);
    });

    it("returns the only id when one category", () => {
      assert.strictEqual(getCategoryWithOldestRun(["dead-code"]), "dead-code");
    });

    it("returns any id when none have been run (all tie at 0)", () => {
      const id = getCategoryWithOldestRun(["dead-code", "context-freshness"]);
      assert.ok(id === "dead-code" || id === "context-freshness");
    });

    it("returns the category with smallest lastRunAt after runs recorded", () => {
      recordDetectionRun("run-smallest-a", 1);
      recordDetectionRun("run-smallest-b", 0);
      const ids = ["run-smallest-a", "run-smallest-b", "run-smallest-c"];
      const id = getCategoryWithOldestRun(ids);
      assert.strictEqual(
        id,
        "run-smallest-c",
        "run-smallest-c never run (0) has smallest lastRunAt"
      );
    });

    it("returns never-run category when others have been run", () => {
      recordDetectionRun("never-run-a", 0);
      recordDetectionRun("never-run-b", 1);
      const id = getCategoryWithOldestRun(["never-run-a", "never-run-b", "never-run-c"]);
      assert.ok(
        id === "never-run-a" || id === "never-run-c",
        "never-run-c never run (0) and never-run-a (0) tie; never-run-b (1) is newer"
      );
    });

    it("returns first-run category when all have been run", () => {
      recordDetectionRun("first-A", 0);
      recordDetectionRun("first-B", 0);
      recordDetectionRun("first-C", 0);
      const id = getCategoryWithOldestRun(["first-A", "first-B", "first-C"]);
      assert.strictEqual(id, "first-A", "first-A was run first so has smallest lastRunAt");
    });
  });

  describe("recordDetectionRun", () => {
    it("updates lastRunAt and lastFindingsCount for category", () => {
      recordDetectionRun("record-a", 2);
      const id = getCategoryWithOldestRun(["record-a", "record-b"]);
      assert.strictEqual(id, "record-b", "record-a was just run so record-b (never run) is older");
      recordDetectionRun("record-b", 0);
      const id2 = getCategoryWithOldestRun(["record-a", "record-b"]);
      assert.strictEqual(id2, "record-a", "after running record-b, record-a has older lastRunAt");
    });
  });
});
