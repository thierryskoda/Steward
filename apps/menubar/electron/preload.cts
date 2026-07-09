import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ctoBridge", {
  getInboxFindings: (projectRoot: string, requestId?: string) =>
    ipcRenderer.invoke("inbox_findings_get", projectRoot, requestId),
  getInboxRules: (projectRoot: string, requestId?: string) =>
    ipcRenderer.invoke("inbox_rules_get", projectRoot, requestId),
  getCtoItems: (projectRoot: string, requestId?: string) =>
    ipcRenderer.invoke("cto_items_get", projectRoot, requestId),
  approveRule: (projectRoot: string, args: { ruleId: string; requestId?: string }) =>
    ipcRenderer.invoke("rules_approve", projectRoot, args),
  rejectRule: (projectRoot: string, args: { ruleId: string; requestId?: string }) =>
    ipcRenderer.invoke("rules_reject", projectRoot, args),
  approveFinding: (
    projectRoot: string,
    args: {
      itemId: string;
      selectedOptionId?: "A" | "B" | "C";
      requestId?: string;
    }
  ) => ipcRenderer.invoke("findings_approve", projectRoot, args),
  rejectFinding: (
    projectRoot: string,
    args: { itemId: string; rejectReason: string; requestId?: string }
  ) => ipcRenderer.invoke("findings_reject", projectRoot, args),
  undoFinding: (projectRoot: string, args: { itemId: string; requestId?: string }) =>
    ipcRenderer.invoke("findings_undo", projectRoot, args),
  reportStatusError: (message: string) => ipcRenderer.invoke("report_status_error", message),
  writeUiLog: (args: {
    level: string;
    component: string;
    message: string;
    error: string | null;
    metadata: Record<string, unknown> | null;
  }) => ipcRenderer.invoke("write_ui_log", args),
  getLogsDir: () => ipcRenderer.invoke("get_logs_dir"),
  openLogsDirectory: () => ipcRenderer.invoke("open_logs_directory"),
  getConnectionConfig: () => ipcRenderer.invoke("get_connection_config"),
  getRuntimeStatus: (projectRoot: string) => ipcRenderer.invoke("get_runtime_status", projectRoot),
  getScanningStatus: (projectRoot: string, requestId?: string) =>
    ipcRenderer.invoke("get_scanning_status", projectRoot, requestId),
  getRulesSnapshot: (projectRoot: string, requestId?: string) =>
    ipcRenderer.invoke("get_rules_snapshot", projectRoot, requestId),
  getConfig: (projectRoot: string, requestId?: string) =>
    ipcRenderer.invoke("get_config", projectRoot, requestId),
  updateConfig: (projectRoot: string, body: unknown, requestId?: string) =>
    ipcRenderer.invoke("update_config", projectRoot, body, requestId),
  initializeProjectConfig: (projectRoot: string, body: unknown) =>
    ipcRenderer.invoke("initialize_project_config", projectRoot, body),
  listProjects: () => ipcRenderer.invoke("list_projects"),
  getSelectedProject: () => ipcRenderer.invoke("get_selected_project"),
  setSelectedProject: (projectRoot: string | null) =>
    ipcRenderer.invoke("set_selected_project", projectRoot),
  addProject: (projectRoot: string) => ipcRenderer.invoke("add_project", projectRoot),
  removeProject: (projectRoot: string) => ipcRenderer.invoke("remove_project", projectRoot),
  startProject: (projectRoot: string) => ipcRenderer.invoke("start_project", projectRoot),
  stopProject: (projectRoot: string) => ipcRenderer.invoke("stop_project", projectRoot),
  getCliProvider: (projectRoot: string) => ipcRenderer.invoke("get_cli_provider", projectRoot),
  setCliProvider: (projectRoot: string, provider: string) =>
    ipcRenderer.invoke("set_cli_provider", projectRoot, provider),
  openFolderDialog: () => ipcRenderer.invoke("open_folder_dialog"),
  isSuggestionsWindow: () => true,
});
