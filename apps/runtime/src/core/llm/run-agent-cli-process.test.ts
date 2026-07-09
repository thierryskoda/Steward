/**
 * Tests for Agent CLI queue: bounded concurrency (max 3), FIFO start order, and shutdown.
 */
import { beforeAll, describe, it, vi } from "vitest";
import assert from "node:assert";
import type { ChildProcess } from "child_process";
import { DEFAULT_LLM_MODEL } from "./llm-defaults.js";
import {
  runAgentCliProcess,
  shutdownAgentQueue,
  type IAgentProcessConfig,
} from "./run-agent-cli-process.js";

type SpawnImpl = (cmd: string, argsOrOptions?: unknown) => ChildProcess;
const mockSpawnRef = vi.hoisted(() => ({ current: (() => null) as unknown as SpawnImpl }));
vi.mock("child_process", () => ({
  spawn: (cmd: string, argsOrOptions?: unknown) => mockSpawnRef.current(cmd, argsOrOptions),
}));

const BASE_CONFIG: IAgentProcessConfig = {
  timeoutMs: 60_000,
  watchdogIdleMs: 30_000,
  killGraceMs: 5_000,
};

function createFakeProcess(
  exitCode: number,
  delayMs = 0,
  args?: { stdoutText?: string; stderrText?: string; onClose?: () => void }
): ChildProcess {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const stdoutListeners: Array<(chunk: Buffer) => void> = [];
  const stderrListeners: Array<(chunk: Buffer) => void> = [];
  const on = (ev: string, cb: (...args: unknown[]) => void) => {
    if (!listeners[ev]) listeners[ev] = [];
    listeners[ev].push(cb);
    return {} as ChildProcess;
  };
  const emitClose = () => {
    args?.onClose?.();
    const stdoutText = args?.stdoutText ?? "";
    const stderrText = args?.stderrText ?? "";
    if (stdoutText.length > 0) {
      const chunk = Buffer.from(stdoutText, "utf-8");
      stdoutListeners.forEach((cb) => cb(chunk));
    }
    if (stderrText.length > 0) {
      const chunk = Buffer.from(stderrText, "utf-8");
      stderrListeners.forEach((cb) => cb(chunk));
    }
    const cbs = listeners["close"] ?? [];
    cbs.forEach((cb) => cb(exitCode, null));
  };
  const fakeProc = {
    pid: 12345,
    stdout: {
      on: (event: string, cb: (chunk: Buffer) => void) => {
        if (event === "data") stdoutListeners.push(cb);
        return fakeProc;
      },
    },
    stderr: {
      on: (event: string, cb: (chunk: Buffer) => void) => {
        if (event === "data") stderrListeners.push(cb);
        return fakeProc;
      },
    },
    on,
    removeAllListeners: () => {},
    kill: () => {},
  } as unknown as ChildProcess;
  if (delayMs > 0) {
    setTimeout(emitClose, delayMs);
  } else {
    setImmediate(emitClose);
  }
  return fakeProc;
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
vi.mock("../logger.js", () => ({ getRuntimeLogger: () => mockLogger }));

if (!process.env.CTO_TARGET_PROJECT_ROOT) {
  process.env.CTO_TARGET_PROJECT_ROOT = "/tmp/cto-agent-test";
}
if (process.env.CTO_AGENT_MAX_CONCURRENCY === undefined) {
  process.env.CTO_AGENT_MAX_CONCURRENCY = "3";
}

describe("runAgentCliProcess queue", () => {
  beforeAll(() => {
    mockSpawnRef.current = ((_cmd: string, _argsOrOptions?: unknown) =>
      createFakeProcess(0, 10, {
        stdoutText:
          '{"type":"result","subtype":"success","is_error":false,"duration_ms":12,"duration_api_ms":12,"result":"ok"}',
      })) as SpawnImpl;
  });

  it("returns exit result with parsed stdout when single request completes", async () => {
    const result = await runAgentCliProcess({
      prompt: "test",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp",
      config: BASE_CONFIG,
      executionMode: "ask",
      resumeChatId: undefined,
    });
    assert.strictEqual(result.reason, "exit");
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, "ok");
  });

  it("treats exit 0 with empty stdout as no-findings (resilience for Cursor CLI)", async () => {
    mockSpawnRef.current = ((_cmd: string, _argsOrOptions?: unknown) =>
      createFakeProcess(0, 10, { stdoutText: "", stderrText: "" })) as SpawnImpl;
    const result = await runAgentCliProcess({
      prompt: "test",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp",
      config: BASE_CONFIG,
      executionMode: "ask",
      resumeChatId: undefined,
    });
    assert.strictEqual(result.reason, "exit");
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, "");
  });

  it("completes three concurrent requests with exit and distinct results in start order", async () => {
    mockSpawnRef.current = ((_cmd: string, argsOrOptions?: unknown) => {
      const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
      const printIdx = args.indexOf("--print");
      const prompt = printIdx >= 0 ? (args[printIdx + 1] ?? "") : "";
      const result =
        prompt === "first" ? "first-out" : prompt === "second" ? "second-out" : "third-out";
      return createFakeProcess(0, 10, {
        stdoutText: `{"type":"result","subtype":"success","is_error":false,"duration_ms":12,"result":"${result}"}`,
      });
    }) as SpawnImpl;

    const p1 = runAgentCliProcess({
      prompt: "first",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp",
      config: BASE_CONFIG,
      executionMode: "ask",
      resumeChatId: undefined,
    });
    const p2 = runAgentCliProcess({
      prompt: "second",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp",
      config: BASE_CONFIG,
      executionMode: "ask",
      resumeChatId: undefined,
    });
    const p3 = runAgentCliProcess({
      prompt: "third",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp",
      config: BASE_CONFIG,
      executionMode: "ask",
      resumeChatId: undefined,
    });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    assert.strictEqual(r1.reason, "exit");
    assert.strictEqual(r2.reason, "exit");
    assert.strictEqual(r3.reason, "exit");
    assert.strictEqual(r1.stdout, "first-out");
    assert.strictEqual(r2.stdout, "second-out");
    assert.strictEqual(r3.stdout, "third-out");
  });

  it("never exceeds max concurrency of 3 so at most three runs are in flight", async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;
    process.env.CTO_AGENT_MAX_CONCURRENCY = "3";
    vi.resetModules();
    const { runAgentCliProcess: runAgentConcurrency } = await import("./run-agent-cli-process.js");

    mockSpawnRef.current = ((_cmd: string, _argsOrOptions?: unknown) => {
      concurrentCount++;
      if (concurrentCount > maxConcurrent) maxConcurrent = concurrentCount;
      return createFakeProcess(0, 250, {
        stdoutText:
          '{"type":"result","subtype":"success","is_error":false,"duration_ms":12,"result":"ok"}',
        onClose: () => {
          concurrentCount--;
        },
      });
    }) as SpawnImpl;

    const promises = [1, 2, 3, 4, 5].map((i) =>
      runAgentConcurrency({
        prompt: `req-${i}`,
        model: DEFAULT_LLM_MODEL,
        workspace: "/tmp",
        config: BASE_CONFIG,
        executionMode: "ask",
        resumeChatId: undefined,
      })
    );

    const results = await Promise.all(promises);
    for (const r of results) {
      assert.strictEqual(r.reason, "exit");
    }
    assert.strictEqual(maxConcurrent, 3, "max concurrent spawns must not exceed 3");
  });

  it("throws when prompt exceeds size limit so oversized prompts are rejected before enqueue", () => {
    assert.throws(
      () =>
        runAgentCliProcess({
          prompt: "x".repeat(600_000),
          model: DEFAULT_LLM_MODEL,
          workspace: "/tmp",
          config: BASE_CONFIG,
          executionMode: "ask",
          resumeChatId: undefined,
        }),
      /Agent prompt too large/
    );
  });

  it("rejects stale queue item by age cap when wait exceeds max age", async () => {
    const prevQueueAgeMs = process.env.CTO_AGENT_MAX_QUEUE_AGE_MS;
    process.env.CTO_AGENT_MAX_QUEUE_AGE_MS = "10000";
    vi.resetModules();
    const mod = await import("./run-agent-cli-process.js");
    const runAgentWithAgeCap = mod.runAgentCliProcess;
    try {
      mockSpawnRef.current = ((_cmd: string, _argsOrOptions?: unknown) =>
        createFakeProcess(0, 12_000, {
          stdoutText:
            '{"type":"result","subtype":"success","is_error":false,"duration_ms":12,"result":"ok"}',
        })) as SpawnImpl;

      const [p1, p2, p3, p4] = [
        runAgentWithAgeCap({
          prompt: "first",
          model: DEFAULT_LLM_MODEL,
          workspace: "/tmp",
          config: BASE_CONFIG,
          executionMode: "ask",
          resumeChatId: undefined,
        }),
        runAgentWithAgeCap({
          prompt: "second",
          model: DEFAULT_LLM_MODEL,
          workspace: "/tmp",
          config: BASE_CONFIG,
          executionMode: "ask",
          resumeChatId: undefined,
        }),
        runAgentWithAgeCap({
          prompt: "third",
          model: DEFAULT_LLM_MODEL,
          workspace: "/tmp",
          config: BASE_CONFIG,
          executionMode: "ask",
          resumeChatId: undefined,
        }),
        runAgentWithAgeCap({
          prompt: "fourth",
          model: DEFAULT_LLM_MODEL,
          workspace: "/tmp",
          config: BASE_CONFIG,
          executionMode: "ask",
          resumeChatId: undefined,
        }),
      ];

      const p4Rejection = p4.then(
        () => {
          throw new Error("expected p4 to reject");
        },
        (e: unknown) => e
      );
      void p4.catch(() => {});

      const [r1, r2, r3, p4Result] = await Promise.all([p1, p2, p3, p4Rejection]);
      assert.strictEqual(r1.reason, "exit");
      assert.strictEqual(r2.reason, "exit");
      assert.strictEqual(r3.reason, "exit");
      assert.ok(p4Result instanceof Error, `expected Error, got ${typeof p4Result}`);
      assert.ok(
        (p4Result as Error).message.includes("Queue age"),
        `expected age cap rejection, got: ${(p4Result as Error).message}`
      );
      assert.ok(
        (p4Result as Error).message.includes("10000"),
        `expected max age in message, got: ${(p4Result as Error).message}`
      );
    } finally {
      if (prevQueueAgeMs !== undefined) process.env.CTO_AGENT_MAX_QUEUE_AGE_MS = prevQueueAgeMs;
      else delete process.env.CTO_AGENT_MAX_QUEUE_AGE_MS;
    }
  });
});

describe("runAgentCliProcess execution mode", () => {
  const spawnCalls: Array<{ args: string[] }> = [];

  beforeAll(() => {
    mockSpawnRef.current = ((_cmd: string, argsOrOptions?: unknown) => {
      const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
      spawnCalls.push({ args: [...args] });
      return createFakeProcess(0, 10, {
        stdoutText:
          '{"type":"result","subtype":"success","is_error":false,"duration_ms":12,"result":"ok"}',
      });
    }) as SpawnImpl;
  });

  it("spawn args reflect executionMode (force vs ask)", async () => {
    spawnCalls.length = 0;
    await runAgentCliProcess({
      prompt: "force",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp",
      config: BASE_CONFIG,
      executionMode: "force",
      resumeChatId: undefined,
    });
    await runAgentCliProcess({
      prompt: "ask",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp",
      config: BASE_CONFIG,
      executionMode: "ask",
      resumeChatId: undefined,
    });

    assert.strictEqual(spawnCalls.length, 2);
    const forceArgs = spawnCalls[0]?.args ?? [];
    const askArgs = spawnCalls[1]?.args ?? [];

    assert.ok(forceArgs.includes("--force"));
    assert.strictEqual(forceArgs.indexOf("--mode"), -1);
    assert.ok(askArgs.indexOf("--mode") >= 0 && askArgs[askArgs.indexOf("--mode") + 1] === "ask");
    assert.ok(!askArgs.includes("--force"));
  });
});

describe("runAgentCliProcess shutdown", () => {
  let runAgentCli: typeof runAgentCliProcess;
  let shutdownQueue: typeof shutdownAgentQueue;

  beforeAll(async () => {
    vi.resetModules();
    const mod = await import("./run-agent-cli-process.js");
    runAgentCli = mod.runAgentCliProcess;
    shutdownQueue = mod.shutdownAgentQueue;
    mockSpawnRef.current = ((_cmd: string, _argsOrOptions?: unknown) =>
      createFakeProcess(0, 10, {
        stdoutText:
          '{"type":"result","subtype":"success","is_error":false,"duration_ms":12,"result":"ok"}',
      })) as SpawnImpl;
  });

  it("cancels active and claimed on timeout so callers get shutdown_cancelled", async () => {
    mockSpawnRef.current = ((_cmd: string, _argsOrOptions?: unknown) =>
      createFakeProcess(0, 500, {
        stdoutText:
          '{"type":"result","subtype":"success","is_error":false,"duration_ms":12,"result":"ok"}',
      })) as SpawnImpl;

    const [p1, p2, p3, p4] = [
      runAgentCli({
        prompt: "slow-1",
        model: DEFAULT_LLM_MODEL,
        workspace: "/tmp",
        config: BASE_CONFIG,
        executionMode: "ask",
        resumeChatId: undefined,
        requestContext: {
          agentId: "slow-agent",
          categoryId: "cat",
          itemId: "id",
        },
      }),
      runAgentCli({
        prompt: "slow-2",
        model: DEFAULT_LLM_MODEL,
        workspace: "/tmp",
        config: BASE_CONFIG,
        executionMode: "ask",
        resumeChatId: undefined,
        requestContext: {
          agentId: "slow-agent-2",
          categoryId: "cat2",
          itemId: "id2",
        },
      }),
      runAgentCli({
        prompt: "slow-3",
        model: DEFAULT_LLM_MODEL,
        workspace: "/tmp",
        config: BASE_CONFIG,
        executionMode: "ask",
        resumeChatId: undefined,
        requestContext: {
          agentId: "slow-agent-3",
          categoryId: "cat3",
          itemId: "id3",
        },
      }),
      runAgentCli({
        prompt: "claimed-waiting",
        model: DEFAULT_LLM_MODEL,
        workspace: "/tmp",
        config: BASE_CONFIG,
        executionMode: "ask",
        resumeChatId: undefined,
        requestContext: {
          agentId: "claimed-agent",
          categoryId: "cat4",
          itemId: "id4",
        },
      }),
    ];

    const p4Rejection = p4.then(
      () => {
        throw new Error("expected p4 to reject");
      },
      (e: unknown) => e
    );
    await shutdownQueue({ timeoutMs: 50 });

    const [r1, r2, r3, p4Result] = await Promise.all([p1, p2, p3, p4Rejection]);
    assert.strictEqual(r1.reason, "shutdown_cancelled");
    assert.strictEqual(r2.reason, "shutdown_cancelled");
    assert.strictEqual(r3.reason, "shutdown_cancelled");
    assert.ok(
      p4Result instanceof Error && (p4Result as Error).message.includes("cancelled during shutdown")
    );
  });

  it("drains in-flight request before shutdown so active work completes", async () => {
    vi.resetModules();
    const mod = await import("./run-agent-cli-process.js");
    runAgentCli = mod.runAgentCliProcess;
    shutdownQueue = mod.shutdownAgentQueue;
    mockSpawnRef.current = ((_cmd: string, _argsOrOptions?: unknown) =>
      createFakeProcess(0, 10, {
        stdoutText:
          '{"type":"result","subtype":"success","is_error":false,"duration_ms":12,"result":"ok"}',
      })) as SpawnImpl;
    const p1 = runAgentCli({
      prompt: "drain-first",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp",
      config: BASE_CONFIG,
      executionMode: "ask",
      resumeChatId: undefined,
      requestContext: {
        agentId: "test-agent",
        categoryId: "test-cat",
        itemId: "item-1",
      },
    });
    const r1 = await p1;
    assert.strictEqual(r1.reason, "exit");
    assert.strictEqual(r1.stdout, "ok");
    await shutdownQueue({ timeoutMs: 5_000 });
  });

  it("rejects enqueue after shutdown so callers get rejection", async () => {
    await shutdownQueue({ timeoutMs: 100 });
    await assert.rejects(
      runAgentCli({
        prompt: "after-shutdown",
        model: DEFAULT_LLM_MODEL,
        workspace: "/tmp",
        config: BASE_CONFIG,
        executionMode: "ask",
        resumeChatId: undefined,
      }),
      /Agent queue is shutting down/
    );
  });

  it("resumes queue after calling resumeAgentQueue", async () => {
    vi.resetModules();
    const mod = await import("./run-agent-cli-process.js");
    const runAgentCliLocal = mod.runAgentCliProcess;
    const shutdownQueueLocal = mod.shutdownAgentQueue;
    const resumeQueueLocal = mod.resumeAgentQueue;
    mockSpawnRef.current = ((_cmd: string, _argsOrOptions?: unknown) =>
      createFakeProcess(0, 10, {
        stdoutText:
          '{"type":"result","subtype":"success","is_error":false,"duration_ms":12,"result":"ok"}',
      })) as SpawnImpl;

    await shutdownQueueLocal({ timeoutMs: 100 });
    resumeQueueLocal();
    const result = await runAgentCliLocal({
      prompt: "after-resume",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp",
      config: BASE_CONFIG,
      executionMode: "ask",
      resumeChatId: undefined,
    });
    assert.strictEqual(result.reason, "exit");
    assert.strictEqual(result.stdout, "ok");
  });
});
