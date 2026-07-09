import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, shell } from "electron";
import type {
  IAgentCliProvider,
  IInitializeConfigBody,
  IUpdateConfigBody,
} from "@steward/contracts/schemas";
import { getConnection } from "./runtime-service.js";
import * as gateway from "./runtime-gateway.js";
import { isRuntimeGatewayError, toSerializableGatewayError } from "./runtime-gateway.js";
import { getLogsDir, writeHostLog, writeUiLog } from "./logs-service.js";
import { setStatusErrorOverride } from "./status-error-state.js";
import type { IHostController } from "./host-controller.js";
import type { IProjectRuntimeController } from "./project-runtime-controller.js";

const IPC_ERROR_PREFIX = "CTO_IPC_ERROR:";

type IIpcErrorShape = {
  kind?: string;
  code?: string;
  message?: string;
};

function toIpcErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error.trim();
  if (typeof error === "object" && error !== null) {
    const shape = error as IIpcErrorShape;
    const message = typeof shape.message === "string" ? shape.message.trim() : "";
    const kind = typeof shape.kind === "string" ? shape.kind.trim() : "";
    const code = typeof shape.code === "string" ? shape.code.trim() : "";
    if (code.length > 0 && message.length > 0) return `${code}: ${message}`;
    if (message.length > 0) return message;
    if (kind.length > 0) return `${kind} error`;
  }
  return "Unexpected IPC error.";
}

function registerIpcHandler<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, async (event, ...args: TArgs) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      const message = toIpcErrorMessage(error);
      writeHostLog("error", "ipc", `${channel} failed: ${message}`);
      if (isRuntimeGatewayError(error)) {
        const serial = toSerializableGatewayError(error);
        if (serial.details)
          writeHostLog("error", "ipc", `${channel} validation details: ${serial.details}`);
        throw new Error(IPC_ERROR_PREFIX + JSON.stringify(serial), { cause: error });
      }
      throw new Error(message, { cause: error });
    }
  });
}

export function registerIpcHandlers(args: {
  hostController: IHostController;
  projectRuntimeController: IProjectRuntimeController;
}): void {
  const { hostController, projectRuntimeController } = args;

  registerIpcHandler("list_projects", () => projectRuntimeController.listProjects());
  registerIpcHandler("get_selected_project", () => hostController.getSelectedProjectRoot());
  registerIpcHandler("set_selected_project", (_event, projectRoot: string | null) => {
    hostController.setSelectedProject(projectRoot);
  });
  registerIpcHandler("add_project", (_event, projectRoot: string) => {
    projectRuntimeController.addProject(projectRoot);
  });
  registerIpcHandler("remove_project", (_event, projectRoot: string) => {
    return projectRuntimeController.removeProject(projectRoot);
  });
  registerIpcHandler("start_project", (_event, projectRoot: string) =>
    projectRuntimeController.startProject(projectRoot)
  );
  registerIpcHandler("stop_project", (_event, projectRoot: string) =>
    projectRuntimeController.stopProject(projectRoot)
  );
  registerIpcHandler("get_cli_provider", (_event, projectRoot: string) =>
    projectRuntimeController.getProjectCliProvider(projectRoot)
  );
  registerIpcHandler(
    "set_cli_provider",
    (_event, projectRoot: string, provider: IAgentCliProvider) => {
      projectRuntimeController.setProjectCliProvider(projectRoot, provider);
    }
  );
  registerIpcHandler("open_folder_dialog", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Select project folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  registerIpcHandler("inbox_findings_get", (_event, projectRoot: string, requestId?: string) => {
    const conn = getConnection(projectRoot);
    if (!conn) return Promise.resolve([]);
    return gateway.getInboxFindings(conn, requestId);
  });
  registerIpcHandler("inbox_rules_get", (_event, projectRoot: string, requestId?: string) => {
    const conn = getConnection(projectRoot);
    if (!conn) return Promise.resolve([]);
    return gateway.getInboxRules(conn, requestId);
  });
  registerIpcHandler("cto_items_get", (_event, projectRoot: string, requestId?: string) => {
    const conn = getConnection(projectRoot);
    if (!conn) return Promise.resolve([]);
    return gateway.getCtoItems(conn, requestId);
  });

  registerIpcHandler(
    "rules_approve",
    (_event, projectRoot: string, ruleArgs: { ruleId: string; requestId?: string }) => {
      const conn = getConnection(projectRoot);
      if (!conn) throw new Error("No connection for project root: " + projectRoot);
      return gateway.approveRule(conn, ruleArgs);
    }
  );
  registerIpcHandler(
    "rules_reject",
    (_event, projectRoot: string, ruleArgs: { ruleId: string; requestId?: string }) => {
      const conn = getConnection(projectRoot);
      if (!conn) throw new Error("No connection for project root: " + projectRoot);
      return gateway.rejectRule(conn, ruleArgs);
    }
  );
  registerIpcHandler(
    "findings_approve",
    (
      _event,
      projectRoot: string,
      findingArgs: {
        itemId: string;
        selectedOptionId?: "A" | "B" | "C";
        requestId?: string;
      }
    ) => {
      const conn = getConnection(projectRoot);
      if (!conn) throw new Error("No connection for project root: " + projectRoot);
      return gateway.approveFinding(conn, findingArgs);
    }
  );
  registerIpcHandler(
    "findings_reject",
    (
      _event,
      projectRoot: string,
      findingArgs: { itemId: string; rejectReason: string; requestId?: string }
    ) => {
      const conn = getConnection(projectRoot);
      if (!conn) throw new Error("No connection for project root: " + projectRoot);
      return gateway.rejectFinding(conn, {
        itemId: findingArgs.itemId,
        rejectReason: findingArgs.rejectReason ?? "",
        requestId: findingArgs.requestId,
      });
    }
  );
  registerIpcHandler(
    "findings_undo",
    (_event, projectRoot: string, findingArgs: { itemId: string; requestId?: string }) => {
      const conn = getConnection(projectRoot);
      if (!conn) throw new Error("No connection for project root: " + projectRoot);
      return gateway.undoFinding(conn, findingArgs);
    }
  );
  registerIpcHandler("report_status_error", (_event, message: string) => {
    setStatusErrorOverride(message ?? "");
  });

  registerIpcHandler(
    "write_ui_log",
    (
      _event,
      logArgs: {
        level: string;
        component: string;
        message: string;
        error?: string | null;
        metadata?: Record<string, unknown> | null;
      }
    ) => {
      writeUiLog({
        level: logArgs.level,
        component: logArgs.component,
        message: logArgs.message,
        error: logArgs.error ?? null,
        metadata: logArgs.metadata ?? null,
      });
    }
  );

  registerIpcHandler("get_logs_dir", () => getLogsDir());
  registerIpcHandler("open_logs_directory", () => {
    void shell.openPath(getLogsDir());
  });
  registerIpcHandler("get_connection_config", () => {
    const conn = hostController.getConnectionForSelected();
    if (!conn) return null;
    return { baseUrl: conn.baseUrl };
  });
  registerIpcHandler("get_runtime_status", (_event, projectRoot: string) => {
    const conn = getConnection(projectRoot);
    return conn ? gateway.getRuntimeStatus(conn) : Promise.resolve(null);
  });
  registerIpcHandler("get_scanning_status", (_event, projectRoot: string, requestId?: string) => {
    const conn = getConnection(projectRoot);
    if (!conn) return null;
    return gateway.getScanningStatus(conn, requestId);
  });
  registerIpcHandler("get_rules_snapshot", (_event, projectRoot: string, requestId?: string) => {
    const conn = getConnection(projectRoot);
    if (!conn) throw new Error("No connection for project root: " + projectRoot);
    return gateway.getRulesSnapshot(conn, requestId);
  });
  registerIpcHandler("get_config", (_event, projectRoot: string, requestId?: string) => {
    const conn = getConnection(projectRoot);
    if (!conn) return null;
    return gateway.getConfig(conn, requestId);
  });
  registerIpcHandler(
    "update_config",
    (_event, projectRoot: string, body: IUpdateConfigBody, requestId?: string) => {
      const conn = getConnection(projectRoot);
      if (!conn) throw new Error("No connection for project root: " + projectRoot);
      return gateway.updateConfig(conn, body, requestId);
    }
  );
  registerIpcHandler(
    "initialize_project_config",
    (_event, projectRoot: string, body: IInitializeConfigBody) => {
      const conn = getConnection(projectRoot);
      if (!conn) throw new Error("No connection for project root: " + projectRoot);
      return gateway.initializeProjectConfig(conn, body);
    }
  );
}
