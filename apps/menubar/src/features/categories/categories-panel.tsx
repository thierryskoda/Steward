import { useState } from "react";
import {
  useInboxFindingsQuery,
  useApproveFindingMutation,
  useRejectFindingMutation,
} from "./categories.queries.js";
import {
  useSelectedProjectQuery,
  useListProjectsQuery,
  useStartProjectMutation,
  useScanningStatusQuery,
} from "../settings/settings.queries.js";
import { useToastStore } from "../../ui/toast/toast.store.js";
import { ErrorState } from "../../ui/error-state.js";
import { FindingDetailView } from "../../ui/finding-detail-view.js";
import { MessageState } from "../../ui/message-state.js";
import { SearchIcon } from "../../ui/message-state-icons.js";
import { Button } from "../../ui/primitives/button.js";
import type { IInboxFindingItem } from "@steward/contracts/schemas";
import { getRuntimeErrorMessage } from "../../ui/errors.js";
import { ScanningPausedBanner } from "../../ui/scanning-paused-banner.js";

const EMPTY_TITLE = "Analyzing your codebase";
const EMPTY_DESC =
  "AI agents are scanning your project for improvements in code quality, security, architecture, and docs. Suggestions will appear here as they're found.";
const UNDO_DURATION_MS = 5000;
const PANEL_CLASS_NAME = "mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-6 pb-28 pt-8";
const EMPTY_SHELL_CLASS_NAME =
  "flex min-h-0 flex-1 flex-col items-center justify-center px-0 py-8 text-center";

function getDisplayType(item: IInboxFindingItem): string {
  return item.categoryId;
}

export function CategoriesPanel(): JSX.Element {
  const selectedRoot = useSelectedProjectQuery().data;
  const [hiddenItemId, setHiddenItemId] = useState<string | null>(null);
  const hasSelectedRoot = selectedRoot != null && selectedRoot !== "";

  const { data: projects = [] } = useListProjectsQuery();
  const startProjectMutation = useStartProjectMutation();
  const selectedProject = projects.find((p) => p.projectRoot === selectedRoot);
  const scanningStatusQuery = useScanningStatusQuery();

  const isProcessStopped = selectedProject?.status === "stopped";
  const isScanningPaused = scanningStatusQuery.data?.status === "paused";

  const {
    data: items = [],
    isLoading,
    isError,
    error,
  } = useInboxFindingsQuery({
    projectRoot: selectedRoot ?? "__no-project__",
    enabled: hasSelectedRoot && !isProcessStopped,
  });

  const approveMutation = useApproveFindingMutation();
  const rejectMutation = useRejectFindingMutation();
  const showToast = useToastStore((s) => s.show);

  if (selectedRoot == null || selectedRoot === "") {
    return (
      <div className={PANEL_CLASS_NAME} role="tabpanel">
        <p className="text-[15px] text-zinc-500 dark:text-zinc-400">
          No project selected. Switch in Settings.
        </p>
      </div>
    );
  }

  if (isProcessStopped) {
    return (
      <div className={PANEL_CLASS_NAME} role="tabpanel">
        <div className={EMPTY_SHELL_CLASS_NAME}>
          <MessageState
            icon={<SearchIcon />}
            title="Project is stopped"
            description="Start the project runtime to analyze your codebase and view suggestions."
          />
          <div className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => startProjectMutation.mutate(selectedRoot)}
              disabled={startProjectMutation.isPending}
            >
              {startProjectMutation.isPending ? "Starting…" : "Start Project"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const hasItems = items.length > 0;
  const showRefreshWarning = isError && hasItems;
  const visibleItems = hiddenItemId ? items.filter((i) => i.id !== hiddenItemId) : items;
  const currentItem = visibleItems[0];

  function handleApprove(itemId: string, selectedOptionId?: "A" | "B" | "C"): void {
    setHiddenItemId(itemId);
    showToast({
      message: "Approving",
      durationMs: UNDO_DURATION_MS,
      onUndo: () => setHiddenItemId(null),
      onTimeout: () => {
        approveMutation.mutate({ itemId, selectedOptionId });
        setHiddenItemId(null);
      },
    });
  }

  function handleReject(itemId: string, rejectReason: string): void {
    setHiddenItemId(itemId);
    showToast({
      message: "Rejected",
      durationMs: UNDO_DURATION_MS,
      onUndo: () => setHiddenItemId(null),
      onTimeout: () => {
        rejectMutation.mutate({ itemId, rejectReason });
        setHiddenItemId(null);
      },
    });
  }

  if (!hasItems && isLoading) {
    return (
      <div className={PANEL_CLASS_NAME} role="tabpanel">
        {isScanningPaused ? (
          <ScanningPausedBanner
            isResuming={startProjectMutation.isPending}
            onResume={() => startProjectMutation.mutate(selectedRoot)}
          />
        ) : null}
        <div className="py-3 text-[17px] text-zinc-500 dark:text-zinc-400">Loading...</div>
      </div>
    );
  }

  if (!hasItems && isError && error) {
    return (
      <div className={PANEL_CLASS_NAME} role="tabpanel">
        {isScanningPaused ? (
          <ScanningPausedBanner
            isResuming={startProjectMutation.isPending}
            onResume={() => startProjectMutation.mutate(selectedRoot)}
          />
        ) : null}
        <div className={EMPTY_SHELL_CLASS_NAME}>
          <ErrorState title="Could not load data" message={getRuntimeErrorMessage(error)} />
        </div>
      </div>
    );
  }

  if (visibleItems.length === 0 || !currentItem) {
    return (
      <div className={PANEL_CLASS_NAME} role="tabpanel">
        {isScanningPaused ? (
          <ScanningPausedBanner
            isResuming={startProjectMutation.isPending}
            onResume={() => startProjectMutation.mutate(selectedRoot)}
          />
        ) : null}
        <div className={EMPTY_SHELL_CLASS_NAME}>
          <MessageState icon={<SearchIcon />} title={EMPTY_TITLE} description={EMPTY_DESC} />
        </div>
      </div>
    );
  }

  const item = currentItem;
  const options = item.decision.options;

  const detailInput = {
    id: item.id,
    title: item.problem.title,
    displayType: getDisplayType(item),
    humanSummary: item.problem.humanSummary,
    humanCurrentBehavior: item.problem.humanCurrentBehavior,
    humanWhyItMatters: item.problem.humanWhyItMatters,
    humanEvidence: item.problem.humanEvidence,
    humanDecisionQuestion: item.problem.humanDecisionQuestion,
    options: options.map((o) => ({
      id: o.id,
      humanSummary: o.humanSummary,
      humanChooseThisIf: o.humanChooseThisIf,
      humanTradeoff: o.humanTradeoff,
    })),
    selectedOptionId: item.decision.selectedOptionId,
  };
  const implementCb = (selectedOptionId: "A" | "B" | "C" | undefined) =>
    handleApprove(item.id, selectedOptionId);
  const rejectCb = (rejectReason: string) => handleReject(item.id, rejectReason);

  return (
    <div className={PANEL_CLASS_NAME} role="tabpanel">
      {isScanningPaused ? (
        <ScanningPausedBanner
          isResuming={startProjectMutation.isPending}
          onResume={() => startProjectMutation.mutate(selectedRoot)}
        />
      ) : null}
      {showRefreshWarning ? (
        <div className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          Couldn&apos;t refresh. Showing last known data.
        </div>
      ) : null}
      <div className="rounded-3xl border border-zinc-200 bg-white p-8 shadow-card-overlay dark:border-zinc-800 dark:bg-zinc-900 sm:p-10">
        <FindingDetailView input={detailInput} onApprove={implementCb} onReject={rejectCb} />
      </div>
    </div>
  );
}
