import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextCommitmentResultSchema, type INextCommitmentResult } from "@steward/contracts/schemas";
import { ERR_NEXT_COMMITMENT_EVIDENCE } from "../../core/error-codes.js";
import {
  assertNextCommitmentResultProvenance,
  validateConfiguredContextPatterns,
} from "./next-commitment-evidence.js";

let projectRoot: string;
let outsideRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "steward-commitment-evidence-project-"));
  outsideRoot = mkdtempSync(join(tmpdir(), "steward-commitment-evidence-outside-"));
  mkdirSync(join(projectRoot, "docs"));
  writeFileSync(join(projectRoot, "AGENTS.md"), "# Guidance\n", "utf8");
  writeFileSync(join(projectRoot, "README.md"), "# Project\n", "utf8");
  writeFileSync(join(projectRoot, "docs", "goals.md"), "# Goals\n", "utf8");
  writeFileSync(join(projectRoot, ".gitignore"), "ignored.db\n", "utf8");
  writeFileSync(join(projectRoot, "ignored.db"), "moving local state\n", "utf8");
  writeFileSync(join(outsideRoot, "secret.md"), "secret\n", "utf8");
  symlinkSync(join(outsideRoot, "secret.md"), join(projectRoot, "escape.md"));
  execFileSync("git", ["init", "--quiet"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.email", "steward@example.test"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.name", "Steward Test"], { cwd: projectRoot });
  execFileSync("git", ["add", "AGENTS.md", "README.md", "docs/goals.md", ".gitignore"], {
    cwd: projectRoot,
  });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: projectRoot });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(outsideRoot, { recursive: true, force: true });
});

function recommendation(
  overrides: {
    inspectedProjectPaths?: string[];
    inspectedTaskIds?: string[];
    evidence?: Array<{
      source: "project-file" | "codex-task" | "task-manifest";
      location: string;
      finding: string;
    }>;
  } = {}
): INextCommitmentResult {
  return NextCommitmentResultSchema.parse({
    status: "recommendation",
    summary: "Finish the current acceptance proof before expanding coverage.",
    inspectedProjectPaths: overrides.inspectedProjectPaths ?? ["README.md"],
    inspectedTaskIds: overrides.inspectedTaskIds ?? ["task-1"],
    evidence: overrides.evidence ?? [
      {
        source: "project-file",
        location: "README.md",
        finding: "The documented acceptance proof is still incomplete.",
      },
      {
        source: "codex-task",
        location: "task-1",
        finding: "The latest project task stopped before the real replay was complete.",
      },
    ],
    uncertainties: [],
    commitment: {
      title: "Complete the current acceptance proof",
      whyNow: "It is the demonstrated gate on the active product workflow.",
      expectedOutcome: "The owner can decide whether the current flow is safe to expand.",
      definitionOfDone: ["A representative replay passes with reviewed results."],
      firstAction: "Prepare the smallest representative replay fixture.",
    },
    whyThisWins: "It closes active work and resolves the largest current uncertainty.",
    strongestCounterargument: "Broader coverage might reveal a higher-value opportunity first.",
    alternatives: [],
  });
}

describe("next commitment evidence boundaries", () => {
  it("keeps only safe repository-relative configured context locators", () => {
    expect(
      validateConfiguredContextPatterns({
        projectRoot,
        patterns: [
          " README.md ",
          "docs/**/*.md",
          "../outside.md",
          "/tmp/outside.md",
          "escape.md",
          "ignored.db",
          ".env",
          "missing.md",
          "README.md",
        ],
      })
    ).toEqual(["README.md", "docs/**/*.md"]);
  });

  it("accepts project paths and task ids tied to the captured manifest", () => {
    expect(() =>
      assertNextCommitmentResultProvenance({
        result: recommendation(),
        projectRoot,
        manifestTaskIds: ["task-1"],
        reviewedProjectPaths: ["README.md"],
        exposedProjectPaths: ["README.md"],
        exposedTaskIds: ["task-1"],
        projectStateInspected: false,
        taskManifestInspected: false,
      })
    ).not.toThrow();
  });

  it("treats the recent-task listing as selection metadata rather than task-content exposure", () => {
    expect(() =>
      assertNextCommitmentResultProvenance({
        result: recommendation(),
        projectRoot,
        manifestTaskIds: ["task-1"],
        reviewedProjectPaths: ["README.md"],
        exposedProjectPaths: ["README.md"],
        exposedTaskIds: ["task-1"],
        projectStateInspected: false,
        taskManifestInspected: true,
      })
    ).not.toThrow();
  });

  it("rejects a captured project path that was not read through the evidence broker", () => {
    expect(() =>
      assertNextCommitmentResultProvenance({
        result: recommendation(),
        projectRoot,
        manifestTaskIds: ["task-1"],
        reviewedProjectPaths: ["README.md"],
        exposedProjectPaths: [],
        exposedTaskIds: ["task-1"],
        projectStateInspected: false,
        taskManifestInspected: false,
      })
    ).toThrowError(
      expect.objectContaining({
        code: ERR_NEXT_COMMITMENT_EVIDENCE,
        context: expect.objectContaining({ reason: "project_path_not_read_through_broker" }),
      })
    );
  });

  it("rejects a manifest task that was not read through the evidence broker", () => {
    expect(() =>
      assertNextCommitmentResultProvenance({
        result: recommendation(),
        projectRoot,
        manifestTaskIds: ["task-1"],
        reviewedProjectPaths: ["README.md"],
        exposedProjectPaths: ["README.md"],
        exposedTaskIds: [],
        projectStateInspected: false,
        taskManifestInspected: false,
      })
    ).toThrowError(
      expect.objectContaining({
        code: ERR_NEXT_COMMITMENT_EVIDENCE,
        context: expect.objectContaining({ reason: "task_not_read_through_broker" }),
      })
    );
  });

  it("rejects a project-state citation when the broker did not expose project state", () => {
    const result = recommendation({
      inspectedProjectPaths: ["README.md", "."],
      inspectedTaskIds: [],
      evidence: [
        {
          source: "project-file",
          location: "README.md",
          finding: "The documented acceptance proof is still incomplete.",
        },
        {
          source: "project-file",
          location: ".",
          finding: "The worktree state identifies the active change.",
        },
      ],
    });

    expect(() =>
      assertNextCommitmentResultProvenance({
        result,
        projectRoot,
        manifestTaskIds: [],
        reviewedProjectPaths: ["README.md"],
        exposedProjectPaths: ["README.md"],
        exposedTaskIds: [],
        projectStateInspected: false,
        taskManifestInspected: false,
      })
    ).toThrowError(
      expect.objectContaining({
        code: ERR_NEXT_COMMITMENT_EVIDENCE,
        context: expect.objectContaining({ reason: "project_state_not_read_through_broker" }),
      })
    );
  });

  it("rejects a task-manifest citation when the broker did not expose the manifest", () => {
    const result = recommendation({
      inspectedTaskIds: [],
      evidence: [
        {
          source: "project-file",
          location: "README.md",
          finding: "The documented acceptance proof is still incomplete.",
        },
        {
          source: "task-manifest",
          location: "recent-codex-tasks.json",
          finding: "No recent project task changes the current priority.",
        },
      ],
    });

    expect(() =>
      assertNextCommitmentResultProvenance({
        result,
        projectRoot,
        manifestTaskIds: [],
        reviewedProjectPaths: ["README.md"],
        exposedProjectPaths: ["README.md"],
        exposedTaskIds: [],
        projectStateInspected: false,
        taskManifestInspected: false,
      })
    ).toThrowError(
      expect.objectContaining({
        code: ERR_NEXT_COMMITMENT_EVIDENCE,
        context: expect.objectContaining({ reason: "task_manifest_not_read_through_broker" }),
      })
    );
  });

  it("rejects reported project and task evidence that the broker did not expose", () => {
    expect(() =>
      assertNextCommitmentResultProvenance({
        result: recommendation(),
        projectRoot,
        manifestTaskIds: ["task-1"],
        reviewedProjectPaths: ["README.md"],
        exposedProjectPaths: [],
        exposedTaskIds: [],
        projectStateInspected: false,
        taskManifestInspected: false,
      })
    ).toThrowError(expect.objectContaining({ code: ERR_NEXT_COMMITMENT_EVIDENCE }));
  });

  it("rejects broker-exposed project content omitted from the persisted inspection audit", () => {
    expect(() =>
      assertNextCommitmentResultProvenance({
        result: recommendation(),
        projectRoot,
        manifestTaskIds: ["task-1"],
        reviewedProjectPaths: ["AGENTS.md", "README.md"],
        exposedProjectPaths: ["AGENTS.md", "README.md"],
        exposedTaskIds: ["task-1"],
        projectStateInspected: false,
        taskManifestInspected: false,
      })
    ).toThrowError(
      expect.objectContaining({
        code: ERR_NEXT_COMMITMENT_EVIDENCE,
        context: expect.objectContaining({
          reason: "broker_project_path_read_not_reported",
          path: "AGENTS.md",
        }),
      })
    );
  });

  it("rejects broker-exposed task content omitted from the persisted inspection audit", () => {
    expect(() =>
      assertNextCommitmentResultProvenance({
        result: recommendation(),
        projectRoot,
        manifestTaskIds: ["task-1", "task-2"],
        reviewedProjectPaths: ["README.md"],
        exposedProjectPaths: ["README.md"],
        exposedTaskIds: ["task-1", "task-2"],
        projectStateInspected: false,
        taskManifestInspected: false,
      })
    ).toThrowError(
      expect.objectContaining({
        code: ERR_NEXT_COMMITMENT_EVIDENCE,
        context: expect.objectContaining({
          reason: "broker_task_read_not_reported",
          taskId: "task-2",
        }),
      })
    );
  });

  it("rejects broker-exposed project state omitted from the persisted inspection audit", () => {
    expect(() =>
      assertNextCommitmentResultProvenance({
        result: recommendation(),
        projectRoot,
        manifestTaskIds: ["task-1"],
        reviewedProjectPaths: ["README.md"],
        exposedProjectPaths: ["README.md"],
        exposedTaskIds: ["task-1"],
        projectStateInspected: true,
        taskManifestInspected: false,
      })
    ).toThrowError(
      expect.objectContaining({
        code: ERR_NEXT_COMMITMENT_EVIDENCE,
        context: expect.objectContaining({ reason: "broker_project_state_read_not_reported" }),
      })
    );
  });

  it("requires broker audit entries for project-state and task-manifest citations", () => {
    const result = recommendation({
      inspectedProjectPaths: ["README.md", "."],
      inspectedTaskIds: [],
      evidence: [
        {
          source: "project-file",
          location: ".",
          finding: "The worktree state identifies the active change.",
        },
        {
          source: "task-manifest",
          location: "recent-codex-tasks.json",
          finding: "The manifest has no recent project tasks.",
        },
      ],
    });
    for (const audit of [
      { projectStateInspected: false, taskManifestInspected: true },
      { projectStateInspected: true, taskManifestInspected: false },
    ]) {
      expect(() =>
        assertNextCommitmentResultProvenance({
          result,
          projectRoot,
          manifestTaskIds: [],
          reviewedProjectPaths: ["README.md"],
          exposedProjectPaths: ["README.md"],
          exposedTaskIds: [],
          ...audit,
        })
      ).toThrowError(expect.objectContaining({ code: ERR_NEXT_COMMITMENT_EVIDENCE }));
    }
  });

  it.each([
    {
      name: "a task outside the manifest",
      result: () => recommendation({ inspectedTaskIds: ["fabricated-task"] }),
    },
    {
      name: "a symlink escaping the project",
      result: () =>
        recommendation({
          inspectedProjectPaths: ["escape.md"],
          evidence: [
            {
              source: "project-file",
              location: "escape.md",
              finding: "This alleged evidence resolves outside the selected project.",
            },
            {
              source: "codex-task",
              location: "task-1",
              finding: "The latest task describes the current project state.",
            },
          ],
        }),
    },
    {
      name: "an ignored moving data file",
      result: () =>
        recommendation({
          inspectedProjectPaths: ["ignored.db"],
          evidence: [
            {
              source: "project-file",
              location: "ignored.db",
              finding: "This local state is not covered by the Git supersession snapshot.",
            },
            {
              source: "codex-task",
              location: "task-1",
              finding: "The latest task describes the current project state.",
            },
          ],
        }),
    },
    {
      name: "a valid project file omitted from the sanitized review snapshot",
      result: () =>
        recommendation({
          inspectedProjectPaths: ["docs/goals.md"],
          evidence: [
            {
              source: "project-file",
              location: "docs/goals.md",
              finding: "This file exists but was not available to the review agent.",
            },
            {
              source: "codex-task",
              location: "task-1",
              finding: "The latest task describes the current project state.",
            },
          ],
        }),
    },
    {
      name: "duplicate evidence locators",
      result: () =>
        recommendation({
          evidence: [
            {
              source: "project-file",
              location: "README.md",
              finding: "The first claim is grounded in the project readme.",
            },
            {
              source: "project-file",
              location: "README.md",
              finding: "The second claim tries to reuse the same locator.",
            },
          ],
        }),
    },
  ])("rejects $name before persistence", ({ result }) => {
    const resultValue = result();
    expect(() =>
      assertNextCommitmentResultProvenance({
        result: resultValue,
        projectRoot,
        manifestTaskIds: ["task-1"],
        reviewedProjectPaths: ["README.md"],
        exposedProjectPaths: resultValue.inspectedProjectPaths.filter((path) => path !== "."),
        exposedTaskIds: resultValue.inspectedTaskIds,
        projectStateInspected: resultValue.inspectedProjectPaths.includes("."),
        taskManifestInspected: resultValue.evidence.some(
          (entry) => entry.source === "task-manifest"
        ),
      })
    ).toThrowError(expect.objectContaining({ code: ERR_NEXT_COMMITMENT_EVIDENCE }));
  });
});
