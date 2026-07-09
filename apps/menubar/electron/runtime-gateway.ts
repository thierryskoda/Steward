import {
  ConfigResponseSchema,
  CtoItemsResponseSchema,
  ApproveFindingBodySchema,
  InboxFindingsResponseSchema,
  InboxRulesResponseSchema,
  RulesSnapshotResponseSchema,
  RuntimeStatusResponseSchema,
  ScanningStatusResponseSchema,
  type ICtoItem,
  type IConfigResponse,
  type IRuntimeStatusResponse,
  type IScanningStatusResponse,
  type IInboxFindingItem,
  type IInitializeConfigBody,
  type IInboxRuleItem,
  type IRulesSnapshotResponse,
  type IUpdateConfigBody,
  RejectBodySchema,
} from "@steward/contracts/schemas";
import { ROUTES, buildRoute } from "@steward/contracts/routes";
import type { IConnection } from "./runtime-service.js";
import { formatErrorForLog, writeHostLog } from "./logs-service.js";
import {
  type IRuntimeGatewayError,
  toGatewayError,
  safeFetchJson,
  safeFetchJsonSoft,
  safeFetchJsonWithBody,
  safeFetchOk,
} from "./runtime-safe-fetch.js";

export type { IRuntimeGatewayError };

const READ_RETRIES = 3;
const RETRY_DELAY_MS = 500;
const CONFIG_INITIALIZE_TIMEOUT_MS = 30 * 60 * 1000;

export type IRuntimeGatewayErrorSerializable = {
  kind: string;
  code?: string;
  message: string;
  details?: string;
};

export function isRuntimeGatewayError(e: unknown): e is IRuntimeGatewayError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    "message" in e &&
    typeof (e as { kind: unknown }).kind === "string" &&
    typeof (e as { message: unknown }).message === "string"
  );
}

export function toSerializableGatewayError(
  e: IRuntimeGatewayError
): IRuntimeGatewayErrorSerializable {
  const code = "code" in e && typeof e.code === "string" ? e.code : undefined;
  const details = e.kind === "api" && e.details !== undefined ? e.details : undefined;
  return {
    kind: e.kind,
    message: e.message,
    ...(code !== undefined ? { code } : {}),
    ...(details !== undefined ? { details } : {}),
  };
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries: number; delayMs: number; requestId?: string }
): Promise<T> {
  let lastError: IRuntimeGatewayError | null = null;
  for (let i = 0; i < options.retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = toGatewayError(e);
      if (i < options.retries - 1) {
        await new Promise((r) => setTimeout(r, options.delayMs));
      }
    }
  }
  const final = lastError ?? {
    kind: "offline" as const,
    message: "Failed after retries",
  };
  const reqIdSuffix =
    options.requestId != null && options.requestId.length > 0
      ? ` requestId=${options.requestId}`
      : "";
  writeHostLog(
    "error",
    "runtime_http",
    `retries exhausted: ${formatErrorForLog(final)}${reqIdSuffix}`
  );
  throw final;
}

export async function getRuntimeStatus(
  connection: IConnection | null
): Promise<IRuntimeStatusResponse | null> {
  if (!connection) return null;
  return safeFetchJsonSoft({
    connection,
    path: ROUTES.RUNTIME_STATUS.path,
    method: "GET",
    responseSchema: RuntimeStatusResponseSchema,
    fallbackMessage: "Status fetch failed",
    nullOnStatuses: [404, 503],
  });
}

async function fetchInboxFindings(
  connection: IConnection,
  requestId?: string
): Promise<IInboxFindingItem[]> {
  const result = await safeFetchJson({
    connection,
    path: ROUTES.INBOX_FINDINGS.path,
    method: "GET",
    requestId,
    responseSchema: InboxFindingsResponseSchema,
    fallbackMessage: "Findings inbox fetch failed",
  });
  return result!.items;
}

async function fetchInboxRules(
  connection: IConnection,
  requestId?: string
): Promise<IInboxRuleItem[]> {
  const result = await safeFetchJson({
    connection,
    path: ROUTES.INBOX_RULES.path,
    method: "GET",
    requestId,
    responseSchema: InboxRulesResponseSchema,
    fallbackMessage: "Rules inbox fetch failed",
  });
  return result!.items;
}

export async function getRulesSnapshot(
  connection: IConnection,
  requestId?: string
): Promise<IRulesSnapshotResponse> {
  const result = await safeFetchJson({
    connection,
    path: ROUTES.RULES_SNAPSHOT.path,
    method: "GET",
    requestId,
    responseSchema: RulesSnapshotResponseSchema,
    fallbackMessage: "Rules snapshot fetch failed",
  });
  return result!;
}

export async function getConfig(
  connection: IConnection,
  requestId?: string
): Promise<IConfigResponse | null> {
  return safeFetchJson<IConfigResponse>({
    connection,
    path: ROUTES.CONFIG_GET.path,
    method: "GET",
    requestId,
    responseSchema: ConfigResponseSchema,
    fallbackMessage: "Config fetch failed",
    nullOnStatuses: [404],
  });
}

export async function updateConfig(
  connection: IConnection,
  body: IUpdateConfigBody,
  requestId?: string
): Promise<IConfigResponse> {
  return safeFetchJsonWithBody({
    connection,
    path: ROUTES.CONFIG_UPDATE.path,
    method: "PATCH",
    body: JSON.stringify(body),
    requestId,
    timeoutMs: undefined,
    responseSchema: ConfigResponseSchema,
    fallbackMessage: "Config update failed",
  });
}

export async function initializeProjectConfig(
  connection: IConnection,
  body: IInitializeConfigBody,
  requestId?: string
): Promise<IConfigResponse> {
  return safeFetchJsonWithBody({
    connection,
    path: ROUTES.CONFIG_INITIALIZE.path,
    method: "POST",
    body: JSON.stringify(body),
    requestId,
    timeoutMs: CONFIG_INITIALIZE_TIMEOUT_MS,
    responseSchema: ConfigResponseSchema,
    fallbackMessage: "Config initialize failed",
  });
}

async function fetchCtoItems(connection: IConnection, requestId?: string): Promise<ICtoItem[]> {
  const result = await safeFetchJson({
    connection,
    path: ROUTES.ITEMS.path,
    method: "GET",
    requestId,
    responseSchema: CtoItemsResponseSchema,
    fallbackMessage: "Items fetch failed",
  });
  return result!.items;
}

export async function getInboxFindings(
  connection: IConnection,
  requestId?: string
): Promise<IInboxFindingItem[]> {
  return withRetry(() => fetchInboxFindings(connection, requestId), {
    retries: READ_RETRIES,
    delayMs: RETRY_DELAY_MS,
    requestId,
  });
}

export async function getInboxRules(
  connection: IConnection,
  requestId?: string
): Promise<IInboxRuleItem[]> {
  return withRetry(() => fetchInboxRules(connection, requestId), {
    retries: READ_RETRIES,
    delayMs: RETRY_DELAY_MS,
    requestId,
  });
}

export async function getCtoItems(
  connection: IConnection,
  requestId?: string
): Promise<ICtoItem[]> {
  return withRetry(() => fetchCtoItems(connection, requestId), {
    retries: READ_RETRIES,
    delayMs: RETRY_DELAY_MS,
    requestId,
  });
}

export async function approveRule(
  connection: IConnection,
  args: { ruleId: string; requestId?: string }
): Promise<void> {
  await safeFetchOk({
    connection,
    path: buildRoute(ROUTES.RULES_APPROVE.path, { id: args.ruleId }),
    fallbackMessage: "Approve rule failed",
    requestId: args.requestId,
  });
}

export async function rejectRule(
  connection: IConnection,
  args: { ruleId: string; requestId?: string }
): Promise<void> {
  await safeFetchOk({
    connection,
    path: buildRoute(ROUTES.RULES_REJECT.path, { id: args.ruleId }),
    fallbackMessage: "Reject failed",
    requestId: args.requestId,
  });
}

export async function approveFinding(
  connection: IConnection,
  args: { itemId: string; selectedOptionId?: "A" | "B" | "C"; requestId?: string }
): Promise<void> {
  const body =
    args.selectedOptionId !== undefined
      ? JSON.stringify(
          ApproveFindingBodySchema.parse({
            selectedOptionId: args.selectedOptionId,
          })
        )
      : undefined;
  await safeFetchOk({
    connection,
    path: buildRoute(ROUTES.FINDINGS_APPROVE.path, { id: args.itemId }),
    body,
    fallbackMessage: "Approve finding failed",
    requestId: args.requestId,
  });
}

export async function rejectFinding(
  connection: IConnection,
  args: { itemId: string; rejectReason: string; requestId?: string }
): Promise<void> {
  const body = JSON.stringify(RejectBodySchema.parse({ rejectReason: args.rejectReason ?? "" }));
  await safeFetchOk({
    connection,
    path: buildRoute(ROUTES.FINDINGS_REJECT.path, { id: args.itemId }),
    body,
    fallbackMessage: "Reject finding failed",
    requestId: args.requestId,
  });
}

export async function undoFinding(
  connection: IConnection,
  args: { itemId: string; requestId?: string }
): Promise<void> {
  await safeFetchOk({
    connection,
    path: buildRoute(ROUTES.FINDINGS_UNDO.path, { id: args.itemId }),
    fallbackMessage: "Undo finding failed",
    requestId: args.requestId,
  });
}

export async function shutdownRuntime(connection: IConnection, requestId?: string): Promise<void> {
  await safeFetchOk({
    connection,
    path: ROUTES.RUNTIME_SHUTDOWN.path,
    fallbackMessage: "Shutdown failed",
    requestId,
  });
}

export async function getScanningStatus(
  connection: IConnection,
  requestId?: string
): Promise<IScanningStatusResponse | null> {
  return safeFetchJson<IScanningStatusResponse>({
    connection,
    path: ROUTES.SCANNING_STATUS.path,
    method: "GET",
    requestId,
    responseSchema: ScanningStatusResponseSchema,
    fallbackMessage: "Scanning status fetch failed",
    nullOnStatuses: [404],
  });
}

export async function resumeScanning(
  connection: IConnection,
  requestId?: string
): Promise<IScanningStatusResponse> {
  return safeFetchJsonWithBody({
    connection,
    path: ROUTES.SCANNING_RESUME.path,
    method: "POST",
    body: "{}",
    requestId,
    timeoutMs: undefined,
    responseSchema: ScanningStatusResponseSchema,
    fallbackMessage: "Scanning resume failed",
  });
}

export async function pauseScanning(
  connection: IConnection,
  requestId?: string
): Promise<IScanningStatusResponse> {
  return safeFetchJsonWithBody({
    connection,
    path: ROUTES.SCANNING_PAUSE.path,
    method: "POST",
    body: "{}",
    requestId,
    timeoutMs: undefined,
    responseSchema: ScanningStatusResponseSchema,
    fallbackMessage: "Scanning pause failed",
  });
}
