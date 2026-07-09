/**
 * Central error serialization for logging: normalize unknown errors, unroll cause chain, redact and truncate context.
 */
import type { z } from "zod";
import { isAppError } from "./app-error.js";
import { ERR_UNEXPECTED } from "./error-codes.js";

const ISSUES_LIMIT = 5;
const STRING_MAX_LEN = 2000;
const SNAPSHOT_MAX_KEYS = 20;
const SENSITIVE_KEYS = new Set([
  "token",
  "password",
  "secret",
  "authorization",
  "cookie",
  "key",
  "apiKey",
  "api_key",
]);

export type INormalizedErrorLog = {
  code: string;
  message: string;
  context: Record<string, unknown>;
  causeChain: Array<{ name: string; message: string }>;
};

/**
 * Flatten Zod issues to "path: message" strings for context.issues; capped for log safety.
 */
export function formatZodIssuesForContext(
  issues: z.ZodIssue[],
  limit: number = ISSUES_LIMIT
): string[] {
  const out = issues.slice(0, limit).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return out;
}

function truncateString(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen) + "...[truncated]";
}

function redactValue(key: string, value: unknown): unknown {
  const lower = key.toLowerCase();
  for (const s of SENSITIVE_KEYS) {
    if (lower.includes(s)) return "[redacted]";
  }
  return value;
}

function truncateSnapshot(obj: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(obj).slice(0, SNAPSHOT_MAX_KEYS);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string") {
      out[k] = truncateString(v, 500);
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = truncateSnapshot(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[k] = v
        .slice(0, 10)
        .map((item) => (typeof item === "string" ? truncateString(item, 200) : item));
    } else {
      out[k] = v;
    }
  }
  if (Object.keys(obj).length > SNAPSHOT_MAX_KEYS) {
    out._truncatedKeys = true;
  }
  return out;
}

/**
 * Redact sensitive keys and truncate large values in context for safe logging.
 */
export function redactAndTruncateContext(
  context: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    const safeValue = redactValue(key, value);
    if (typeof safeValue === "string") {
      out[key] = truncateString(safeValue, STRING_MAX_LEN);
    } else if (
      key === "snapshot" &&
      typeof safeValue === "object" &&
      safeValue !== null &&
      !Array.isArray(safeValue)
    ) {
      out[key] = truncateSnapshot(safeValue as Record<string, unknown>);
    } else if (Array.isArray(safeValue)) {
      const arr = safeValue as unknown[];
      out[key] = arr
        .slice(0, 20)
        .map((item) => (typeof item === "string" ? truncateString(item, 300) : item));
      if (arr.length > 20) out[`${key}Truncated`] = true;
    } else {
      out[key] = safeValue;
    }
  }
  return out;
}

function getCauseChain(err: unknown): Array<{ name: string; message: string }> {
  const chain: Array<{ name: string; message: string }> = [];
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const name = current instanceof Error ? current.name : "Error";
    const message = current instanceof Error ? current.message : String(current);
    chain.push({ name, message });
    const cause =
      current instanceof Error && "cause" in current
        ? (current as Error & { cause?: unknown }).cause
        : undefined;
    current = cause;
  }
  return chain;
}

/**
 * Normalize any thrown value to a structured log payload. AppError yields code + context; others yield ERR_UNEXPECTED.
 */
export function normalizeErrorForLog(err: unknown): INormalizedErrorLog {
  if (isAppError(err)) {
    return {
      code: err.code,
      message: err.message,
      context: redactAndTruncateContext(err.context),
      causeChain: getCauseChain(err.cause),
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: ERR_UNEXPECTED,
    message: message || "Unknown error",
    context: {},
    causeChain: getCauseChain(err),
  };
}
