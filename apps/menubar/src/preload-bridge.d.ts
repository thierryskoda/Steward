import type {
  IAgentCliProvider,
  ICtoItem,
  IConfigResponse,
  IRuntimeStatusResponse,
  IInboxFindingItem,
  IInitializeConfigBody,
  IInboxRuleItem,
  IRulesSnapshotResponse,
  IUpdateConfigBody,
} from "@steward/contracts/schemas";

export type IProjectWithStatus = {
  projectRoot: string;
  projectKey: string;
  status: "running" | "stopped";
  pid?: number;
  endpoint?: { host: string; port: number };
};

export type ICtoBridge = {
  getInboxFindings: (projectRoot: string, requestId?: string) => Promise<IInboxFindingItem[]>;
  getInboxRules: (projectRoot: string, requestId?: string) => Promise<IInboxRuleItem[]>;
  getCtoItems: (projectRoot: string, requestId?: string) => Promise<ICtoItem[]>;
  approveRule: (projectRoot: string, args: { ruleId: string; requestId?: string }) => Promise<void>;
  rejectRule: (projectRoot: string, args: { ruleId: string; requestId?: string }) => Promise<void>;
  approveFinding: (
    projectRoot: string,
    args: {
      itemId: string;
      selectedOptionId?: "A" | "B" | "C";
      requestId?: string;
    }
  ) => Promise<void>;
  rejectFinding: (
    projectRoot: string,
    args: {
      itemId: string;
      rejectReason: string;
      requestId?: string;
    }
  ) => Promise<void>;
  undoFinding: (projectRoot: string, args: { itemId: string; requestId?: string }) => Promise<void>;
  reportStatusError: (message: string) => Promise<void>;
  writeUiLog: (args: {
    level: string;
    component: string;
    message: string;
    error: string | null;
    metadata: Record<string, unknown> | null;
  }) => Promise<void>;
  getLogsDir: () => Promise<string>;
  openLogsDirectory: () => Promise<void>;
  getConnectionConfig: () => Promise<{ baseUrl: string } | null>;
  getRuntimeStatus: (projectRoot: string) => Promise<IRuntimeStatusResponse | null>;
  getScanningStatus: (
    projectRoot: string,
    requestId?: string
  ) => Promise<import("@steward/contracts/schemas").IScanningStatusResponse | null>;
  getRulesSnapshot: (projectRoot: string, requestId?: string) => Promise<IRulesSnapshotResponse>;
  getConfig: (projectRoot: string, requestId?: string) => Promise<IConfigResponse | null>;
  updateConfig: (
    projectRoot: string,
    body: IUpdateConfigBody,
    requestId?: string
  ) => Promise<IConfigResponse>;
  initializeProjectConfig: (
    projectRoot: string,
    body: IInitializeConfigBody
  ) => Promise<IConfigResponse>;
  listProjects: () => Promise<IProjectWithStatus[]>;
  getSelectedProject: () => Promise<string | null>;
  setSelectedProject: (projectRoot: string | null) => Promise<void>;
  addProject: (projectRoot: string) => Promise<void>;
  removeProject: (projectRoot: string) => Promise<void>;
  startProject: (projectRoot: string) => Promise<void>;
  stopProject: (projectRoot: string) => Promise<void>;
  getCliProvider: (projectRoot: string) => Promise<IAgentCliProvider>;
  setCliProvider: (projectRoot: string, provider: IAgentCliProvider) => Promise<void>;
  openFolderDialog: () => Promise<string | null>;
  isSuggestionsWindow: () => boolean;
};

declare global {
  interface Window {
    ctoBridge?: ICtoBridge;
  }
}
