/**
 * AppError and error-log-context: construction, cause chaining, normalization, redaction.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { AppError, isAppError } from "./app-error.js";
import {
  formatZodIssuesForContext,
  normalizeErrorForLog,
  redactAndTruncateContext,
} from "./error-log-context.js";
import { ERR_CONFIG_INVALID } from "./error-codes.js";

describe("AppError", () => {
  it("constructs with message, code, and context", () => {
    const err = new AppError("Config invalid", ERR_CONFIG_INVALID, {
      filePath: "/tmp/config.json",
      reason: "schema_error",
    });
    expect(err.message).toBe("Config invalid");
    expect(err.code).toBe(ERR_CONFIG_INVALID);
    expect(err.context).toEqual({ filePath: "/tmp/config.json", reason: "schema_error" });
    expect(err.name).toBe("AppError");
  });

  it("supports native cause option", () => {
    const cause = new Error("Zod validation failed");
    const err = new AppError("Config invalid", ERR_CONFIG_INVALID, {}, { cause });
    expect((err as Error & { cause?: unknown }).cause).toBe(cause);
  });

  it("isAppError returns true for AppError instances", () => {
    const err = new AppError("x", "ERR_X", {});
    expect(isAppError(err)).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});

describe("formatZodIssuesForContext", () => {
  it("formats issues as path: message strings and caps by limit", () => {
    const result = z
      .object({ schemaVersion: z.number(), ruleSources: z.array(z.string()) })
      .safeParse({
        ruleSources: [1],
        approvalMode: "x",
      });
    expect(result.success).toBe(false);
    const issues = !result.success ? result.error.issues : [];
    const out = formatZodIssuesForContext(issues, 2);
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out.every((s) => /^[\s\S]+: [\s\S]+$/.test(s))).toBe(true);
  });
});

describe("redactAndTruncateContext", () => {
  it("redacts keys containing sensitive names", () => {
    const out = redactAndTruncateContext({
      filePath: "/tmp/x",
      token: "secret123",
      apiKey: "key",
    });
    expect(out.filePath).toBe("/tmp/x");
    expect(out.token).toBe("[redacted]");
    expect(out.apiKey).toBe("[redacted]");
  });

  it("truncates long strings", () => {
    const long = "a".repeat(3000);
    const out = redactAndTruncateContext({ message: long });
    expect((out.message as string).length).toBeLessThan(2500);
    expect((out.message as string).endsWith("...[truncated]")).toBe(true);
  });
});

describe("normalizeErrorForLog", () => {
  it("returns code and context for AppError", () => {
    const err = new AppError("Config invalid", ERR_CONFIG_INVALID, {
      filePath: "/tmp/config.json",
      reason: "schema_error",
    });
    const log = normalizeErrorForLog(err);
    expect(log.code).toBe(ERR_CONFIG_INVALID);
    expect(log.message).toBe("Config invalid");
    expect(log.context).toHaveProperty("filePath", "/tmp/config.json");
    expect(log.context).toHaveProperty("reason", "schema_error");
    expect(Array.isArray(log.causeChain)).toBe(true);
  });

  it("returns ERR_UNEXPECTED for plain Error", () => {
    const err = new Error("Something broke");
    const log = normalizeErrorForLog(err);
    expect(log.code).toBe("ERR_UNEXPECTED");
    expect(log.message).toBe("Something broke");
    expect(log.context).toEqual({});
    expect(log.causeChain).toHaveLength(1);
    const first = log.causeChain[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(first).toMatchObject({ name: "Error", message: "Something broke" });
    }
  });

  it("unrolls cause chain", () => {
    const inner = new Error("inner");
    const outer = new AppError("outer", ERR_CONFIG_INVALID, {}, { cause: inner });
    const log = normalizeErrorForLog(outer);
    expect(log.causeChain).toHaveLength(1);
    const link = log.causeChain[0];
    expect(link?.message).toBe("inner");
  });
});
