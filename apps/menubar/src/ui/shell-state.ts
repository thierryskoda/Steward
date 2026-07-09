/**
 * Shell state for app layout: onboarding vs selected-project lifecycle (starting, ready, error).
 * Derived from query data: projects count, selected root, runtime status.
 */
import type { IRuntimeStatusResponse } from "@steward/contracts/schemas";

export type ShellState =
  | "noProjects"
  | "noSelection"
  | "starting"
  | "needsConfig"
  | "ready"
  | "startupError"
  | "stopped";

export function getShellState(
  projectsCount: number,
  selectedRoot: string | null | undefined,
  runtimeStatus: IRuntimeStatusResponse | null | undefined,
  isRuntimeStatusLoading: boolean,
  isStarting: boolean,
  selectedProjectStatus?: "running" | "stopped"
): ShellState {
  if (projectsCount === 0) return "noProjects";
  if (selectedRoot == null || selectedRoot === "") return "noSelection";
  if (isStarting || isRuntimeStatusLoading) return "starting";
  if (runtimeStatus?.state === "error") return "startupError";
  if (runtimeStatus?.state === "needs-config") return "needsConfig";
  if (runtimeStatus?.state === "running") return "ready";
  if (selectedProjectStatus === "stopped") return "stopped";
  return "starting";
}
