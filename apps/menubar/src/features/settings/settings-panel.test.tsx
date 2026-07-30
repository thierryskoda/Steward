import assert from "node:assert";
import { describe, it } from "node:test";
import type { INextCommitmentStatusResponse } from "@steward/contracts/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { NextCommitmentRow } from "./settings-panel.js";

const recommendation = {
  status: "recommendation",
  runId: "75074e66-e8d0-461b-915c-c2d28b36e3c9",
  createdAt: 1,
  startedAt: 2,
  completedAt: 3,
  stopReason: null,
  result: {
    status: "recommendation",
    summary: "The review found one bounded commitment backed by current project evidence.",
    inspectedProjectPaths: ["docs/goals.md", "src/current-work.ts"],
    inspectedTaskIds: ["019f-task-one"],
    uncertainties: ["The external dependency timeline is not confirmed."],
    evidence: [
      {
        source: "project-file",
        location: "docs/goals.md",
        finding: "The documented goal identifies the incomplete current milestone.",
      },
      {
        source: "codex-task",
        location: "019f-task-one",
        finding: "The recent task stopped before validating the final user-facing workflow.",
      },
    ],
    commitment: {
      title: "Validate the incomplete user-facing workflow",
      whyNow: "It is the closest unfinished work to the project's currently documented goal.",
      expectedOutcome: "The existing workflow is proven with a realistic end-to-end scenario.",
      definitionOfDone: ["Run the realistic scenario and record the result."],
      firstAction: "Open the current workflow and reproduce the unfinished path.",
    },
    whyThisWins: "It completes already-started work before expanding project scope.",
    strongestCounterargument: "A newer feature could produce more immediate user value.",
    alternatives: [],
  },
} satisfies INextCommitmentStatusResponse;

const noCommitment = {
  status: "none",
  runId: "b75c4e4a-a872-42f2-8d4d-aec8b73f9130",
  createdAt: 1,
  startedAt: 2,
  completedAt: 3,
  stopReason: null,
  result: {
    status: "none",
    summary: "The reviewed evidence does not support one valuable commitment right now.",
    inspectedProjectPaths: ["README.md"],
    inspectedTaskIds: [],
    uncertainties: [],
    evidence: [
      {
        source: "project-file",
        location: "README.md",
        finding: "The current documented milestone is complete and no blocker is recorded.",
      },
    ],
    reason: "Choosing work now would manufacture activity without a demonstrated project need.",
    reconsiderWhen: "A new goal, blocker, or partially completed workflow appears.",
  },
} satisfies INextCommitmentStatusResponse;

const blockedCommitment = {
  status: "blocked",
  runId: "7ef38cc7-8e2e-4b8c-b458-7f9f41217d73",
  createdAt: 1,
  startedAt: 2,
  completedAt: 3,
  stopReason: null,
  result: {
    status: "blocked",
    summary: "The current sources conflict on which product outcome is still active.",
    inspectedProjectPaths: ["README.md"],
    inspectedTaskIds: [],
    uncertainties: ["The owner has not selected between the two documented outcomes."],
    evidence: [
      {
        source: "project-file",
        location: "README.md",
        finding: "Two incompatible milestones are both described as the current priority.",
      },
    ],
    blocker: "The available evidence cannot establish which product outcome should win.",
    nextAction: "Ask the owner to choose which documented milestone remains active.",
  },
} satisfies INextCommitmentStatusResponse;

describe("NextCommitmentRow", () => {
  it("keeps a saved recommendation visible when refresh fails and exposes its audit evidence", () => {
    const html = renderToStaticMarkup(
      <NextCommitmentRow
        value={recommendation}
        isPending={false}
        isError={true}
        isRuntimeStopped={false}
        isStarting={false}
        startError={true}
        onStart={() => undefined}
        onStartInCodex={() => Promise.resolve()}
      />
    );

    assert.match(html, /Validate the incomplete user-facing workflow/);
    assert.match(html, /Showing the last saved review/);
    assert.match(html, /Evidence and review scope/);
    assert.match(html, /The review found one bounded commitment/);
    assert.match(html, /docs\/goals\.md/);
    assert.match(html, /019f-task-one/);
    assert.match(html, /external dependency timeline/);
    assert.doesNotMatch(html, /The latest recommendation is temporarily unavailable/);
    assert.match(html, /could not start the review/);
    assert.match(html, /Start in Codex/);
    assert.match(
      html,
      /Creates a Codex task, runs the review, and opens it when the answer is ready/
    );
  });

  it("renders no recommendation as success and a blocker as a distinct actionable outcome", () => {
    const render = (value: INextCommitmentStatusResponse): string =>
      renderToStaticMarkup(
        <NextCommitmentRow
          value={value}
          isPending={false}
          isError={false}
          isRuntimeStopped={false}
          isStarting={false}
          startError={false}
          onStart={() => undefined}
          onStartInCodex={() => Promise.resolve()}
        />
      );

    const noneHtml = render(noCommitment);
    assert.match(noneHtml, /Nothing strong enough to recommend right now/);
    assert.match(noneHtml, /manufacture activity/);
    assert.doesNotMatch(noneHtml, /review did not finish/i);
    assert.doesNotMatch(noneHtml, /Start in Codex/);

    const blockedHtml = render(blockedCommitment);
    assert.match(blockedHtml, /Review blocked/);
    assert.match(blockedHtml, /Ask the owner to choose/);
    assert.match(blockedHtml, /owner has not selected/);
    assert.doesNotMatch(blockedHtml, /Start in Codex/);
  });
});
