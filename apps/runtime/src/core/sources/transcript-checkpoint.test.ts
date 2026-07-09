import { describe, it } from "vitest";
import assert from "node:assert";
import {
  parseTranscriptCheckpoint,
  serializeTranscriptCheckpoint,
} from "./transcript-checkpoint.js";

describe("transcript-checkpoint", () => {
  it("returns null for null or empty string", () => {
    assert.strictEqual(parseTranscriptCheckpoint(null), null);
    assert.strictEqual(parseTranscriptCheckpoint(""), null);
  });

  it("parses v1 offset format", () => {
    assert.deepStrictEqual(parseTranscriptCheckpoint('{"v":1,"offset":100}'), {
      offset: 100,
    });
    assert.deepStrictEqual(parseTranscriptCheckpoint('{"v":1,"offset":0}'), {
      offset: 0,
    });
  });

  it("returns null for invalid JSON or wrong shape", () => {
    assert.strictEqual(parseTranscriptCheckpoint("x"), null);
    assert.strictEqual(parseTranscriptCheckpoint("{}"), null);
    assert.strictEqual(parseTranscriptCheckpoint('{"v":2,"offset":1}'), null);
  });

  it("serializes offset and round-trips", () => {
    const s = serializeTranscriptCheckpoint(123);
    assert.ok(s.includes("123"));
    assert.deepStrictEqual(parseTranscriptCheckpoint(s), { offset: 123 });
  });
});
