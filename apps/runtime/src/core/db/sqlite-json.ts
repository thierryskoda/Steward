import type { z } from "zod";
import { AppError } from "../app-error.js";
import { ERR_SCHEMA_VALIDATION } from "../error-codes.js";
import { formatZodIssuesForContext } from "../error-log-context.js";

export function stringifyJsonForDb(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJsonFromDb<T>(args: {
  raw: string;
  schema: z.ZodType<T>;
  context: Record<string, string | number | boolean | null | undefined>;
}): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args.raw);
  } catch (cause) {
    throw new AppError(
      "Invalid JSON stored in SQLite row",
      ERR_SCHEMA_VALIDATION,
      { ...args.context, reason: "json_parse" },
      { cause }
    );
  }

  const result = args.schema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      "Invalid JSON shape stored in SQLite row",
      ERR_SCHEMA_VALIDATION,
      {
        ...args.context,
        reason: "schema_validation",
        issues: formatZodIssuesForContext(result.error.issues),
      },
      { cause: result.error }
    );
  }
  return result.data;
}
