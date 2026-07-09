/**
 * Read global project runtime registry. Used to list running projects and resolve endpoints.
 */
import fs from "fs";
import path from "path";
import { RegistryFileSchema, type IRegistryEntry } from "@steward/contracts/schemas";
import { REGISTRY_FILENAME } from "@steward/contracts/runtime-defaults";
import { appDataPath } from "./paths.js";
import { getProjectKey } from "./project-key.js";

export function readRegistry(): IRegistryEntry[] {
  const registryPath = path.join(appDataPath(), REGISTRY_FILENAME);
  if (!fs.existsSync(registryPath)) return [];
  const raw = fs.readFileSync(registryPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const result = RegistryFileSchema.safeParse(parsed);
  if (!result.success) return [];
  return Object.values(result.data.entries);
}

/**
 * Remove entries whose process is no longer running. Mutates and overwrites registry file.
 */
export function pruneStaleRegistryEntries(): void {
  const registryPath = path.join(appDataPath(), REGISTRY_FILENAME);
  if (!fs.existsSync(registryPath)) return;
  const raw = fs.readFileSync(registryPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const result = RegistryFileSchema.safeParse(parsed);
  if (!result.success) return;
  const entries = result.data.entries;
  let pruned = false;
  for (const [key, entry] of Object.entries(entries)) {
    try {
      if (entry.pid && process.kill(entry.pid, 0)) continue;
    } catch {
      // process not running
    }
    delete entries[key];
    pruned = true;
  }
  if (pruned) {
    fs.writeFileSync(registryPath, JSON.stringify({ entries }, null, 2), "utf8");
  }
}

export function removeProjectFromRegistry(projectRoot: string): void {
  const registryPath = path.join(appDataPath(), REGISTRY_FILENAME);
  if (!fs.existsSync(registryPath)) return;
  const raw = fs.readFileSync(registryPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const result = RegistryFileSchema.safeParse(parsed);
  if (!result.success) return;
  const entries = result.data.entries;
  const projectKey = getProjectKey(projectRoot);
  let changed = false;
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.projectRoot === projectRoot || entry.projectKey === projectKey) {
      delete entries[key];
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(registryPath, JSON.stringify({ entries }, null, 2), "utf8");
  }
}
