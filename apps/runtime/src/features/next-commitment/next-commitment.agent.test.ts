import { describe, expect, it } from "vitest";
import { nextCommitmentAgent } from "./next-commitment.agent.js";
import { NEXT_COMMITMENT_RECENT_TASK_MANIFEST_LIMIT } from "./next-commitment-limits.js";
import {
  NextCommitmentAgentInputSchema,
  NextCommitmentAgentOutputSchema,
} from "./next-commitment.schemas.js";

const input = {
  projectRoot: "/projects/grocery",
  capturedAt: 1_785_000_000_000,
  projectSnapshot: {
    headSha: "abc123",
    worktreeHash: "snapshot-hash",
  },
  reviewSnapshot: {
    workspacePath: "/tmp/review-workspace",
    gitStatePath: "/tmp/review-workspace/.steward-review-evidence/git-state.json",
    includedFileCount: 42,
    excludedFileCount: 3,
    truncated: false,
  },
  configuredContextPatterns: ["README.md", "docs/**/*.md"],
  recentTasks: {
    manifestPath: "/projects/grocery/.steward/tmp/runs/run-1/recent-codex-tasks.json",
    lookbackDays: 30,
    manifestTaskCount: 4,
    eligibleTaskCount: 7,
    truncated: true,
    scanTruncated: false,
  },
};

describe("nextCommitmentAgent", () => {
  it("accepts the canonical manifest limit and rejects larger locator metadata", () => {
    expect(
      NextCommitmentAgentInputSchema.safeParse({
        ...input,
        recentTasks: {
          ...input.recentTasks,
          manifestTaskCount: NEXT_COMMITMENT_RECENT_TASK_MANIFEST_LIMIT,
          eligibleTaskCount: NEXT_COMMITMENT_RECENT_TASK_MANIFEST_LIMIT,
          truncated: false,
        },
      }).success
    ).toBe(true);
    expect(
      NextCommitmentAgentInputSchema.safeParse({
        ...input,
        recentTasks: {
          ...input.recentTasks,
          manifestTaskCount: NEXT_COMMITMENT_RECENT_TASK_MANIFEST_LIMIT + 1,
        },
      }).success
    ).toBe(false);
  });

  it("builds a locator-only, project-isolated, read-only recommendation prompt", () => {
    const prompt = nextCommitmentAgent.buildPrompt(input);

    expect(prompt).toContain("/projects/grocery");
    expect(prompt).toContain(input.recentTasks.manifestPath);
    expect(prompt).toContain('"docs/**/*.md"');
    expect(prompt).toContain("Return recommendation only when one commitment clearly wins");
    expect(prompt).toContain('return status "none"');
    expect(prompt).toContain("Do not implement");
    expect(prompt).toContain("Do not run tests");
    expect(prompt).toContain("under 240 characters");
    expect(prompt).toContain("immutable in-memory evidence snapshot");
    expect(prompt).toContain("No shell, general filesystem");
    expect(prompt).toContain("stewardEvidence read-only tools");
    expect(prompt).toContain("read_project_state");
    expect(prompt).toContain("may still be unrelated");
    expect(prompt).not.toContain("conversationBody");
  });

  it("accepts one evidence-backed recommendation with no more than two alternatives", () => {
    const result = NextCommitmentAgentOutputSchema.parse({
      status: "recommendation",
      summary: "Finish the partially shipped retailer matching flow.",
      inspectedProjectPaths: ["README.md", "src/offers.ts"],
      inspectedTaskIds: ["task-grocery"],
      evidence: [
        {
          source: "project-file",
          location: "README.md",
          finding: "The documented target requires all six retailers.",
        },
        {
          source: "codex-task",
          location: "task-grocery",
          finding: "The latest task reports that streaming results remain incomplete.",
        },
      ],
      uncertainties: [],
      commitment: {
        title: "Stream retailer matches as each store completes",
        whyNow: "It is the remaining gap in the active end-to-end flow.",
        expectedOutcome: "Users see useful matches before the full batch finishes.",
        definitionOfDone: [
          "Each retailer result renders independently.",
          "The existing six-retailer end-to-end test remains green.",
        ],
        firstAction: "Trace the current batch response boundary and write the failing UI test.",
      },
      whyThisWins: "It completes active work tied directly to the product goal.",
      strongestCounterargument:
        "The batch flow already works and another gap may have more impact.",
      alternatives: [
        {
          title: "Expand barcode coverage",
          whyNotNow: "Coverage work is less valuable while result delivery is still incomplete.",
        },
      ],
    });

    expect(result.status).toBe("recommendation");
  });

  it("rejects vague or extra-shaped recommendation output", () => {
    const result = NextCommitmentAgentOutputSchema.safeParse({
      status: "recommendation",
      summary: "Improve the project.",
      inspectedProjectPaths: [],
      inspectedTaskIds: [],
      evidence: [],
      uncertainties: [],
      commitment: {
        title: "Improve things",
        whyNow: "It seems useful.",
        expectedOutcome: "Better project.",
        definitionOfDone: [],
        firstAction: "Look around.",
      },
      whyThisWins: "It is good.",
      strongestCounterargument: "None.",
      alternatives: [],
      confidence: 0.9,
    });

    expect(result.success).toBe(false);
  });

  it("allows the agent to recommend nothing when no commitment clearly wins", () => {
    const result = NextCommitmentAgentOutputSchema.parse({
      status: "none",
      summary: "Current evidence does not support a high-confidence next commitment.",
      inspectedProjectPaths: ["README.md"],
      inspectedTaskIds: [],
      evidence: [
        {
          source: "project-file",
          location: "README.md",
          finding: "The current goal is stated, but no unfinished work is evidenced.",
        },
      ],
      uncertainties: ["No recent Codex tasks were available for this project."],
      reason: "Choosing now would manufacture work rather than reduce a demonstrated constraint.",
      reconsiderWhen: "New project work, a blocker, or a concrete goal appears.",
    });

    expect(result.status).toBe("none");
  });
});
