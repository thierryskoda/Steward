import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let appDataRoot = "";

vi.mock("../../core/project-key.js", () => ({
  getAppDataRoot: (): string => appDataRoot,
}));

import {
  acquireDocumentationRefreshLease,
  getDocumentationRefreshLeasePath,
  releaseDocumentationRefreshLease,
} from "./documentation-refresh-lease.js";

const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";
const OWNER_A = "runtime-a";
const OWNER_B = "runtime-b";

describe("documentation refresh global lease", () => {
  beforeEach((): void => {
    appDataRoot = mkdtempSync(join(tmpdir(), "steward-documentation-refresh-lease-"));
  });

  afterEach((): void => {
    rmSync(appDataRoot, { recursive: true, force: true });
  });

  it("allows only one active owner and releases only for the matching owner and run", () => {
    const first = acquireDocumentationRefreshLease({
      ownerId: OWNER_A,
      projectKey: "project-a",
      runId: RUN_A,
      pid: process.pid,
      now: 1_000,
      ttlMs: 60_000,
    });
    expect(first.acquired).toBe(true);
    if (!first.acquired) return;

    const second = acquireDocumentationRefreshLease({
      ownerId: OWNER_B,
      projectKey: "project-b",
      runId: RUN_B,
      pid: process.pid,
      now: 2_000,
      ttlMs: 60_000,
    });
    expect(second).toEqual({ acquired: false, holder: first.lease });

    expect(releaseDocumentationRefreshLease({ ownerId: OWNER_B, runId: RUN_B })).toBe(false);
    expect(releaseDocumentationRefreshLease({ ownerId: OWNER_A, runId: RUN_A })).toBe(true);

    const afterRelease = acquireDocumentationRefreshLease({
      ownerId: OWNER_B,
      projectKey: "project-b",
      runId: RUN_B,
      pid: process.pid,
      now: 3_000,
      ttlMs: 60_000,
    });
    expect(afterRelease.acquired).toBe(true);
  });

  it("reclaims expired and dead owners while preserving restrictive, metadata-only contents", () => {
    const expired = acquireDocumentationRefreshLease({
      ownerId: OWNER_A,
      projectKey: "project-a",
      runId: RUN_A,
      pid: process.pid,
      now: 1_000,
      ttlMs: 1_000,
    });
    expect(expired.acquired).toBe(true);

    const reclaimedExpired = acquireDocumentationRefreshLease({
      ownerId: OWNER_B,
      projectKey: "project-b",
      runId: RUN_B,
      pid: process.pid,
      now: 2_001,
      ttlMs: 1_000,
    });
    expect(reclaimedExpired.acquired).toBe(true);
    if (!reclaimedExpired.acquired) return;
    expect(reclaimedExpired.lease.ownerId).toBe(OWNER_B);
    expect(releaseDocumentationRefreshLease({ ownerId: OWNER_B, runId: RUN_B })).toBe(true);

    const dead = acquireDocumentationRefreshLease({
      ownerId: OWNER_A,
      projectKey: "project-a",
      runId: RUN_A,
      pid: 2_147_483_647,
      now: 3_000,
      ttlMs: 60_000,
    });
    expect(dead.acquired).toBe(true);
    const reclaimedDead = acquireDocumentationRefreshLease({
      ownerId: OWNER_B,
      projectKey: "project-b",
      runId: RUN_B,
      pid: process.pid,
      now: 3_001,
      ttlMs: 60_000,
    });
    expect(reclaimedDead.acquired).toBe(true);

    const leasePath = getDocumentationRefreshLeasePath();
    expect(statSync(appDataRoot).mode & 0o777).toBe(0o700);
    expect(statSync(leasePath).mode & 0o777).toBe(0o600);
    const leaseJson = readFileSync(leasePath, "utf8");
    expect(leaseJson).not.toContain("projectRoot");
    expect(leaseJson).not.toContain("prompt");
    expect(leaseJson).not.toContain("source");
    expect(Object.keys(JSON.parse(leaseJson))).toEqual([
      "version",
      "ownerId",
      "projectKey",
      "runId",
      "pid",
      "acquiredAt",
      "expiresAt",
    ]);
  });
});
