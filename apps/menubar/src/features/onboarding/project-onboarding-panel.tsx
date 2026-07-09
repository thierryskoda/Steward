/**
 * Minimal onboarding when no project is selected: add/select folder and start.
 */
import { useState } from "react";
import { CheckCircle2, Folder, FolderPlus, Play } from "lucide-react";
import {
  useListProjectsQuery,
  useSetSelectedProjectMutation,
  useAddProjectMutation,
  useStartProjectMutation,
} from "../settings/settings.queries.js";
import { openFolderDialog } from "../../runtime/bridge.js";
import { useNavigationStore } from "../../state/navigation.store.js";
import { Button } from "../../ui/primitives/button.js";
import { cn } from "../../ui/primitives/cn.js";

export function ProjectOnboardingPanel(): JSX.Element {
  const { data: projects = [] } = useListProjectsQuery();
  const setSelectedMutation = useSetSelectedProjectMutation();
  const addProjectMutation = useAddProjectMutation();
  const startProjectMutation = useStartProjectMutation();
  const setActiveTab = useNavigationStore((s) => s.setActiveTab);

  const [pickedRoot, setPickedRoot] = useState<string | null>(null);
  const defaultPickedRoot = projects.length === 1 ? (projects[0]?.projectRoot ?? null) : null;
  const effectivePickedRoot = pickedRoot ?? defaultPickedRoot;

  async function handleAddAndStart(): Promise<void> {
    const path = await openFolderDialog();
    if (!path) return;
    try {
      await addProjectMutation.mutateAsync(path);
      await setSelectedMutation.mutateAsync(path);
      setActiveTab("kanban");
    } catch {
      // Mutations report errors via query client
    }
  }

  async function handleStartSelected(): Promise<void> {
    if (!effectivePickedRoot) return;
    try {
      await setSelectedMutation.mutateAsync(effectivePickedRoot);
      await startProjectMutation.mutateAsync(effectivePickedRoot);
      setActiveTab("kanban");
    } catch {
      // Mutations report errors via query client
    }
  }

  const hasProjects = projects.length > 0;
  const canStartSelected = hasProjects && effectivePickedRoot !== null;

  return (
    <main
      className="flex min-h-screen w-full flex-col items-center justify-center bg-[#F9FAFB] px-6 py-12 dark:bg-zinc-950"
      id="suggestions-panel"
      role="main"
    >
      {!hasProjects ? (
        <div className="flex w-full max-w-lg flex-col items-center text-center">
          <div className="mb-6 rounded-full border border-zinc-100 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <FolderPlus className="h-12 w-12 text-zinc-400" />
          </div>
          <h2 className="mb-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Get started
          </h2>
          <p className="mb-8 max-w-md text-zinc-500 dark:text-zinc-400">
            Add a project folder to start analyzing your codebase and managing suggestions.
          </p>
          <Button
            size="lg"
            className="rounded-full shadow-sm"
            disabled={addProjectMutation.isPending}
            onClick={() => void handleAddAndStart()}
          >
            <FolderPlus className="mr-2 h-5 w-5" />
            {addProjectMutation.isPending ? "Adding…" : "Add project folder"}
          </Button>
        </div>
      ) : (
        <div className="flex w-full max-w-md flex-col items-center text-center">
          <div className="mb-6 rounded-full border border-zinc-100 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <Play className="ml-1 h-12 w-12 text-zinc-400" />
          </div>
          <h2 className="mb-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Select a project
          </h2>
          <p className="mb-8 max-w-md text-zinc-500 dark:text-zinc-400">
            Choose a project to initialize the runtime and begin analysis.
          </p>
          <div className="flex w-full flex-col gap-6">
            <div className="grid gap-3">
              {projects.map((proj) => {
                const name = proj.projectRoot.split("/").pop() ?? proj.projectRoot;
                const selected = effectivePickedRoot === proj.projectRoot;
                return (
                  <button
                    key={proj.projectKey}
                    type="button"
                    onClick={() => setPickedRoot(proj.projectRoot)}
                    className={cn(
                      "flex items-center gap-4 rounded-2xl border p-4 text-left transition-all",
                      selected
                        ? "border-zinc-900 bg-white shadow-md ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-900 dark:ring-zinc-100"
                        : "border-zinc-200 bg-white/50 shadow-sm hover:border-zinc-300 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:border-zinc-600"
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-full transition-colors",
                        selected
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      )}
                    >
                      <Folder className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3
                        className={cn(
                          "truncate font-medium",
                          selected
                            ? "text-zinc-900 dark:text-zinc-50"
                            : "text-zinc-700 dark:text-zinc-300"
                        )}
                      >
                        {name}
                      </h3>
                      <p className="mt-0.5 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {proj.projectRoot}
                      </p>
                    </div>
                    {selected ? (
                      <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-zinc-900 dark:text-zinc-100" />
                    ) : null}
                  </button>
                );
              })}
            </div>
            <Button
              size="lg"
              className="w-full rounded-full shadow-sm"
              disabled={
                !canStartSelected || startProjectMutation.isPending || setSelectedMutation.isPending
              }
              onClick={() => void handleStartSelected()}
            >
              {startProjectMutation.isPending || setSelectedMutation.isPending
                ? "Starting…"
                : "Start"}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
