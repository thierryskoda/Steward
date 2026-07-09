/**
 * Readiness gate: blocks non-health/non-status routes until runtime state is "running", returns 503 with init phase.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { createReadinessGate } from "./readiness-gate.js";
import { ROUTES } from "@steward/contracts/routes";

describe("createReadinessGate", () => {
  it("calls next() for health path when state is not running", () => {
    const getRuntimeStatus = () => ({ state: "starting" });
    const gate = createReadinessGate(getRuntimeStatus);
    let nextCalled = false;
    const req = { path: ROUTES.HEALTH.path } as Parameters<typeof gate>[0];
    const res = { status: () => ({ json: () => {} }) } as unknown as Parameters<typeof gate>[1];
    const next = () => {
      nextCalled = true;
    };
    gate(req, res, next);
    assert.strictEqual(nextCalled, true);
  });

  it("calls next() for runtime status path when state is not running", () => {
    const getRuntimeStatus = () => ({ state: "starting" });
    const gate = createReadinessGate(getRuntimeStatus);
    let nextCalled = false;
    const req = { path: ROUTES.RUNTIME_STATUS.path } as Parameters<typeof gate>[0];
    const res = { status: () => ({ json: () => {} }) } as unknown as Parameters<typeof gate>[1];
    const next = () => {
      nextCalled = true;
    };
    gate(req, res, next);
    assert.strictEqual(nextCalled, true);
  });

  it("returns 503 with SERVICE_UNAVAILABLE for feature path when state is not running", () => {
    const getRuntimeStatus = () => ({ state: "starting", phase: "migration" });
    const gate = createReadinessGate(getRuntimeStatus);
    let statusCode: number | undefined;
    let body: unknown;
    const req = { path: ROUTES.INBOX_FINDINGS.path } as Parameters<typeof gate>[0];
    const res = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (payload: unknown) => {
            body = payload;
          },
        };
      },
    } as unknown as Parameters<typeof gate>[1];
    const next = () => {};
    gate(req, res, next);
    assert.strictEqual(statusCode, 503);
    assert.strictEqual(
      (body as { error: { code: string; message: string } })?.error?.code,
      "SERVICE_UNAVAILABLE"
    );
    assert.ok(
      (body as { error: { message: string } })?.error?.message?.includes(
        "Runtime not ready (migration)"
      )
    );
  });

  it("calls next() for feature path when state is running", () => {
    const getRuntimeStatus = () => ({ state: "running" });
    const gate = createReadinessGate(getRuntimeStatus);
    let nextCalled = false;
    const req = { path: ROUTES.INBOX_FINDINGS.path } as Parameters<typeof gate>[0];
    const res = { status: () => ({ json: () => {} }) } as unknown as Parameters<typeof gate>[1];
    const next = () => {
      nextCalled = true;
    };
    gate(req, res, next);
    assert.strictEqual(nextCalled, true);
  });

  it("when state is needs-config, allows CONFIG_GET and CONFIG_INITIALIZE and blocks feature paths", () => {
    const getRuntimeStatus = () => ({ state: "needs-config" });
    const gate = createReadinessGate(getRuntimeStatus);
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };
    const reqConfigGet = { path: ROUTES.CONFIG_GET.path } as Parameters<typeof gate>[0];
    const reqConfigInit = { path: ROUTES.CONFIG_INITIALIZE.path } as Parameters<typeof gate>[0];
    const resPass = { status: () => ({ json: () => {} }) } as unknown as Parameters<typeof gate>[1];
    gate(reqConfigGet, resPass, next);
    assert.strictEqual(nextCalled, true);
    nextCalled = false;
    gate(reqConfigInit, resPass, next);
    assert.strictEqual(nextCalled, true);
    nextCalled = false;
    let statusCode: number | undefined;
    const resBlock = {
      status: (code: number) => {
        statusCode = code;
        return { json: () => {} };
      },
    } as unknown as Parameters<typeof gate>[1];
    const reqInbox = { path: ROUTES.INBOX_FINDINGS.path } as Parameters<typeof gate>[0];
    gate(reqInbox, resBlock, next);
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(statusCode, 503);
  });
});
