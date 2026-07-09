import { describe, it } from "vitest";
import assert from "node:assert";
import { collectGitSnapshot, type IGitStatusEntry, type IGitStatusCode } from "./git-snapshot.js";
import { buildGitDelta, hasScopeStructureChanges } from "./git-delta.js";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../../../../..");

function entry(path: string, status: IGitStatusCode): IGitStatusEntry {
  return { path, status };
}

describe("hasScopeStructureChanges", () => {
  it("returns true when .gitignore changes", () => {
    assert.strictEqual(hasScopeStructureChanges([entry(".gitignore", "M")]), true);
  });
  it("returns true when top-level file added", () => {
    assert.strictEqual(hasScopeStructureChanges([entry("temp", "A")]), true);
  });
  it("returns true when file deleted", () => {
    assert.strictEqual(hasScopeStructureChanges([entry("src/foo.ts", "D")]), true);
  });
  it("returns false when only .steward paths change", () => {
    assert.strictEqual(
      hasScopeStructureChanges([
        entry(".steward/state.db-wal", "M"),
        entry(".steward/tmp/runs/request-1/scratch.json", "A"),
      ]),
      false
    );
  });
});

describe("buildGitDelta", () => {
  it("isExcluded option filters paths", () => {
    const snapshot = collectGitSnapshot(projectRoot);
    const full = buildGitDelta(projectRoot, snapshot);
    const isExcluded = (path: string) =>
      path.startsWith(".steward/") || path.startsWith(".git/") || path.includes("node_modules");
    const filtered = buildGitDelta(projectRoot, snapshot, { isExcluded });
    for (const f of filtered) {
      assert.ok(!f.path.startsWith(".steward/"), "isExcluded should exclude .steward/");
      assert.ok(!f.path.startsWith(".git/"), "isExcluded should exclude .git/");
      assert.ok(!f.path.includes("node_modules"), "isExcluded should exclude node_modules");
    }
    assert.ok(filtered.length <= full.length);
  });
});
