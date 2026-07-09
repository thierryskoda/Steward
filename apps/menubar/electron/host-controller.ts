import * as gateway from "./runtime-gateway.js";
import { getConnection, type IConnection, type IRuntimeStatus } from "./runtime-service.js";
import { pruneStaleRegistryEntries } from "./registry.js";
import { formatErrorForLog, writeHostLog } from "./logs-service.js";
import type { IProjectRuntimeController } from "./project-runtime-controller.js";
import { getStatusErrorOverrideLabel } from "./status-error-state.js";

export type IHostProjectState =
  | { status: "no-selection" }
  | { status: "stopped"; projectRoot: string }
  | { status: "starting"; projectRoot: string; startedAt: number }
  | { status: "needs-config"; projectRoot: string }
  | { status: "running"; projectRoot: string }
  | { status: "stopping"; projectRoot: string }
  | { status: "error"; projectRoot: string; message: string };

export type IHostController = {
  loadSelectedProject(): void;
  getSelectedProjectRoot(): string | null;
  setSelectedProject(projectRoot: string | null): void;
  getConnectionForSelected(): IConnection | null;
  startStatusPolling(onStatusLabel: (label: string) => void): ReturnType<typeof setInterval>;
};

function formatRuntimeStatusLabel(status: IRuntimeStatus): string {
  if (status.lastError) {
    const reason = status.lastError.trim().replace(/\s+/g, " ");
    if (reason.length > 0) {
      const truncated = reason.length > 72 ? `${reason.slice(0, 72)}...` : reason;
      return `Status: error (${truncated})`;
    }
  }
  const pidStr = status.pid > 0 ? String(status.pid) : "-";
  return `Status: ${status.state} (pid ${pidStr})`;
}

export function createHostController(args: {
  projectRuntimeController: IProjectRuntimeController;
}): IHostController {
  let selectedProjectRoot: string | null = null;

  function loadSelectedProject(): void {
    selectedProjectRoot = args.projectRuntimeController.getSelectedProject();
  }

  function getSelectedProjectRoot(): string | null {
    return selectedProjectRoot;
  }

  function setSelectedProject(projectRoot: string | null): void {
    args.projectRuntimeController.selectProject(projectRoot);
    selectedProjectRoot = projectRoot;
  }

  function getConnectionForSelected(): IConnection | null {
    pruneStaleRegistryEntries();
    if (selectedProjectRoot) return getConnection(selectedProjectRoot);
    return null;
  }

  function startStatusPolling(
    onStatusLabel: (label: string) => void
  ): ReturnType<typeof setInterval> {
    return setInterval(() => {
      const override = getStatusErrorOverrideLabel();
      if (override) {
        onStatusLabel(override);
        return;
      }
      const conn = getConnectionForSelected();
      if (!conn) {
        onStatusLabel("Status: stopped");
        return;
      }
      gateway
        .getRuntimeStatus(conn)
        .then((status) => {
          onStatusLabel(status ? formatRuntimeStatusLabel(status) : "Status: stopped");
        })
        .catch((error) => {
          writeHostLog(
            "error",
            "status_poll",
            `operation=getRuntimeStatus error=${formatErrorForLog(error)}`
          );
          onStatusLabel("Status: unreachable");
        });
    }, 2000);
  }

  return {
    loadSelectedProject,
    getSelectedProjectRoot,
    setSelectedProject,
    getConnectionForSelected,
    startStatusPolling,
  };
}
