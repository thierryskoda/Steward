import { useEffect, useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import { getCategoryLabel } from "./labels.js";
import { Button } from "./primitives/button.js";
import { Badge } from "./primitives/badge.js";
import { cn } from "./primitives/cn.js";

export type IFindingOptionInput = {
  id: "A" | "B" | "C";
  humanSummary: string | undefined;
  humanChooseThisIf: string | undefined;
  humanTradeoff: string | undefined;
};

export type IFindingDetailInput = {
  id: string;
  title: string;
  displayType: string;
  showTitle?: boolean;
  humanSummary: string | undefined;
  humanCurrentBehavior: string | undefined;
  humanWhyItMatters: string | undefined;
  humanEvidence: string[] | undefined;
  humanDecisionQuestion: string | undefined;
  options: IFindingOptionInput[];
  selectedOptionId: "A" | "B" | "C" | undefined;
};

type IFindingDetailViewCommonProps = {
  input: IFindingDetailInput;
  mode?: "interactive" | "readOnly";
  /** Inbox API guarantees human fields; stored findings may omit them until humanized. */
  enforceInboxFields?: boolean;
};

export type IFindingDetailViewProps = IFindingDetailViewCommonProps &
  (
    | {
        variant?: "finding";
        onApprove: (selectedOptionId: "A" | "B" | "C" | undefined) => void;
        onReject: (rejectReason: string) => void;
      }
    | {
        variant: "documentationReport";
        onDismiss: () => void;
      }
  );

function assertInboxProblemFields(input: IFindingDetailInput): void {
  if (input.humanSummary === undefined) {
    throw new Error(`Inbox finding ${input.id}: humanSummary is required`);
  }
  if (input.humanCurrentBehavior === undefined) {
    throw new Error(`Inbox finding ${input.id}: humanCurrentBehavior is required`);
  }
  if (input.humanWhyItMatters === undefined) {
    throw new Error(`Inbox finding ${input.id}: humanWhyItMatters is required`);
  }
  if (input.humanEvidence === undefined) {
    throw new Error(`Inbox finding ${input.id}: humanEvidence is required`);
  }
  if (input.humanDecisionQuestion === undefined) {
    throw new Error(`Inbox finding ${input.id}: humanDecisionQuestion is required`);
  }
}

function assertInboxOptionFields(options: IFindingOptionInput[]): void {
  for (const o of options) {
    if (o.humanSummary === undefined) {
      throw new Error(`Inbox finding option ${o.id}: humanSummary is required`);
    }
    if (o.humanChooseThisIf === undefined) {
      throw new Error(`Inbox finding option ${o.id}: humanChooseThisIf is required`);
    }
    if (o.humanTradeoff === undefined) {
      throw new Error(`Inbox finding option ${o.id}: humanTradeoff is required`);
    }
  }
}

function isOptionHumanComplete(o: IFindingOptionInput): boolean {
  return (
    o.humanSummary !== undefined &&
    o.humanChooseThisIf !== undefined &&
    o.humanTradeoff !== undefined
  );
}

export function FindingDetailView(props: IFindingDetailViewProps): JSX.Element {
  const { input, mode = "interactive", enforceInboxFields = true } = props;
  if (enforceInboxFields) {
    assertInboxProblemFields(input);
    assertInboxOptionFields(input.options);
  }

  const options = input.options;
  const readOnly = mode === "readOnly";
  const documentationReport = props.variant === "documentationReport";
  const [selectedOptionId, setSelectedOptionId] = useState<"A" | "B" | "C" | undefined>(
    input.selectedOptionId
  );
  const canApprove = options.length === 0 || selectedOptionId !== undefined;
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const problemComplete =
    input.humanSummary !== undefined &&
    input.humanCurrentBehavior !== undefined &&
    input.humanWhyItMatters !== undefined &&
    input.humanEvidence !== undefined &&
    input.humanDecisionQuestion !== undefined;

  useEffect(() => {
    setSelectedOptionId(input.selectedOptionId);
  }, [input.selectedOptionId, input.id]);

  return (
    <div className="relative">
      <div className="mb-10 space-y-8">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="font-mono normal-case">
              {getCategoryLabel(input.displayType)}
            </Badge>
            {documentationReport ? <Badge variant="outline">Read-only report</Badge> : null}
          </div>
          {input.showTitle !== false ? (
            <h3 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
              {input.title}
            </h3>
          ) : null}
        </header>

        {!problemComplete && !enforceInboxFields ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            Human-readable fields are not available for this finding yet.
          </p>
        ) : null}

        {problemComplete || enforceInboxFields ? (
          <section className="space-y-6">
            <p className="max-w-3xl text-lg leading-relaxed text-zinc-700 dark:text-zinc-300">
              {input.humanSummary}
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Current behavior
                </p>
                <p className="text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200">
                  {input.humanCurrentBehavior}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  What we found
                </p>
                <ul className="space-y-2">
                  {(input.humanEvidence ?? []).map((evidence) => (
                    <li
                      key={evidence}
                      className="flex gap-2 text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200"
                    >
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                      <span>{evidence}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/40 dark:bg-amber-950/30">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Why it matters
                </p>
                <p className="mt-1 text-sm leading-relaxed text-amber-950/90 dark:text-amber-100/90">
                  {input.humanWhyItMatters}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-5 dark:border-zinc-700 dark:bg-zinc-900/50">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {documentationReport ? "Review question" : "Decision"}
              </p>
              <p className="text-lg font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                {input.humanDecisionQuestion}
              </p>
            </div>
          </section>
        ) : null}

        {documentationReport && options[0] ? (
          <section
            className="space-y-4 border-y border-zinc-200 py-5 dark:border-zinc-800"
            aria-label="Recommended documentation correction"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                Recommended correction
              </p>
              <p className="mt-2 text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-100">
                {options[0].humanSummary}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                Advisory boundary
              </p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                {options[0].humanTradeoff}
              </p>
            </div>
          </section>
        ) : (
          <div className="space-y-6">
            {options.map((option) => {
              const selected = option.id === selectedOptionId;
              const humanComplete = isOptionHumanComplete(option);
              return (
                <div key={option.id} className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Option {option.id}
                    </span>
                    {selected ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                        <Check className="h-3.5 w-3.5" />
                        Selected
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={readOnly || (!enforceInboxFields && !humanComplete)}
                    onClick={() => !readOnly && humanComplete && setSelectedOptionId(option.id)}
                    className={cn(
                      "w-full rounded-xl border text-left transition-all",
                      selected
                        ? "border-indigo-500 bg-indigo-50/80 shadow-md ring-1 ring-indigo-500/30 dark:border-indigo-500 dark:bg-indigo-950/40"
                        : "border-zinc-200 bg-white hover:border-indigo-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-indigo-600",
                      readOnly && "cursor-default hover:border-zinc-200 dark:hover:border-zinc-700",
                      !humanComplete && !enforceInboxFields && "opacity-90"
                    )}
                  >
                    <div className="space-y-5 p-5 sm:p-6">
                      {!humanComplete && !enforceInboxFields ? (
                        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                          Human-readable fields are not available for this option yet.
                        </p>
                      ) : null}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                          Proposal
                        </p>
                        <p className="mt-2 text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-100">
                          {humanComplete || enforceInboxFields ? option.humanSummary : "-"}
                        </p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                            Choose this if
                          </p>
                          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                            {humanComplete || enforceInboxFields ? option.humanChooseThisIf : "-"}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                            Tradeoff
                          </p>
                          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                            {humanComplete || enforceInboxFields ? option.humanTradeoff : "-"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {documentationReport && !readOnly ? (
        <div className="sticky bottom-0 z-20 mt-8 flex justify-end border-t border-zinc-200/80 bg-white/90 px-1 py-4 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90">
          <Button variant="outline" type="button" onClick={props.onDismiss}>
            Dismiss report
          </Button>
        </div>
      ) : !readOnly && props.variant !== "documentationReport" ? (
        <div className="sticky bottom-0 z-20 mt-8 border-t border-zinc-200/80 bg-white/80 px-1 py-4 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/85">
          {rejectOpen ? (
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">
                Reason for rejection
                <input
                  type="text"
                  className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] font-normal text-zinc-900 outline-none ring-zinc-900 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <Button variant="ghost" type="button" onClick={() => setRejectOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  type="button"
                  onClick={() => props.onReject(rejectReason.trim())}
                >
                  Confirm reject
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              variant="ghost"
              type="button"
              disabled={rejectOpen}
              onClick={() => setRejectOpen(true)}
            >
              Reject
            </Button>
            {!rejectOpen ? (
              <Button
                type="button"
                disabled={!canApprove}
                onClick={() => props.onApprove(selectedOptionId)}
              >
                Approve selected
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
