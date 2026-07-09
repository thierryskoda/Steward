/**
 * Request-id middleware: accepts x-request-id when valid, generates UUID when absent, echoes in response.
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert";
import { requestIdMiddleware } from "./request-id.js";

describe("requestIdMiddleware", () => {
  it("assigns generated requestId when no x-request-id header", () => {
    const middleware = requestIdMiddleware();
    const req = { get: (_: string) => undefined } as Parameters<typeof middleware>[0];
    const res = { setHeader: vi.fn() } as unknown as Parameters<typeof middleware>[1];
    const next = vi.fn();
    middleware(req, res, next);
    assert.strictEqual(typeof req.requestId, "string");
    const id = req.requestId!;
    assert.ok(id.length > 0);
    const setHeaderCalls = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls;
    assert.ok(setHeaderCalls[0]);
    assert.strictEqual(setHeaderCalls[0]![0], "x-request-id");
    assert.strictEqual(setHeaderCalls[0]![1], id);
    assert.strictEqual(next.mock.calls.length, 1);
  });

  it("uses incoming x-request-id when present and non-empty", () => {
    const middleware = requestIdMiddleware();
    const incomingId = "my-correlation-id-123";
    const req = {
      get: (h: string) => (h === "x-request-id" ? incomingId : undefined),
    } as Parameters<typeof middleware>[0];
    const res = { setHeader: vi.fn() } as unknown as Parameters<typeof middleware>[1];
    const next = vi.fn();
    middleware(req, res, next);
    assert.strictEqual(req.requestId!, incomingId);
    const setHeaderCalls1 = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls;
    assert.ok(setHeaderCalls1[0]);
    assert.strictEqual(setHeaderCalls1[0]![1], incomingId);
    assert.strictEqual(next.mock.calls.length, 1);
  });

  it("trims and uses incoming x-request-id", () => {
    const middleware = requestIdMiddleware();
    const req = {
      get: (h: string) => (h === "x-request-id" ? "  trimmed-id  " : undefined),
    } as Parameters<typeof middleware>[0];
    const res = { setHeader: vi.fn() } as unknown as Parameters<typeof middleware>[1];
    const next = vi.fn();
    middleware(req, res, next);
    assert.strictEqual(req.requestId!, "trimmed-id");
    const setHeaderCalls2 = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls;
    assert.ok(setHeaderCalls2[0]);
    assert.strictEqual(setHeaderCalls2[0]![1], "trimmed-id");
  });

  it("generates when x-request-id is empty string", () => {
    const middleware = requestIdMiddleware();
    const req = { get: (h: string) => (h === "x-request-id" ? "" : undefined) } as Parameters<
      typeof middleware
    >[0];
    const res = { setHeader: vi.fn() } as unknown as Parameters<typeof middleware>[1];
    const next = vi.fn();
    middleware(req, res, next);
    assert.strictEqual(typeof req.requestId, "string");
    const id2 = req.requestId!;
    assert.ok(id2.length > 0);
    const setHeaderCalls3 = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls;
    assert.ok(setHeaderCalls3[0]);
    assert.strictEqual(setHeaderCalls3[0]![1], id2);
  });

  it("echoes final requestId in response x-request-id header", () => {
    const middleware = requestIdMiddleware();
    const req = { get: () => undefined } as unknown as Parameters<typeof middleware>[0];
    const setHeader = vi.fn();
    const res = { setHeader } as unknown as Parameters<typeof middleware>[1];
    const next = vi.fn();
    middleware(req, res, next);
    assert.strictEqual(setHeader.mock.calls.length, 1);
    const call = setHeader.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call[0], "x-request-id");
    assert.strictEqual(call[1], req.requestId!);
  });
});
