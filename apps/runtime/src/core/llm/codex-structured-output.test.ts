import assert from "node:assert";
import { describe, it } from "vitest";
import {
  buildCodexStructuredOutputSchema,
  unwrapCodexStructuredOutput,
} from "./codex-structured-output.js";

describe("Codex structured-output envelope", () => {
  it("moves a root union under one required object property", () => {
    const schema = buildCodexStructuredOutputSchema({
      anyOf: [
        {
          type: "object",
          properties: { status: { type: "string", const: "clean" } },
          required: ["status"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { status: { type: "string", const: "drift" } },
          required: ["status"],
          additionalProperties: false,
        },
      ],
      $schema: "http://json-schema.org/draft-07/schema#",
    });

    assert.deepStrictEqual(schema, {
      type: "object",
      properties: {
        result: {
          anyOf: [
            {
              type: "object",
              properties: { status: { type: "string", const: "clean" } },
              required: ["status"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: { status: { type: "string", const: "drift" } },
              required: ["status"],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ["result"],
      additionalProperties: false,
      $schema: "http://json-schema.org/draft-07/schema#",
    });
  });

  it("unwraps the schema-only transport envelope and rejects other shapes", () => {
    assert.strictEqual(
      unwrapCodexStructuredOutput('{"result":{"status":"drift"}}'),
      '{"status":"drift"}'
    );
    assert.throws(() => unwrapCodexStructuredOutput('{"status":"drift"}'));
  });
});
