import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { normalizeAgentReportedProjectPath } from "./agent-file-paths.js";

describe("normalizeAgentReportedProjectPath", () => {
  it("keeps project-relative paths unchanged", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "cto-path-normalize-project-"));
    try {
      assert.equal(
        normalizeAgentReportedProjectPath({
          projectRoot,
          reportedPath: "src/user-display-name.js",
          operation: "test",
        }),
        "src/user-display-name.js"
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("normalizes paths that include the target project directory marker", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "cto-path-normalize-project-"));
    try {
      const reportedPath = `apps/runtime/scripts/logs/e2e/${projectRoot.split("/").pop()}/src/user-display-name.js`;
      assert.equal(
        normalizeAgentReportedProjectPath({
          projectRoot,
          reportedPath,
          operation: "test",
        }),
        "src/user-display-name.js"
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects paths outside the target project", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "cto-path-normalize-project-"));
    try {
      assert.throws(() =>
        normalizeAgentReportedProjectPath({
          projectRoot,
          reportedPath: "../outside.js",
          operation: "test",
        })
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
