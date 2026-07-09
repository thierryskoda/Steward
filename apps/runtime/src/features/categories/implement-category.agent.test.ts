import { describe, it } from "vitest";
import assert from "node:assert";
import { implementCategoryAgent } from "./implement-category.agent.js";

describe("implement-category agent", () => {
  it("extractOutput strips markdown code fence and returns inner JSON", () => {
    const raw =
      '```json\n{"summary":"Done.","fileChanges":[{"path":"a.ts","bulletPoints":["x"]}],"checks":[]}\n```';
    const out = implementCategoryAgent.extractOutput?.(raw) ?? null;
    assert.strictEqual(typeof out, "string");
    const jsonRaw: unknown = JSON.parse(out as string);
    const parsed = implementCategoryAgent.outputSchema.parse(jsonRaw);
    assert.strictEqual(parsed.summary, "Done.");
  });

  it("extractOutput returns trimmed string when no fence", () => {
    const raw = '  {"summary":"Done.","fileChanges":[],"checks":[]}  ';
    const out = implementCategoryAgent.extractOutput?.(raw) ?? null;
    assert.strictEqual(typeof out, "string");
    assert.ok((out as string).startsWith("{"));
    assert.ok((out as string).endsWith("}"));
  });
});
