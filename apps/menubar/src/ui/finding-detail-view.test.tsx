import { describe, it } from "node:test";
import assert from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { FindingDetailView, type IFindingDetailInput } from "./finding-detail-view.js";

const input: IFindingDetailInput = {
  id: "finding-1",
  title: "README Command Drift",
  displayType: "documentation-refresh",
  humanSummary: "The README command no longer matches the package script.",
  humanCurrentBehavior: "The README and package script name different commands.",
  humanWhyItMatters: "A contributor cannot follow the documented setup path.",
  humanEvidence: ["README.md and package.json disagree."],
  humanDecisionQuestion: "Should the README command be corrected?",
  options: [
    {
      id: "A",
      humanSummary: "Use the current package script in the README.",
      humanChooseThisIf: "Choose this after confirming the package script is authoritative.",
      humanTradeoff: "This report does not change repository files.",
    },
  ],
  selectedOptionId: undefined,
};

describe("FindingDetailView documentation report presentation", () => {
  it("renders one read-only recommendation and only the dismiss action", () => {
    const html = renderToStaticMarkup(
      <FindingDetailView input={input} variant="documentationReport" onDismiss={() => undefined} />
    );

    assert.match(html, /Read-only report/);
    assert.match(html, /Recommended correction/);
    assert.match(html, /Dismiss report/);
    assert.doesNotMatch(html, /Approve selected/);
    assert.doesNotMatch(html, /Option A/);
    assert.doesNotMatch(html, /Reason for rejection/);
  });

  it("preserves selection and approval controls for generic findings", () => {
    const html = renderToStaticMarkup(
      <FindingDetailView
        input={{ ...input, displayType: "architecture-coupling" }}
        onApprove={() => undefined}
        onReject={() => undefined}
      />
    );

    assert.match(html, /Option A/);
    assert.match(html, /Approve selected/);
    assert.match(html, /Reject/);
    assert.doesNotMatch(html, /Dismiss report/);
  });
});
