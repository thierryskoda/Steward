/**
 * Shared read/parse path for JSON files validated with Zod.
 * Callers own logging and error messages; this module only normalizes parse/schema results.
 */
import { readFileSync } from "fs";
import { z } from "zod";
import { logError } from "./logger.js";
import { READ_JSON_SCHEMA_PARSE_ERROR } from "./runtime-log-events.js";

type IJsonSchemaFileResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "json_error"; details: string }
  | { ok: false; reason: "schema_error"; details: string; issues: z.ZodIssue[] };

const DEFAULT_ISSUE_LIMIT = 3;

export function formatZodIssues(issues: z.ZodIssue[], limit: number = DEFAULT_ISSUE_LIMIT): string {
  return issues
    .slice(0, limit)
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
}

/**
 * Parses a string as JSON and validates with the schema. Does not read from disk.
 */
export function parseJsonWithSchemaResult<T>(
  content: string,
  schema: z.ZodType<T>
): IJsonSchemaFileResult<T> {
  const trimmed = content.trim();
  if (!trimmed) {
    return { ok: false, reason: "json_error", details: "Empty content" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e);
    logError(e, {
      event: READ_JSON_SCHEMA_PARSE_ERROR,
      component: "core",
      operation: "parseJsonWithSchemaResult",
      details,
    });
    return { ok: false, reason: "json_error", details };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      reason: "schema_error",
      details: formatZodIssues(result.error.issues),
      issues: result.error.issues,
    };
  }
  return { ok: true, data: result.data };
}

/**
 * Reads file, parses JSON, validates with schema. Returns discriminated result.
 * File read errors (e.g. ENOENT) propagate; only JSON parse and schema failures are normalized.
 */
export function readJsonFileWithSchemaResult<T>(
  filePath: string,
  schema: z.ZodType<T>
): IJsonSchemaFileResult<T> {
  const content = readFileSync(filePath, "utf-8");
  return parseJsonWithSchemaResult(content, schema);
}

type IReadJsonFileWithSchemaOrThrowArgs<T> = {
  filePath: string;
  schema: z.ZodType<T>;
  buildErrorMessage: (args: { reason: "json_error" | "schema_error"; details: string }) => string;
};

/**
 * Reads file, parses JSON, validates with schema. Throws on failure with caller-defined message.
 */
export function readJsonFileWithSchemaOrThrow<T>(args: IReadJsonFileWithSchemaOrThrowArgs<T>): T {
  const { filePath, schema, buildErrorMessage } = args;
  const result = readJsonFileWithSchemaResult(filePath, schema);
  if (result.ok) return result.data;
  throw new Error(buildErrorMessage({ reason: result.reason, details: result.details }));
}
