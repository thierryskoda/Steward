/**
 * Cross-process lease for documentation Codex runs. The owner-only file contains
 * coordination metadata only and is created atomically with an exclusive open.
 */
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { AppError } from "../../core/app-error.js";
import { RESTRICTIVE_DIR_MODE, RESTRICTIVE_FILE_MODE } from "../../core/app-data-permissions.js";
import { ERR_DOCUMENTATION_REFRESH_LEASE } from "../../core/error-codes.js";
import { parseJsonWithSchemaResult } from "../../core/json-schema-file.js";
import { getAppDataRoot } from "../../core/project-key.js";
import {
  DOCUMENTATION_REFRESH_LEASE_VERSION,
  DocumentationRefreshLeaseSchema,
  type IDocumentationRefreshLease,
} from "./documentation-refresh-lease.schemas.js";

const LEASE_FILENAME = "documentation-refresh-lease.json";
const MIN_LEASE_TTL_MS = 1_000;
const MAX_LEASE_TTL_MS = 10 * 60 * 1_000;
const ACQUIRE_ATTEMPT_LIMIT = 4;

export type IDocumentationRefreshLeaseAcquireResult =
  | { acquired: true; lease: IDocumentationRefreshLease }
  | { acquired: false; holder: IDocumentationRefreshLease };

export function getDocumentationRefreshLeasePath(): string {
  return join(getAppDataRoot(), LEASE_FILENAME);
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === expectedCode
  );
}

function ensureLeaseDirectory(): void {
  const appDataRoot = getAppDataRoot();
  mkdirSync(appDataRoot, { recursive: true, mode: RESTRICTIVE_DIR_MODE });
  chmodSync(appDataRoot, RESTRICTIVE_DIR_MODE);
}

function readLease(): IDocumentationRefreshLease | null {
  const leasePath = getDocumentationRefreshLeasePath();
  if (!existsSync(leasePath)) return null;
  let raw: string;
  try {
    raw = readFileSync(leasePath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw new AppError(
      "Documentation refresh lease could not be read",
      ERR_DOCUMENTATION_REFRESH_LEASE,
      { leasePath, reason: "read_failed" },
      { cause: error }
    );
  }
  const parsed = parseJsonWithSchemaResult(raw, DocumentationRefreshLeaseSchema);
  if (!parsed.ok) {
    throw new AppError(
      "Documentation refresh lease is invalid and requires manual removal",
      ERR_DOCUMENTATION_REFRESH_LEASE,
      { leasePath, reason: parsed.reason, details: parsed.details }
    );
  }
  return parsed.data;
}

function writeLeaseExclusive(lease: IDocumentationRefreshLease): void {
  const leasePath = getDocumentationRefreshLeasePath();
  let fileDescriptor: number | undefined;
  try {
    fileDescriptor = openSync(leasePath, "wx", RESTRICTIVE_FILE_MODE);
    writeFileSync(fileDescriptor, JSON.stringify(lease), "utf8");
    fsyncSync(fileDescriptor);
    chmodSync(leasePath, RESTRICTIVE_FILE_MODE);
  } catch (error) {
    if (fileDescriptor !== undefined) {
      try {
        unlinkSync(leasePath);
      } catch {
        // The incomplete exclusive file may already have been removed.
      }
    }
    throw error;
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasErrorCode(error, "EPERM");
  }
}

function isActiveLease(lease: IDocumentationRefreshLease, now: number): boolean {
  return lease.expiresAt > now && isProcessAlive(lease.pid);
}

function removeLeaseIfUnchanged(expected: IDocumentationRefreshLease): boolean {
  const current = readLease();
  if (current === null || JSON.stringify(current) !== JSON.stringify(expected)) return false;
  try {
    unlinkSync(getDocumentationRefreshLeasePath());
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw new AppError(
      "Stale documentation refresh lease could not be removed",
      ERR_DOCUMENTATION_REFRESH_LEASE,
      {
        leasePath: getDocumentationRefreshLeasePath(),
        ownerId: expected.ownerId,
        runId: expected.runId,
        reason: "unlink_failed",
      },
      { cause: error }
    );
  }
}

export function acquireDocumentationRefreshLease(args: {
  ownerId: string;
  projectKey: string;
  runId: string;
  pid: number;
  now: number;
  ttlMs: number;
}): IDocumentationRefreshLeaseAcquireResult {
  if (args.ttlMs < MIN_LEASE_TTL_MS || args.ttlMs > MAX_LEASE_TTL_MS) {
    throw new AppError(
      "Documentation refresh lease TTL is outside the finite allowed range",
      ERR_DOCUMENTATION_REFRESH_LEASE,
      {
        ttlMs: args.ttlMs,
        minTtlMs: MIN_LEASE_TTL_MS,
        maxTtlMs: MAX_LEASE_TTL_MS,
      }
    );
  }
  ensureLeaseDirectory();
  const lease = DocumentationRefreshLeaseSchema.parse({
    version: DOCUMENTATION_REFRESH_LEASE_VERSION,
    ownerId: args.ownerId,
    projectKey: args.projectKey,
    runId: args.runId,
    pid: args.pid,
    acquiredAt: args.now,
    expiresAt: args.now + args.ttlMs,
  });

  for (let attempt = 0; attempt < ACQUIRE_ATTEMPT_LIMIT; attempt += 1) {
    try {
      writeLeaseExclusive(lease);
      return { acquired: true, lease };
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        throw new AppError(
          "Documentation refresh lease could not be acquired",
          ERR_DOCUMENTATION_REFRESH_LEASE,
          {
            leasePath: getDocumentationRefreshLeasePath(),
            ownerId: args.ownerId,
            runId: args.runId,
            reason: "exclusive_create_failed",
          },
          { cause: error }
        );
      }
    }

    const holder = readLease();
    if (holder === null) continue;
    if (isActiveLease(holder, args.now)) return { acquired: false, holder };
    removeLeaseIfUnchanged(holder);
  }

  const holder = readLease();
  if (holder !== null) return { acquired: false, holder };
  throw new AppError(
    "Documentation refresh lease acquisition exhausted its contention budget",
    ERR_DOCUMENTATION_REFRESH_LEASE,
    {
      leasePath: getDocumentationRefreshLeasePath(),
      ownerId: args.ownerId,
      runId: args.runId,
      attemptLimit: ACQUIRE_ATTEMPT_LIMIT,
    }
  );
}

export function releaseDocumentationRefreshLease(args: {
  ownerId: string;
  runId: string;
}): boolean {
  const lease = readLease();
  if (lease === null || lease.ownerId !== args.ownerId || lease.runId !== args.runId) {
    return false;
  }
  return removeLeaseIfUnchanged(lease);
}
