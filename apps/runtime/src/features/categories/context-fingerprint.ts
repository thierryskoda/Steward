/**
 * Stable fingerprint from rules and project-context snapshots so we can detect when
 * an item was created under different context and trigger revalidation.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadSnapshot } from "./rules-snapshot.js";

export type IRulesSnapshotMeta = { sourcesHash: string; extractorVersion: string };
export type IProjectContextSnapshotMeta = {
  sourcesHash: string;
  extractorVersion: string;
};

/**
 * Combined fingerprint from both snapshot metas. Returns null if either is null.
 */
export function computeContextFingerprint(
  rulesMeta: IRulesSnapshotMeta | null,
  projectContextMeta: IProjectContextSnapshotMeta | null
): string | null {
  if (!rulesMeta || !projectContextMeta) return null;
  const payload = [
    "rules",
    rulesMeta.sourcesHash,
    rulesMeta.extractorVersion,
    "projectContext",
    projectContextMeta.sourcesHash,
    projectContextMeta.extractorVersion,
  ].join("\n");
  return createHash("sha256").update(payload, "utf-8").digest("hex").slice(0, 32);
}

export type IGetCurrentContextFingerprintDeps = {
  loadProjectContextSnapshot: (projectRoot: string) => IProjectContextSnapshotMeta | null;
};

/**
 * Loads current rules and project-context snapshots and returns combined fingerprint.
 * Returns null if either snapshot is missing.
 */
export function getCurrentContextFingerprint(
  projectRoot: string,
  deps: IGetCurrentContextFingerprintDeps
): string | null {
  const rulesSnapshot = loadSnapshot(projectRoot);
  const rulesMeta: IRulesSnapshotMeta | null = rulesSnapshot
    ? {
        sourcesHash: rulesSnapshot.sourcesHash,
        extractorVersion: rulesSnapshot.extractorVersion,
      }
    : null;
  const contextMeta = deps.loadProjectContextSnapshot(projectRoot);
  return computeContextFingerprint(rulesMeta, contextMeta);
}

/**
 * Deterministic hash over location file paths and contents (or "missing:path" if file absent).
 * Sorted by path for stability.
 */
export function computeLocationsContentHash(projectRoot: string, locations: string[]): string {
  const sorted = [...locations]
    .map((p) => p.trim())
    .filter(Boolean)
    .sort();
  const parts: string[] = [];
  for (const rel of sorted) {
    const full = join(projectRoot, rel);
    if (existsSync(full)) {
      try {
        const content = readFileSync(full, "utf-8");
        parts.push(`${rel}\n${content}`);
      } catch {
        parts.push(`missing:${rel}`);
      }
    } else {
      parts.push(`missing:${rel}`);
    }
  }
  const payload = parts.join("\n---\n");
  return createHash("sha256").update(payload, "utf-8").digest("hex").slice(0, 32);
}

/**
 * Combines global (rules+context) fingerprint with locations content hash into one comparable string.
 */
export function combineContextFingerprintWithLocations(
  globalFingerprint: string,
  locationsHash: string
): string {
  const payload = `${globalFingerprint}\nlocations\n${locationsHash}`;
  return createHash("sha256").update(payload, "utf-8").digest("hex").slice(0, 32);
}

/**
 * Per-item fingerprint: global snapshot fingerprint + hash of this item's location files.
 * Returns null when global fingerprint is null (e.g. snapshots missing).
 */
export function getCurrentContextFingerprintForItem(
  projectRoot: string,
  item: { locations?: string[]; problem?: { locations: string[] } },
  deps: IGetCurrentContextFingerprintDeps
): string | null {
  const global = getCurrentContextFingerprint(projectRoot, deps);
  if (!global) return null;
  const locations =
    "problem" in item && item.problem ? item.problem.locations : (item.locations ?? []);
  const locationsHash = computeLocationsContentHash(projectRoot, locations);
  return combineContextFingerprintWithLocations(global, locationsHash);
}
