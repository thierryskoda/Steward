import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Inbox, KanbanSquare, ScrollText, Settings } from "lucide-react";
import { motion } from "motion/react";
import {
  useListProjectsQuery,
  useSelectedProjectQuery,
  useRuntimeStatusQuery,
  useStartProjectMutation,
  useScanningStatusQuery,
} from "../features/settings/settings.queries.js";
import { useInboxFindingsCountQuery } from "../features/categories/categories.queries.js";
import { useInboxRulesCountQuery } from "../features/rules/rules.queries.js";
import { queryKeys } from "../utils/query-keys.js";
import { useNavigationStore } from "../state/navigation.store.js";
import type { TabId } from "../types/types.js";
import { CategoriesPanel } from "../features/categories/categories-panel.js";
import { KanbanPanel } from "../features/kanban/kanban-panel.js";
import { RulesPanel } from "../features/rules/rules-panel.js";
import { SettingsPanel } from "../features/settings/settings-panel.js";
import { ProjectOnboardingPanel } from "../features/onboarding/project-onboarding-panel.js";
import { ConfigOnboardingPanel } from "../features/onboarding/config-onboarding-panel.js";
import { ErrorState } from "./error-state.js";
import { MessageState } from "./message-state.js";
import { LoadingIcon } from "./message-state-icons.js";
import { getShellState } from "./shell-state.js";
import { cn } from "./primitives/cn.js";

const TAB_CONFIG: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "categories", label: "Categories", icon: Inbox },
  { id: "rules", label: "Rules", icon: ScrollText },
  { id: "kanban", label: "Kanban", icon: KanbanSquare },
  { id: "settings", label: "Settings", icon: Settings },
];

export function AppLayout(): JSX.Element {
  const activeTab = useNavigationStore((s) => s.activeTab);
  const setActiveTab = useNavigationStore((s) => s.setActiveTab);
  const queryClient = useQueryClient();

  const { data: projects = [] } = useListProjectsQuery();
  const { data: selectedRoot } = useSelectedProjectQuery();
  const { data: runtimeStatus, isPending: isRuntimeStatusLoading } = useRuntimeStatusQuery({
    enabled: !!(selectedRoot != null && selectedRoot !== ""),
  });
  const { data: scanningStatus } = useScanningStatusQuery({
    enabled: !!(selectedRoot != null && selectedRoot !== ""),
  });

  const startProjectMutation = useStartProjectMutation();
  const autoStartedForRef = useRef<string | null>(null);

  const selectedProject = projects.find((p) => p.projectRoot === selectedRoot);
  const selectedProjectStatus = selectedProject?.status;

  const shellState = getShellState(
    projects.length,
    selectedRoot,
    runtimeStatus ?? null,
    isRuntimeStatusLoading,
    startProjectMutation.isPending,
    selectedProjectStatus
  );
  const isReady = shellState === "ready";
  const projectKey = selectedRoot ?? "__no-project__";
  const { data: findingsCount } = useInboxFindingsCountQuery({
    projectRoot: projectKey,
    enabled: isReady,
  });
  const { data: rulesCount } = useInboxRulesCountQuery({
    projectRoot: projectKey,
    enabled: isReady,
  });

  useEffect(() => {
    if (selectedRoot == null || selectedRoot === "") return;
    const isStopped = shellState === "stopped";
    const alreadyTried = autoStartedForRef.current === selectedRoot;

    if (isStopped && !alreadyTried) {
      autoStartedForRef.current = selectedRoot;
      startProjectMutation.mutate(selectedRoot);
    }
  }, [shellState, selectedRoot, startProjectMutation]);

  useEffect(() => {
    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all() });
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [queryClient]);

  if (shellState === "noProjects" || shellState === "noSelection") {
    return <ProjectOnboardingPanel />;
  }

  if (shellState === "starting") {
    return (
      <main
        className="flex min-h-screen w-full flex-col items-center justify-center bg-[#F9FAFB] px-6 py-12 dark:bg-zinc-950"
        id="suggestions-panel"
      >
        <MessageState
          icon={<LoadingIcon />}
          title="Starting runtime…"
          description="This may take a few seconds."
        />
      </main>
    );
  }

  if (shellState === "startupError") {
    const message = runtimeStatus?.lastError?.trim() ?? "Project runtime startup failed.";
    return (
      <main
        className="flex min-h-screen w-full flex-col items-center justify-center bg-[#F9FAFB] px-6 py-12 dark:bg-zinc-950"
        id="suggestions-panel"
      >
        <ErrorState title="Startup failed" message={message} />
      </main>
    );
  }

  if (shellState === "needsConfig") {
    return <ConfigOnboardingPanel />;
  }

  const showRunning = runtimeStatus?.state === "running";
  const isPaused = scanningStatus?.status === "paused";

  return (
    <main
      className="relative flex min-h-screen w-full flex-col items-stretch bg-[#F9FAFB] dark:bg-zinc-950"
      id="suggestions-panel"
    >
      {showRunning ? (
        <div className="fixed left-6 top-6 z-50">
          <div className="relative flex items-center justify-center overflow-hidden rounded-full p-[2px]">
            <span
              className={cn(
                "absolute inset-[-1000%] animate-[spin_3s_linear_infinite]",
                isPaused
                  ? "bg-[conic-gradient(from_90deg_at_50%_50%,#f59e0b_0%,transparent_30%,transparent_100%)]"
                  : "bg-[conic-gradient(from_90deg_at_50%_50%,#10b981_0%,transparent_30%,transparent_100%)]"
              )}
            />
            <div className="relative flex items-center gap-2 rounded-full bg-white px-4 py-1.5 shadow-sm dark:bg-zinc-900">
              <span className="relative flex h-2 w-2">
                <span
                  className={cn(
                    "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                    isPaused ? "bg-amber-400" : "bg-emerald-400"
                  )}
                />
                <span
                  className={cn(
                    "relative inline-flex h-2 w-2 rounded-full",
                    isPaused ? "bg-amber-500" : "bg-emerald-500"
                  )}
                />
              </span>
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                {isPaused ? "Scanning paused" : "Scanning active"}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <nav
        className="fixed left-1/2 top-6 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/70 p-1.5 shadow-lg shadow-zinc-200/50 ring-1 ring-zinc-200/50 backdrop-blur-xl dark:bg-zinc-900/70 dark:shadow-black/30 dark:ring-zinc-700/60"
        role="tablist"
        aria-label="Main"
      >
        {TAB_CONFIG.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          const count =
            id === "categories" ? findingsCount : id === "rules" ? rulesCount : undefined;
          return (
            <button
              key={id}
              type="button"
              className={cn(
                "relative flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "text-white dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100/50 dark:text-zinc-400 dark:hover:bg-zinc-800/80"
              )}
              data-tab={id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(id)}
            >
              {isActive ? (
                <motion.div
                  layoutId="active-tab"
                  className="absolute inset-0 rounded-full bg-zinc-900 shadow-md dark:bg-zinc-100"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              ) : null}
              <span className="relative z-10 flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0" />
                {label}
                {count !== undefined && count > 0 ? (
                  <span
                    className={cn(
                      "ml-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full text-[11px] transition-colors",
                      isActive
                        ? "bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900"
                        : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 pt-28">
        {activeTab === "categories" && <CategoriesPanel />}
        {activeTab === "rules" && <RulesPanel />}
        {activeTab === "kanban" && <KanbanPanel />}
        {activeTab === "settings" && <SettingsPanel />}
      </div>
    </main>
  );
}
