/**
 * Tests for JSON extraction from LLM output: fenced vs raw, embedded backticks and braces in string values.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { z } from "zod";
import { extractJsonObject, extractJsonArray } from "./json-extract.js";

const ExtractCategoriesSchema = z.object({
  categories: z.array(
    z.object({
      categoryId: z.string(),
      rulePath: z.string(),
      ruleContent: z.string(),
    })
  ),
});

const ExtractAbSchema = z.object({ a: z.string(), b: z.number() });
const ExtractAbNumberStringSchema = z.object({ a: z.number(), b: z.string() });
const ExtractCategoriesEmptySchema = z.object({ categories: z.array(z.unknown()) });

const ExtractSnippetArraySchema = z.array(z.object({ id: z.string(), snippet: z.string() }));
const ExtractNumberArraySchema = z.array(z.number());

describe("extractJsonObject", () => {
  it("returns full object when JSON contains embedded triple-backticks in string value (brace extraction)", () => {
    const raw =
      '{"categories":[{"categoryId":"code-comments","rulePath":".cursorrules","ruleContent":"## Code Comments\\n\\n```typescript\\n// Bad\\n```"}]}';
    const out = extractJsonObject(raw);
    assert.strictEqual(out !== null, true);
    const parsed: unknown = JSON.parse(out!);
    const result = ExtractCategoriesSchema.safeParse(parsed);
    if (!result.success) assert.fail(`schema invalid: ${result.error.message}`);
    assert.strictEqual(result.data.categories.length, 1);
    assert.ok(result.data.categories[0]!.ruleContent.includes("```typescript"));
  });

  it("returns full object when JSON contains braces in string value", () => {
    const raw = '{"a":"value with { and } inside","b":2}';
    const out = extractJsonObject(raw);
    assert.strictEqual(out !== null, true);
    const parsed: unknown = JSON.parse(out!);
    const result = ExtractAbSchema.safeParse(parsed);
    if (!result.success) assert.fail(`schema invalid: ${result.error.message}`);
    assert.strictEqual(result.data.a, "value with { and } inside");
    assert.strictEqual(result.data.b, 2);
  });

  it("strips single leading and trailing code fence when response starts with ```", () => {
    const inner = '{"categories":[]}';
    const raw = "```json\n" + inner + "\n```";
    const out = extractJsonObject(raw);
    assert.strictEqual(out?.trim(), inner);
    const parsed: unknown = JSON.parse(out!);
    const result = ExtractCategoriesEmptySchema.safeParse(parsed);
    if (!result.success) assert.fail(`schema invalid: ${result.error.message}`);
    assert.strictEqual(result.data.categories.length, 0);
  });

  it("returns raw JSON object when response has no leading fence (brace extraction)", () => {
    const raw = '{"a":1,"b":"x"}';
    const out = extractJsonObject(raw);
    assert.strictEqual(out, raw);
    const parsed: unknown = JSON.parse(out!);
    const result = ExtractAbNumberStringSchema.safeParse(parsed);
    if (!result.success) assert.fail(`schema invalid: ${result.error.message}`);
    assert.deepStrictEqual({ a: result.data.a, b: result.data.b }, { a: 1, b: "x" });
  });

  it("returns the first balanced object when provider text follows JSON", () => {
    const raw = '{"a":"value","b":2}\n\n[REDACTED]';
    const out = extractJsonObject(raw);
    assert.strictEqual(out, '{"a":"value","b":2}');
    const parsed: unknown = JSON.parse(out!);
    const result = ExtractAbSchema.safeParse(parsed);
    if (!result.success) assert.fail(`schema invalid: ${result.error.message}`);
    assert.strictEqual(result.data.a, "value");
    assert.strictEqual(result.data.b, 2);
  });

  it("returns null when the object is incomplete", () => {
    assert.strictEqual(extractJsonObject('{"a":"value"'), null);
  });

  it("returns null when no opening brace", () => {
    assert.strictEqual(extractJsonObject("no json here"), null);
    assert.strictEqual(extractJsonObject("  \n  "), null);
  });
});

describe("extractJsonArray", () => {
  it("returns full array when JSON contains embedded triple-backticks in string (bracket extraction)", () => {
    const raw = '[{"id":"1","snippet":"```ts\\ncode\\n```"}]';
    const out = extractJsonArray(raw);
    assert.strictEqual(out !== null, true);
    const parsed: unknown = JSON.parse(out!);
    const result = ExtractSnippetArraySchema.safeParse(parsed);
    if (!result.success) assert.fail(`schema invalid: ${result.error.message}`);
    assert.strictEqual(result.data.length, 1);
    assert.ok(result.data[0]!.snippet.includes("```"));
  });

  it("strips single leading and trailing code fence when response starts with ```", () => {
    const inner = "[1,2,3]";
    const raw = "```\n" + inner + "\n```";
    const out = extractJsonArray(raw);
    assert.strictEqual(out?.trim(), inner);
    const parsed: unknown = JSON.parse(out!);
    const result = ExtractNumberArraySchema.safeParse(parsed);
    if (!result.success) assert.fail(`schema invalid: ${result.error.message}`);
    assert.deepStrictEqual(result.data, [1, 2, 3]);
  });

  it("returns null when no opening bracket", () => {
    assert.strictEqual(extractJsonArray("no array"), null);
  });
});
