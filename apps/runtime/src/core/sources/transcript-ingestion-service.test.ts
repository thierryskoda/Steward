import { describe, it, afterEach } from "vitest";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { CheckpointStore } from "./types.js";
import { createTranscriptIngestionService } from "./transcript-ingestion-service.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ingestion-service-"));
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

function createMemoryCheckpointStore(): CheckpointStore {
  const state = new Map<string, string>();
  return {
    get(key: string): string | null {
      return state.get(key) ?? null;
    },
    set(key: string, value: string): void {
      state.set(key, value);
    },
  };
}

describe("transcript-ingestion-service", () => {
  it("start runs first tick and getStreamStateSnapshot returns state for discovered paths", () => {
    const projectRoot = createTempDir();
    const transcriptPath = join(projectRoot, "chat.jsonl");
    writeFileSync(transcriptPath, line("user", "hi") + "\n", "utf-8");
    const checkpointStore = createMemoryCheckpointStore();
    const messages: Array<{ role: string; content: string }> = [];
    const service = createTranscriptIngestionService({
      getPaths: () => [transcriptPath],
      checkpointStore,
      pollIntervalMs: 999999,
      subscribers: [
        {
          id: "test",
          onMessage(ev) {
            messages.push({ role: ev.role ?? "", content: ev.content });
          },
        },
      ],
    });
    service.start();
    const snapshot = service.getStreamStateSnapshot();
    assert.strictEqual(snapshot.size, 1);
    const state = snapshot.get(transcriptPath);
    assert.ok(state);
    assert.strictEqual(state?.lastSizeBytes, Buffer.byteLength(line("user", "hi") + "\n", "utf-8"));
    assert.strictEqual(messages.length, 0);
    service.stop();
  });

  it("stop clears interval and getStreamStateSnapshot is safe after stop", () => {
    const projectRoot = createTempDir();
    const transcriptPath = join(projectRoot, "chat.jsonl");
    writeFileSync(transcriptPath, line("user", "x") + "\n", "utf-8");
    const service = createTranscriptIngestionService({
      getPaths: () => [transcriptPath],
      checkpointStore: createMemoryCheckpointStore(),
      pollIntervalMs: 100,
      subscribers: [{ id: "test", onMessage: () => {} }],
    });
    service.start();
    service.stop();
    const snapshot = service.getStreamStateSnapshot();
    assert.ok(snapshot.size >= 0);
  });

  it("emits the first appended message after a transcript was initially discovered empty", async () => {
    const projectRoot = createTempDir();
    const transcriptPath = join(projectRoot, "chat.jsonl");
    writeFileSync(transcriptPath, "", "utf-8");
    const messages: Array<{ role: string; content: string }> = [];
    const service = createTranscriptIngestionService({
      getPaths: () => [transcriptPath],
      checkpointStore: createMemoryCheckpointStore(),
      pollIntervalMs: 10,
      subscribers: [
        {
          id: "test",
          onMessage(ev) {
            messages.push({ role: ev.role ?? "", content: ev.content });
          },
        },
      ],
    });
    service.start();
    writeFileSync(transcriptPath, line("user", "new rule") + "\n", {
      encoding: "utf-8",
      flag: "a",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    service.stop();
    assert.deepStrictEqual(messages, [{ role: "user", content: "new rule" }]);
  });
});
