import type { ICtoBridge, IProjectWithStatus } from "../preload-bridge.js";
import type {
  IAgentCliProvider,
  ICtoItem,
  IConfigResponse,
  IRuntimeStatusResponse,
  IScanningStatusResponse,
  IInboxFindingItem,
  IInitializeConfigBody,
  IInboxRuleItem,
  IRulesSnapshotResponse,
  IUpdateConfigBody,
} from "@steward/contracts/schemas";
import { normalizeIpcError } from "../utils/ipc-error.js";

export type { IProjectWithStatus };
import { createLogger } from "../utils/logging.js";

const STATUS_REPORT_DEBOUNCE_MS = 5000;
const STATUS_REPORT_MAX_LEN = 120;
const log = createLogger("runtime-bridge");

let lastStatusReport: { message: string; at: number } = { message: "", at: 0 };

function getBridge(): ICtoBridge {
  const bridge = window.ctoBridge;
  if (!bridge) {
    throw new Error("ctoBridge not available (not running in Electron)");
  }
  return bridge;
}

function normalizeStatusMessage(message: string): string {
  const normalized = message.trim().replace(/\s+/g, " ");
  if (normalized.length <= STATUS_REPORT_MAX_LEN) return normalized;
  return `${normalized.slice(0, STATUS_REPORT_MAX_LEN)}...`;
}

function buildTraceMetadata(args: {
  base?: Record<string, unknown>;
  startedAt: number;
}): Record<string, unknown> {
  return {
    ...(args.base ?? {}),
    durationMs: Date.now() - args.startedAt,
  };
}

async function runIpcOperation<T>(args: {
  operation: string;
  run: (requestId: string) => Promise<T>;
  metadata?: Record<string, unknown>;
}): Promise<T> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const baseMetadata = { ...(args.metadata ?? {}), requestId };
  log.trace({
    event: `ipc_${args.operation}`,
    phase: "start",
    metadata: baseMetadata,
  });
  try {
    const result = await args.run(requestId);
    log.trace({
      event: `ipc_${args.operation}`,
      phase: "success",
      metadata: buildTraceMetadata({ base: baseMetadata, startedAt }),
    });
    return result;
  } catch (error) {
    log.trace({
      event: `ipc_${args.operation}`,
      phase: "fail",
      error,
      metadata: buildTraceMetadata({ base: baseMetadata, startedAt }),
    });
    throw error;
  }
}

export async function getInboxFindings(projectRoot: string): Promise<IInboxFindingItem[]> {
  return runIpcOperation({
    operation: "inbox_findings_get",
    run: (requestId) =>
      getBridge().getInboxFindings(projectRoot, requestId).catch(normalizeIpcError),
  });
}

export async function getInboxRules(projectRoot: string): Promise<IInboxRuleItem[]> {
  return runIpcOperation({
    operation: "inbox_rules_get",
    run: (requestId) => getBridge().getInboxRules(projectRoot, requestId).catch(normalizeIpcError),
  });
}

export async function getCtoItems(projectRoot: string): Promise<ICtoItem[]> {
  return runIpcOperation({
    operation: "cto_items_get",
    run: (requestId) => getBridge().getCtoItems(projectRoot, requestId).catch(normalizeIpcError),
  });
}

export async function approveRule(projectRoot: string, args: { ruleId: string }): Promise<void> {
  return runIpcOperation({
    operation: "rules_approve",
    metadata: { ruleId: args.ruleId },
    run: (requestId) =>
      getBridge()
        .approveRule(projectRoot, { ...args, requestId })
        .catch(normalizeIpcError),
  });
}

export async function rejectRule(projectRoot: string, args: { ruleId: string }): Promise<void> {
  return runIpcOperation({
    operation: "rules_reject",
    metadata: { ruleId: args.ruleId },
    run: (requestId) =>
      getBridge()
        .rejectRule(projectRoot, { ...args, requestId })
        .catch(normalizeIpcError),
  });
}

export async function approveFinding(
  projectRoot: string,
  args: {
    itemId: string;
    selectedOptionId?: "A" | "B" | "C";
  }
): Promise<void> {
  return runIpcOperation({
    operation: "findings_approve",
    metadata: { itemId: args.itemId },
    run: (requestId) =>
      getBridge()
        .approveFinding(projectRoot, { ...args, requestId })
        .catch(normalizeIpcError),
  });
}

export async function rejectFinding(
  projectRoot: string,
  args: { itemId: string; rejectReason: string }
): Promise<void> {
  return runIpcOperation({
    operation: "findings_reject",
    metadata: { itemId: args.itemId },
    run: (requestId) =>
      getBridge()
        .rejectFinding(projectRoot, { ...args, requestId })
        .catch(normalizeIpcError),
  });
}

export async function undoFinding(projectRoot: string, args: { itemId: string }): Promise<void> {
  return runIpcOperation({
    operation: "findings_undo",
    metadata: { itemId: args.itemId },
    run: (requestId) =>
      getBridge()
        .undoFinding(projectRoot, { ...args, requestId })
        .catch(normalizeIpcError),
  });
}

export function getConnectionConfig(): Promise<{ baseUrl: string } | null> {
  return getBridge().getConnectionConfig().catch(normalizeIpcError);
}

export function getRuntimeStatus(projectRoot: string): Promise<IRuntimeStatusResponse | null> {
  return getBridge().getRuntimeStatus(projectRoot).catch(normalizeIpcError);
}

export function getScanningStatus(projectRoot: string): Promise<IScanningStatusResponse | null> {
  return getBridge().getScanningStatus(projectRoot).catch(normalizeIpcError);
}

export function getLogsDir(): Promise<string> {
  return getBridge().getLogsDir();
}

export function getRulesSnapshot(projectRoot: string): Promise<IRulesSnapshotResponse> {
  return runIpcOperation({
    operation: "rules_snapshot_get",
    run: (requestId) =>
      getBridge().getRulesSnapshot(projectRoot, requestId).catch(normalizeIpcError),
  });
}

export function getConfig(projectRoot: string): Promise<IConfigResponse | null> {
  return runIpcOperation({
    operation: "config_get",
    run: (requestId) => getBridge().getConfig(projectRoot, requestId).catch(normalizeIpcError),
  });
}

export function updateConfig(
  projectRoot: string,
  body: IUpdateConfigBody
): Promise<IConfigResponse> {
  return runIpcOperation({
    operation: "config_update",
    metadata: {},
    run: (requestId) =>
      getBridge().updateConfig(projectRoot, body, requestId).catch(normalizeIpcError),
  });
}

export function initializeProjectConfig(
  projectRoot: string,
  body: IInitializeConfigBody
): Promise<IConfigResponse> {
  return runIpcOperation({
    operation: "initialize_project_config",
    metadata: {},
    run: () => getBridge().initializeProjectConfig(projectRoot, body).catch(normalizeIpcError),
  });
}

export function listProjects(): Promise<IProjectWithStatus[]> {
  return getBridge().listProjects().catch(normalizeIpcError);
}

export function getSelectedProject(): Promise<string | null> {
  return getBridge().getSelectedProject();
}

export function setSelectedProject(projectRoot: string | null): Promise<void> {
  return getBridge().setSelectedProject(projectRoot);
}

export function addProject(projectRoot: string): Promise<void> {
  return getBridge().addProject(projectRoot).catch(normalizeIpcError);
}

export function removeProject(projectRoot: string): Promise<void> {
  return getBridge().removeProject(projectRoot).catch(normalizeIpcError);
}

export function startProject(projectRoot: string): Promise<void> {
  return getBridge().startProject(projectRoot).catch(normalizeIpcError);
}

export function stopProject(projectRoot: string): Promise<void> {
  return getBridge().stopProject(projectRoot).catch(normalizeIpcError);
}

export function getCliProvider(projectRoot: string): Promise<IAgentCliProvider> {
  return getBridge().getCliProvider(projectRoot).catch(normalizeIpcError);
}

export function setCliProvider(projectRoot: string, provider: IAgentCliProvider): Promise<void> {
  return getBridge().setCliProvider(projectRoot, provider).catch(normalizeIpcError);
}

export function openFolderDialog(): Promise<string | null> {
  return getBridge().openFolderDialog();
}

export function openLogsDirectory(): Promise<void> {
  return getBridge().openLogsDirectory();
}

export function reportRuntimeStatusError(message: string): void {
  const normalized = normalizeStatusMessage(message);
  if (!normalized) return;
  const now = Date.now();
  const withinWindow = now - lastStatusReport.at <= STATUS_REPORT_DEBOUNCE_MS;
  if (withinWindow && lastStatusReport.message === normalized) return;
  lastStatusReport = { message: normalized, at: now };
  void runIpcOperation({
    operation: "report_status_error",
    metadata: { statusMessage: normalized },
    run: (_requestId) => getBridge().reportStatusError(normalized),
  }).catch((e) => {
    log.trace({
      event: "ipc_report_status_error",
      phase: "fail",
      error: e instanceof Error ? e.message : String(e),
      metadata: { statusMessage: normalized },
    });
  });
}
