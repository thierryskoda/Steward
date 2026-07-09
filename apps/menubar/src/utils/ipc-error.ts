/**
 * Normalize IPC errors so typed runtime/gateway errors (kind, code, message) are preserved
 * instead of a flat message string. Main process encodes them with this prefix.
 */
import type { IRuntimeIpcError } from "./ipc-error.schemas.js";
import { ipcErrorPayloadSchema } from "./ipc-error.schemas.js";

export type { IRuntimeIpcError };

const IPC_ERROR_PREFIX = "CTO_IPC_ERROR:";

function isEncodedIpcError(message: string): boolean {
  return message.startsWith(IPC_ERROR_PREFIX);
}

function parseEncodedIpcError(message: string): IRuntimeIpcError | null {
  if (!isEncodedIpcError(message)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message.slice(IPC_ERROR_PREFIX.length));
  } catch {
    return null;
  }
  const result = ipcErrorPayloadSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * If the value is an Error whose message encodes a typed runtime/gateway error, throw
 * an Error that has kind, code, message, and optional details as own properties so the UI
 * and logs can show which fields caused validation failures.
 * Otherwise rethrow the original value.
 */
export function normalizeIpcError(error: unknown): never {
  if (error instanceof Error && isEncodedIpcError(error.message)) {
    const parsed = parseEncodedIpcError(error.message);
    if (parsed) {
      const e = new Error(parsed.message) as Error & IRuntimeIpcError;
      e.kind = parsed.kind;
      if (parsed.code !== undefined) e.code = parsed.code;
      e.message = parsed.message;
      if (parsed.details !== undefined) {
        e.details = parsed.details;
        e.message = `${parsed.message} — ${parsed.details}`;
      }
      throw e;
    }
  }
  throw error;
}
