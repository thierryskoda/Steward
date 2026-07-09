/**
 * Items route: status normalization and response shape.
 */
import { describe, it, vi, type Mock } from "vitest";
import assert from "node:assert";
import { normalizeStatus } from "./items.routes.js";
import { STATUS } from "@steward/contracts/schemas";
import { getRuntimeLogger } from "../../core/logger.js";

type ILogWithMocks = ReturnType<typeof getRuntimeLogger> & {
  warn: Mock;
  info: Mock;
  error: Mock;
  child: Mock;
};

describe("normalizeStatus", () => {
  const mockLog: ILogWithMocks = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  } as ILogWithMocks;

  it("returns the same value when status is a valid segment", () => {
    assert.strictEqual(
      normalizeStatus(STATUS.IMPLEMENTED, mockLog, { type: "rule", id: "r1" }),
      STATUS.IMPLEMENTED
    );
    assert.strictEqual(
      normalizeStatus(STATUS.LEARNING_FROM_REJECTION, mockLog, { type: "finding", id: "f1" }),
      STATUS.LEARNING_FROM_REJECTION
    );
    assert.strictEqual(mockLog.warn.mock.calls.length, 0);
  });

  it("returns null and logs when status is undefined", () => {
    const out = normalizeStatus(undefined, mockLog, { type: "rule", id: "r2" });
    assert.strictEqual(out, null);
    assert.strictEqual(mockLog.error.mock.calls.length, 1);
    assert.deepStrictEqual(mockLog.error.mock.calls[0]![0], {
      event: "items_route_status_invalid_skipped",
      type: "rule",
      id: "r2",
      received: undefined,
    });
  });

  it("returns null and logs when status is not a valid segment", () => {
    mockLog.error.mockClear();
    const out = normalizeStatus("invalid", mockLog, { type: "finding", id: "f2" });
    assert.strictEqual(out, null);
    assert.strictEqual(mockLog.error.mock.calls.length, 1);
    assert.strictEqual(mockLog.error.mock.calls[0]![0].received, "invalid");
  });

  it("returns null when status is wrong type (e.g. number)", () => {
    mockLog.error.mockClear();
    const out = normalizeStatus(42, mockLog, { type: "rule", id: "r3" });
    assert.strictEqual(out, null);
    assert.strictEqual(mockLog.error.mock.calls.length, 1);
  });
});
