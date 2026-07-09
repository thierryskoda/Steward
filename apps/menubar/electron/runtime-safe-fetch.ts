/**
 * Typed runtime HTTP client: auth, timeout, non-2xx → gateway errors, JSON parse + Zod validation.
 * Used only by runtime-gateway; throws IRuntimeGatewayError so IPC serialization stays unchanged.
 */
import type { z } from "zod";
import type { ZodError } from "zod";
import { OkResponseSchema } from "@steward/contracts/schemas";
import { parseErrorResponse } from "@steward/contracts/error";
import type { IConnection } from "./runtime-service.js";
import { formatErrorForLog, writeHostLog } from "./logs-service.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const X_REQUEST_ID = "x-request-id";

export type IRuntimeGatewayError =
  | { kind: "offline"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "api"; code: string; message: string; details?: string }
  | { kind: "parse"; message: string };

export function toGatewayError(e: unknown): IRuntimeGatewayError {
  if (typeof e === "object" && e !== null && "kind" in e) {
    const err = e as { kind?: string; message?: string; code?: string };
    if (
      err.kind === "offline" ||
      err.kind === "timeout" ||
      err.kind === "unauthorized" ||
      err.kind === "api" ||
      err.kind === "parse"
    ) {
      return e as IRuntimeGatewayError;
    }
  }
  if (e instanceof Error) {
    if (e.name === "AbortError") return { kind: "timeout", message: "Request timed out" };
    return { kind: "offline", message: e.message };
  }
  return { kind: "offline", message: String(e) };
}

function buildHeaders(connection: IConnection, requestId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${connection.token}`,
  };
  if (requestId != null && requestId.length > 0) {
    headers[X_REQUEST_ID] = requestId;
  }
  return headers;
}

async function requestRaw(
  connection: IConnection,
  args: {
    path: string;
    method: "GET" | "POST" | "PATCH";
    body?: string;
    requestId?: string;
    timeoutMs: number | undefined;
  }
): Promise<{ res: Response; body: string }> {
  const controller = new AbortController();
  const timeoutMs = args.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = buildHeaders(connection, args.requestId);
  try {
    const res = await fetch(`${connection.baseUrl}${args.path}`, {
      method: args.method,
      headers,
      body: args.body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const body = await res.text();
    return { res, body };
  } catch (e) {
    clearTimeout(timeout);
    const reqIdSuffix =
      args.requestId != null && args.requestId.length > 0 ? ` requestId=${args.requestId}` : "";
    writeHostLog(
      "error",
      "runtime_http",
      `request failed ${args.method} ${args.path}: ${formatErrorForLog(e)}${reqIdSuffix}`
    );
    throw toGatewayError(e);
  }
}

function throwIfNotOk(
  res: Response,
  body: string,
  fallbackMessage: string,
  requestId?: string
): asserts res is Response & { ok: true } {
  if (res.ok) return;
  const apiErr = parseErrorResponse(body);
  const errMsg =
    res.status === 401
      ? "401 unauthorized"
      : apiErr
        ? `api ${apiErr.error.code}: ${apiErr.error.message}`
        : body || fallbackMessage;
  const reqIdSuffix = requestId != null && requestId.length > 0 ? ` requestId=${requestId}` : "";
  writeHostLog(
    "error",
    "runtime_http",
    `response not ok: status=${res.status} ${errMsg}${reqIdSuffix}`
  );
  if (res.status === 401) {
    throw { kind: "unauthorized" as const, message: "Invalid token" };
  }
  if (apiErr) {
    throw {
      kind: "api" as const,
      code: apiErr.error.code,
      message: apiErr.error.message,
      ...(apiErr.error.details !== undefined ? { details: apiErr.error.details } : {}),
    };
  }
  throw {
    kind: "offline" as const,
    message: body || fallbackMessage,
  };
}

function parseJsonBody(body: string, endpoint: string): unknown {
  try {
    return JSON.parse(body);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const sample = body.trim().slice(0, 200);
    throw {
      kind: "parse" as const,
      message: `Runtime returned non-JSON for ${endpoint}. ${reason}. Body sample: ${sample}`,
    };
  }
}

export function formatParseError(error: ZodError, payload: unknown): string {
  const issue = error.issues.find(
    (
      i
    ): i is typeof i & {
      code: "invalid_union_discriminator";
      options: string[];
    } =>
      i.code === "invalid_union_discriminator" &&
      Array.isArray((i as { options?: unknown }).options)
  );
  if (issue) {
    const path = issue.path;
    let received: unknown;
    if (path[0] === "items" && typeof path[1] === "number" && path[2] === "type") {
      const items = (payload as { items?: unknown[] })?.items;
      const item = items?.[path[1]];
      received =
        item && typeof item === "object" && "type" in item
          ? (item as { type: unknown }).type
          : undefined;
    }
    const receivedStr = received !== undefined ? `, received '${String(received)}'` : "";
    return `Invalid item at index ${path[1]}: expected type in [${issue.options.join(", ")}]${receivedStr}. Restart app if schema changed.`;
  }
  const fallback = error.issues
    .slice(0, 2)
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  return fallback.slice(0, 300) || "Payload validation failed.";
}

// --- No-body (GET) request, typed JSON response
export type SafeFetchJsonNoBodyOptions<T> = {
  connection: IConnection;
  path: string;
  method: "GET";
  requestId?: string;
  responseSchema: z.ZodType<T>;
  fallbackMessage: string;
  /** When response status is in this list, return null instead of throwing. */
  nullOnStatuses?: number[];
};

// --- With-body (POST/PATCH) request, typed JSON response
export type SafeFetchJsonWithBodyOptions<T> = {
  connection: IConnection;
  path: string;
  method: "POST" | "PATCH";
  body: string;
  requestId?: string;
  timeoutMs: number | undefined;
  responseSchema: z.ZodType<T>;
  fallbackMessage: string;
};

/** GET request with optional null-on-status; returns T or null when status in nullOnStatuses. */
export async function safeFetchJson<T>(options: SafeFetchJsonNoBodyOptions<T>): Promise<T | null> {
  const { res, body } = await requestRaw(options.connection, {
    path: options.path,
    method: "GET",
    requestId: options.requestId,
    timeoutMs: undefined,
  });
  if (options.nullOnStatuses?.includes(res.status)) return null;
  throwIfNotOk(res, body, options.fallbackMessage, options.requestId);
  const raw = parseJsonBody(body, options.path);
  const parsed = options.responseSchema.safeParse(raw);
  if (!parsed.success) {
    throw {
      kind: "parse" as const,
      message: formatParseError(parsed.error, raw),
    };
  }
  return parsed.data;
}

/** GET with nullOnStatuses; on JSON parse or schema failure returns null and logs (e.g. runtime status). */
export async function safeFetchJsonSoft<T>(
  options: SafeFetchJsonNoBodyOptions<T>
): Promise<T | null> {
  const { res, body } = await requestRaw(options.connection, {
    path: options.path,
    method: "GET",
    requestId: options.requestId,
    timeoutMs: undefined,
  });
  if (options.nullOnStatuses?.includes(res.status)) return null;
  throwIfNotOk(res, body, options.fallbackMessage, options.requestId);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (e) {
    writeHostLog("error", "runtime_http", `${options.path} body not JSON: ${formatErrorForLog(e)}`);
    return null;
  }
  const parsed = options.responseSchema.safeParse(raw);
  if (!parsed.success) {
    writeHostLog(
      "error",
      "runtime_http",
      `${options.path} schema invalid: ${parsed.error.message}`
    );
    return null;
  }
  return parsed.data;
}

/** POST or PATCH with body (JSON string); returns typed T. */
export async function safeFetchJsonWithBody<T>(
  options: SafeFetchJsonWithBodyOptions<T>
): Promise<T> {
  const { res, body } = await requestRaw(options.connection, {
    path: options.path,
    method: options.method,
    body: options.body,
    requestId: options.requestId,
    timeoutMs: options.timeoutMs,
  });
  throwIfNotOk(res, body, options.fallbackMessage, options.requestId);
  const raw = parseJsonBody(body, options.path);
  const parsed = options.responseSchema.safeParse(raw);
  if (!parsed.success) {
    throw {
      kind: "parse" as const,
      message: formatParseError(parsed.error, raw),
    };
  }
  return parsed.data;
}

/** Mutation (POST, no response body needed or validate { ok: true }). */
export type SafeFetchOkOptions = {
  connection: IConnection;
  path: string;
  body?: string;
  requestId?: string;
  fallbackMessage: string;
};

export async function safeFetchOk(options: SafeFetchOkOptions): Promise<void> {
  const { res, body } = await requestRaw(options.connection, {
    path: options.path,
    method: "POST",
    body: options.body,
    requestId: options.requestId,
    timeoutMs: undefined,
  });
  throwIfNotOk(res, body, options.fallbackMessage, options.requestId);
  if (body.trim().length === 0) return;
  const raw = parseJsonBody(body, options.path);
  const parsed = OkResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw {
      kind: "parse" as const,
      message: `Unexpected mutation response: ${formatParseError(parsed.error, raw)}`,
    };
  }
}
