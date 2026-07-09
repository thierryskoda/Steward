import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { CheckCircle2, Clock, TerminalSquare, XCircle } from "lucide-react";
import type { ICtoItem } from "@steward/contracts/schemas";
import {
  useCtoItemsQuery,
  useKanbanApproveFindingMutation,
  useKanbanRejectFindingMutation,
  useKanbanUndoFindingMutation,
} from "./kanban.queries.js";
import { useKanbanUIStore } from "./kanban-ui.store.js";
import {
  useSelectedProjectQuery,
  useListProjectsQuery,
  useStartProjectMutation,
  useScanningStatusQuery,
} from "../settings/settings.queries.js";
import { useToastStore } from "../../ui/toast/toast.store.js";
import { ErrorState } from "../../ui/error-state.js";
import { FindingDetailView } from "../../ui/finding-detail-view.js";
import { getCategoryLabel, getStatusLabel } from "../../ui/labels.js";
import { MessageState } from "../../ui/message-state.js";
import { SearchIcon } from "../../ui/message-state-icons.js";
import { getRuntimeErrorMessage } from "../../ui/errors.js";
import { Badge } from "../../ui/primitives/badge.js";
import { Button } from "../../ui/primitives/button.js";
import { Modal } from "../../ui/primitives/modal.js";
import { cn } from "../../ui/primitives/cn.js";
import { ScanningPausedBanner } from "../../ui/scanning-paused-banner.js";

const DISPLAY_COLUMNS = ["pending", "implementing", "implemented", "failed"] as const;
type IDisplayColumn = (typeof DISPLAY_COLUMNS)[number];

const STATUS_TO_DISPLAY_COLUMN: Record<string, IDisplayColumn> = {
  "needs-review": "pending",
  "learning-from-rejection": "pending",
  approved: "pending",
  claimed: "implementing",
  "agent-running": "implementing",
  implemented: "implemented",
  failed: "failed",
  rejected: "failed",
};

function statusToDisplayColumn(itemStatus: string): IDisplayColumn {
  const mapped = STATUS_TO_DISPLAY_COLUMN[itemStatus];
  if (mapped === undefined) {
    console.error({
      feature: "kanban",
      code: "UNKNOWN_STEWARD_ITEM_STATUS",
      itemStatus,
    });
    throw new Error(`Unknown Steward item status for kanban column mapping: ${itemStatus}`);
  }
  return mapped;
}

const COLUMN_META: Record<IDisplayColumn, { icon: LucideIcon; bodyClass: string }> = {
  pending: {
    icon: Clock,
    bodyClass: "bg-zinc-100/90 dark:bg-zinc-900/50",
  },
  implementing: {
    icon: TerminalSquare,
    bodyClass: "bg-blue-50/90 dark:bg-blue-950/30",
  },
  implemented: {
    icon: CheckCircle2,
    bodyClass: "bg-emerald-50/90 dark:bg-emerald-950/25",
  },
  failed: {
    icon: XCircle,
    bodyClass: "bg-red-50/90 dark:bg-red-950/25",
  },
};

function formatAge(createdAt: number): string {
  const ms = Date.now() - createdAt;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor(ms / 60000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "now";
}

function getItemCategoryId(item: ICtoItem): string {
  return "categoryId" in item ? (item as { categoryId: string }).categoryId : item.type;
}

const BOARD_EMPTY_TITLE = "Analyzing your codebase";
const BOARD_EMPTY_DESC =
  "AI agents are scanning your project for improvements in code quality, security, architecture, and docs. Suggestions will appear here as they're found.";
const UNDO_DURATION_MS = 5000;
const PANEL_CLASS_NAME =
  "mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col px-4 pb-28 pt-8";
const EMPTY_SHELL_CLASS_NAME =
  "flex min-h-0 flex-1 flex-col items-center justify-center px-0 py-8 text-center";

export function KanbanPanel(): JSX.Element {
  const selectedRoot = useSelectedProjectQuery().data;
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
  } = useCtoItemsQuery({
    projectRoot: selectedRoot ?? "__no-project__",
    enabled: hasSelectedRoot && !isProcessStopped,
  });

  const approveMutation = useKanbanApproveFindingMutation();
  const rejectMutation = useKanbanRejectFindingMutation();
  const undoMutation = useKanbanUndoFindingMutation();
  const selectedItemId = useKanbanUIStore((s) => s.selectedItemId);
  const selectedCategoryIds = useKanbanUIStore((s) => s.selectedCategoryIds);
  const setSelectedItemId = useKanbanUIStore((s) => s.setSelectedItemId);
  const setSelectedCategoryIds = useKanbanUIStore((s) => s.setSelectedCategoryIds);
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
            description="Start the project runtime to view the kanban board and track implementations."
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

  const effectiveSelectedItemId = selectedItemId;

  const categoryIds = Array.from(new Set(items.map((i) => getItemCategoryId(i)))).sort();
  const filteredItems =
    selectedCategoryIds === null
      ? items
      : items.filter((i) => selectedCategoryIds.includes(getItemCategoryId(i)));
  const hasItems = items.length > 0;
  const showRefreshWarning = isError && hasItems;

  function handleApprove(itemId: string, selectedOptionId?: "A" | "B" | "C"): void {
    showToast({
      message: "Approving",
      durationMs: UNDO_DURATION_MS,
      onUndo: () => {},
      onTimeout: () => {
        approveMutation.mutate({ itemId, selectedOptionId });
        setSelectedItemId(null);
      },
    });
  }

  function handleReject(itemId: string, rejectReason: string): void {
    showToast({
      message: "Rejected",
      durationMs: UNDO_DURATION_MS,
      onUndo: () => {},
      onTimeout: () => {
        rejectMutation.mutate({ itemId, rejectReason });
        setSelectedItemId(null);
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
        <div className="py-5">
          <ErrorState title="Could not load Kanban" message={getRuntimeErrorMessage(error)} />
        </div>
      </div>
    );
  }

  if (!hasItems) {
    return (
      <div className={PANEL_CLASS_NAME} role="tabpanel">
        {isScanningPaused ? (
          <ScanningPausedBanner
            isResuming={startProjectMutation.isPending}
            onResume={() => startProjectMutation.mutate(selectedRoot)}
          />
        ) : null}
        <div className={EMPTY_SHELL_CLASS_NAME}>
          <MessageState
            icon={<SearchIcon />}
            title={BOARD_EMPTY_TITLE}
            description={BOARD_EMPTY_DESC}
          />
        </div>
      </div>
    );
  }

  const selectedCount =
    selectedCategoryIds === null ? categoryIds.length : selectedCategoryIds.length;
  const selectedItem =
    effectiveSelectedItemId == null
      ? null
      : (items.find((item) => item.id === effectiveSelectedItemId) ?? null);

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
      <div className="px-6">
        <KanbanToolbar
          categoryIds={categoryIds}
          selectedCategoryIds={selectedCategoryIds}
          selectedCount={selectedCount}
          onFilterChange={setSelectedCategoryIds}
        />
      </div>
      <div className="relative w-full">
        <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-6 bg-gradient-to-r from-bg to-transparent" />
        <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-6 bg-gradient-to-l from-bg to-transparent" />
        <div className="w-full overflow-x-auto overflow-y-visible pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="w-max px-6">
            <div className="grid w-max grid-cols-[repeat(4,260px)] gap-x-8 gap-y-4">
              {DISPLAY_COLUMNS.map((column) => {
                const columnItems = filteredItems.filter(
                  (i) => statusToDisplayColumn(i.status) === column
                );
                const meta = COLUMN_META[column];
                const Icon = meta.icon;
                return (
                  <div key={column} className="flex min-w-[260px] flex-col">
                    <div className="mb-3 flex items-center gap-2">
                      <Icon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      <h4 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-zinc-600 dark:text-zinc-400">
                        {getStatusLabel(column)}
                      </h4>
                      <Badge variant="secondary" className="ml-auto text-[11px]">
                        {columnItems.length}
                      </Badge>
                    </div>
                    <div
                      className={cn(
                        "min-h-[200px] flex-1 rounded-xl border border-zinc-200/80 p-3 dark:border-zinc-800",
                        meta.bodyClass
                      )}
                    >
                      {columnItems.map((item) => (
                        <KanbanCard
                          key={item.id}
                          item={item}
                          isSelected={effectiveSelectedItemId === item.id}
                          onClick={() =>
                            setSelectedItemId(effectiveSelectedItemId === item.id ? null : item.id)
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {selectedItem ? (
        <KanbanDetailModal
          item={selectedItem}
          onClose={() => setSelectedItemId(null)}
          onApprove={(selectedOptionId) => handleApprove(selectedItem.id, selectedOptionId)}
          onReject={(rejectReason) => handleReject(selectedItem.id, rejectReason)}
          onUndo={() => {
            if (
              window.confirm(
                "Revert the AI implementation for this finding? This will run the undo agent."
              )
            ) {
              undoMutation.mutate({ itemId: selectedItem.id });
              setSelectedItemId(null);
            }
          }}
          undoMutation={undoMutation}
        />
      ) : null}
    </div>
  );
}

function KanbanToolbar(args: {
  categoryIds: string[];
  selectedCategoryIds: string[] | null;
  selectedCount: number;
  onFilterChange: (ids: string[] | null) => void;
}): JSX.Element {
  const [popoverOpen, setPopoverOpen] = useState(false);

  function getNextSelected(clickedId: string, checked: boolean): string[] | null {
    const selected =
      args.selectedCategoryIds === null
        ? new Set(args.categoryIds)
        : new Set(args.selectedCategoryIds);
    if (checked) selected.add(clickedId);
    else selected.delete(clickedId);
    if (selected.size === args.categoryIds.length) return null;
    return args.categoryIds.filter((id) => selected.has(id));
  }

  return (
    <div className="relative mb-4 flex items-center">
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-[14px] font-semibold text-zinc-700 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600"
        aria-expanded={popoverOpen}
        aria-haspopup="dialog"
        onClick={() => setPopoverOpen(!popoverOpen)}
      >
        <span>
          {args.selectedCategoryIds === null
            ? "Filter categories"
            : `Filter categories (${args.selectedCount})`}
        </span>
      </button>
      {popoverOpen ? (
        <div
          className="absolute left-0 top-[calc(100%+8px)] z-20 max-h-[320px] min-w-[280px] max-w-[360px] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-popover dark:border-zinc-700 dark:bg-zinc-900"
          role="dialog"
          aria-label="Kanban categories filter"
        >
          <div className="mb-2 text-[13px] font-semibold uppercase tracking-[0.05em] text-zinc-500 dark:text-zinc-400">
            Visible categories
          </div>
          <button
            type="button"
            className="mb-2 w-fit cursor-pointer bg-transparent p-0 text-left text-[14px] font-semibold text-indigo-600 underline underline-offset-2 hover:text-indigo-500 dark:text-indigo-400"
            onClick={() => {
              args.onFilterChange(null);
              setPopoverOpen(false);
            }}
          >
            Select all categories
          </button>
          {args.categoryIds.map((categoryId) => {
            const checked =
              args.selectedCategoryIds === null || args.selectedCategoryIds.includes(categoryId);
            return (
              <label
                key={categoryId}
                className="flex cursor-pointer items-center gap-2 py-1 text-[14px]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) =>
                    args.onFilterChange(getNextSelected(categoryId, e.target.checked))
                  }
                />
                <span>{getCategoryLabel(categoryId)}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function KanbanCard(args: {
  item: ICtoItem;
  isSelected: boolean;
  onClick: () => void;
}): JSX.Element {
  const displayType = getItemCategoryId(args.item);
  const baseClassName =
    "mb-3 min-w-0 cursor-pointer overflow-hidden rounded-xl border bg-white p-3 shadow-sm transition-all duration-150 last:mb-0 dark:bg-zinc-950/80";
  const selectedClassName = "border-indigo-500 ring-1 ring-indigo-500/30 dark:border-indigo-400";
  const defaultClassName =
    "border-zinc-200 hover:-translate-y-px hover:border-indigo-300 hover:shadow-md dark:border-zinc-700";

  return (
    <div
      className={cn(baseClassName, args.isSelected ? selectedClassName : defaultClassName)}
      role="button"
      tabIndex={0}
      onClick={args.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          args.onClick();
        }
      }}
    >
      <span className="mb-1 inline-block max-w-full truncate rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        {getCategoryLabel(displayType)}
      </span>
      <div className="line-clamp-2 text-[16px] font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
        {args.item.type === "finding" ? args.item.problem.title : args.item.title}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[12px] text-zinc-500 dark:text-zinc-400">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {formatAge(args.item.createdAt)}
        </span>
        <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          {args.item.type}
        </span>
        {args.item.type === "finding" &&
          args.item.status === "implemented" &&
          "hasBeenReverted" in args.item &&
          args.item.hasBeenReverted === true && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Reverted
            </span>
          )}
      </div>
    </div>
  );
}

function KanbanDetailModal(args: {
  item: ICtoItem;
  onClose: () => void;
  onApprove: (selectedOptionId: "A" | "B" | "C" | undefined) => void;
  onReject: (rejectReason: string) => void;
  onUndo: () => void;
  undoMutation: ReturnType<typeof useKanbanUndoFindingMutation>;
}): JSX.Element {
  const item = args.item;
  if (item.type !== "finding") {
    return (
      <Modal isOpen={true} title="Item details" onClose={args.onClose} size="lg">
        <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[13px] text-zinc-600 dark:text-zinc-400">
          {JSON.stringify(item, null, 2)}
        </pre>
      </Modal>
    );
  }

  const options = item.decision.options;
  const isImplemented = item.status === "implemented";
  const hasBeenReverted = "hasBeenReverted" in item && item.hasBeenReverted === true;
  const interactive = statusToDisplayColumn(item.status) === "pending";

  if (isImplemented) {
    return (
      <Modal
        isOpen={true}
        title={item.problem.title}
        onClose={args.onClose}
        size="md"
        footer={
          hasBeenReverted ? null : (
            <Button type="button" disabled={args.undoMutation.isPending} onClick={args.onUndo}>
              {args.undoMutation.isPending ? "Reverting…" : "Undo implementation"}
            </Button>
          )
        }
      >
        <span className="mb-3 inline-block rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.05em] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {getCategoryLabel(item.categoryId)}
        </span>
        {hasBeenReverted ? (
          <p className="m-0 rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 text-[15px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
            This implementation was reverted.
          </p>
        ) : (
          <p className="m-0 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            This finding has been implemented. Use Undo in the footer to revert AI changes.
          </p>
        )}
      </Modal>
    );
  }

  const detailInput = {
    id: item.id,
    title: item.problem.title,
    displayType: item.categoryId,
    showTitle: false,
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

  return (
    <Modal isOpen={true} title={item.problem.title} onClose={args.onClose} size="lg">
      <FindingDetailView
        input={detailInput}
        mode={interactive ? "interactive" : "readOnly"}
        enforceInboxFields={false}
        onApprove={interactive ? args.onApprove : (): void => {}}
        onReject={interactive ? args.onReject : (): void => {}}
      />
    </Modal>
  );
}
