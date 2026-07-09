import { describe, it, afterEach } from "vitest";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readTranscriptAppend } from "./transcript-incremental-reader.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "transcript-reader-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function line(role: string, text: string): string {
  return JSON.stringify({
    role,
    message: { content: [{ type: "text", text }] },
  });
}

describe("transcript-incremental-reader", () => {
  it("returns no events and nextOffset = size when checkpoint is null (skip history)", () => {
    const dir = createTempDir();
    const path = join(dir, "t.jsonl");
    const content = line("user", "hi") + "\n" + line("assistant", "hello") + "\n";
    writeFileSync(path, content, "utf-8");
    const result = readTranscriptAppend(path, null, path);
    assert.strictEqual(result.events.length, 0);
    assert.strictEqual(result.nextOffset, Buffer.byteLength(content, "utf-8"));
  });

  it("returns events from offset and nextOffset at end", () => {
    const dir = createTempDir();
    const path = join(dir, "t.jsonl");
    const line1 = line("user", "first") + "\n";
    const line2 = line("assistant", "second") + "\n";
    writeFileSync(path, line1 + line2, "utf-8");
    const offset = Buffer.byteLength(line1, "utf-8");
    const result = readTranscriptAppend(path, { offset }, path);
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.events[0]?.content, "second");
    assert.strictEqual(result.nextOffset, Buffer.byteLength(line1 + line2, "utf-8"));
  });

  it("returns no events when path does not exist", () => {
    const dir = createTempDir();
    const result = readTranscriptAppend(join(dir, "missing.jsonl"), null, "x");
    assert.strictEqual(result.events.length, 0);
    assert.strictEqual(result.nextOffset, 0);
  });

  it("skips malformed lines and continues", () => {
    const dir = createTempDir();
    const path = join(dir, "t.jsonl");
    const good = line("user", "ok") + "\n";
    writeFileSync(path, good + "not json\n" + line("assistant", "yes") + "\n", "utf-8");
    const result = readTranscriptAppend(path, null, path);
    assert.strictEqual(result.events.length, 0);
    const result2 = readTranscriptAppend(path, { offset: Buffer.byteLength(good, "utf-8") }, path);
    assert.strictEqual(result2.events.length, 1);
    assert.strictEqual(result2.events[0]?.content, "yes");
  });
});
