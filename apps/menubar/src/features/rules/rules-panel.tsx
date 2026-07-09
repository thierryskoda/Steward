import { useState } from "react";
import {
  useInboxRulesQuery,
  useApproveRuleMutation,
  useRejectRuleMutation,
} from "./rules.queries.js";
import {
  useSelectedProjectQuery,
  useListProjectsQuery,
  useStartProjectMutation,
  useScanningStatusQuery,
} from "../settings/settings.queries.js";
import { useToastStore } from "../../ui/toast/toast.store.js";
import { ErrorState } from "../../ui/error-state.js";
import { MessageState } from "../../ui/message-state.js";
import { SearchIcon } from "../../ui/message-state-icons.js";
import { getRuntimeErrorMessage } from "../../ui/errors.js";
import { Badge } from "../../ui/primitives/badge.js";
import { Button } from "../../ui/primitives/button.js";
import { ScanningPausedBanner } from "../../ui/scanning-paused-banner.js";

const EMPTY_TITLE = "Analyzing your codebase";
const EMPTY_DESC =
  "AI agents are scanning your project for improvements. Rules suggestions will appear here.";
const UNDO_DURATION_MS = 5000;
const PANEL_CLASS_NAME = "mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-6 pb-28 pt-8";
const EMPTY_SHELL_CLASS_NAME =
  "flex min-h-0 flex-1 flex-col items-center justify-center px-0 py-8 text-center";

export function RulesPanel(): JSX.Element {
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
  } = useInboxRulesQuery({
    projectRoot: selectedRoot ?? "__no-project__",
    enabled: hasSelectedRoot && !isProcessStopped,
  });

  const approveMutation = useApproveRuleMutation();
  const rejectMutation = useRejectRuleMutation();
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
            description="Start the project runtime to analyze your codebase and view rules suggestions."
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

  function handleApprove(ruleId: string): void {
    setHiddenItemId(ruleId);
    showToast({
      message: "Approving",
      durationMs: UNDO_DURATION_MS,
      onUndo: () => setHiddenItemId(null),
      onTimeout: () => {
        approveMutation.mutate({ ruleId });
        setHiddenItemId(null);
      },
    });
  }

  function handleReject(ruleId: string): void {
    setHiddenItemId(ruleId);
    showToast({
      message: "Rejected",
      durationMs: UNDO_DURATION_MS,
      onUndo: () => setHiddenItemId(null),
      onTimeout: () => {
        rejectMutation.mutate({ ruleId });
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
        <div className="mb-8 space-y-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-6 dark:border-indigo-900/50 dark:bg-indigo-950/30">
          <Badge className="border-indigo-200 bg-indigo-100 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
            Rule suggestion
          </Badge>
          <h3 className="m-0 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {item.title}
          </h3>
          <p className="m-0 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            {item.rationale}
          </p>
        </div>

        <div className="relative mb-10 overflow-hidden rounded-2xl bg-[#0D0D12] shadow-inner">
          <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-pink-500" />
          <div className="p-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Rule text
            </p>
            <pre className="m-0 max-h-[min(50vh,420px)] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[14px] leading-relaxed text-zinc-100">
              {item.ruleText}
            </pre>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 border-t border-zinc-200/80 bg-white/90 py-4 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90">
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="ghost" type="button" onClick={() => handleReject(item.id)}>
              Reject
            </Button>
            <Button type="button" onClick={() => handleApprove(item.id)}>
              Implement
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
