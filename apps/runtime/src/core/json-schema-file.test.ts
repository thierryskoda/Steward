import { describe, it } from "vitest";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { z } from "zod";
import {
  parseJsonWithSchemaResult,
  readJsonFileWithSchemaResult,
  readJsonFileWithSchemaOrThrow,
  formatZodIssues,
} from "./json-schema-file.js";

const TestSchema = z.object({ id: z.string(), count: z.number() });

describe("parseJsonWithSchemaResult", () => {
  it("returns data when JSON and schema are valid", () => {
    const result = parseJsonWithSchemaResult('{"id":"a","count":1}', TestSchema);
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.data.id, "a");
      assert.strictEqual(result.data.count, 1);
    }
  });

  it("returns json_error for invalid JSON", () => {
    const result = parseJsonWithSchemaResult("not json", TestSchema);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.reason, "json_error");
      assert.ok(result.details.length > 0);
    }
  });

  it("returns schema_error with issues when schema fails", () => {
    const result = parseJsonWithSchemaResult('{"id":"a","count":"not-a-number"}', TestSchema);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.reason, "schema_error");
      assert.ok(result.details.length > 0);
      assert.ok("issues" in result && Array.isArray(result.issues));
    }
  });

  it("returns json_error for empty content", () => {
    const result = parseJsonWithSchemaResult("   ", TestSchema);
    assert.strictEqual(result.ok, false);
    if (!result.ok) assert.strictEqual(result.reason, "json_error");
  });
});

describe("readJsonFileWithSchemaResult", () => {
  it("returns data when file is valid", () => {
    const dir = mkdtempSync(join(tmpdir(), "json-schema-file-"));
    try {
      const path = join(dir, "config.json");
      writeFileSync(path, '{"id":"f","count":2}', "utf-8");
      const result = readJsonFileWithSchemaResult(path, TestSchema);
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.data.id, "f");
        assert.strictEqual(result.data.count, 2);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readJsonFileWithSchemaOrThrow", () => {
  it("returns data when valid", () => {
    const dir = mkdtempSync(join(tmpdir(), "json-schema-throw-"));
    try {
      const path = join(dir, "config.json");
      writeFileSync(path, '{"id":"x","count":0}', "utf-8");
      const data = readJsonFileWithSchemaOrThrow({
        filePath: path,
        schema: TestSchema,
        buildErrorMessage: ({ details }) => `Error: ${details}`,
      });
      assert.strictEqual(data.id, "x");
      assert.strictEqual(data.count, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws with message from buildErrorMessage", () => {
    const dir = mkdtempSync(join(tmpdir(), "json-schema-throw-err-"));
    try {
      const path = join(dir, "bad.json");
      writeFileSync(path, "not json", "utf-8");
      assert.throws(
        () =>
          readJsonFileWithSchemaOrThrow({
            filePath: path,
            schema: TestSchema,
            buildErrorMessage: ({ reason }) => `Custom ${reason}`,
          }),
        /Custom json_error/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("formatZodIssues", () => {
  it("formats issues with path and message", () => {
    const result = parseJsonWithSchemaResult('{"id":"a","count":"x"}', TestSchema);
    assert.strictEqual(result.ok, false);
    if (!result.ok && result.reason === "schema_error") {
      const out = formatZodIssues(result.issues);
      assert.ok(out.includes("count"));
      assert.ok(out.length > 0);
    }
  });
});
