/**
 * Global runtime registry: one entry per running project runtime.
 * Runtime registers on start, heartbeats periodically, unregisters on shutdown.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import {
  RegistryFileSchema,
  type IRegistryEntry,
  type IRegistryEntryEndpoint,
} from "@steward/contracts/schemas";
import { REGISTRY_FILENAME } from "@steward/contracts/runtime-defaults";
import { getProjectRoot } from "./project-root.js";
import { getAppDataRoot, getProjectKey } from "./project-key.js";
import { RESTRICTIVE_DIR_MODE, RESTRICTIVE_FILE_MODE } from "./app-data-permissions.js";

function getRegistryPath(): string {
  return join(getAppDataRoot(), REGISTRY_FILENAME);
}

function readRegistry(): { entries: Record<string, IRegistryEntry> } {
  const path = getRegistryPath();
  if (!existsSync(path)) return { entries: {} };
  const raw = readFileSync(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { entries: {} };
  }
  const result = RegistryFileSchema.safeParse(parsed);
  if (!result.success) return { entries: {} };
  return result.data;
}

function writeRegistry(data: { entries: Record<string, IRegistryEntry> }): void {
  const root = getAppDataRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true, mode: RESTRICTIVE_DIR_MODE });
  const path = getRegistryPath();
  writeFileSync(path, JSON.stringify(data, null, 2), {
    encoding: "utf-8",
    mode: RESTRICTIVE_FILE_MODE,
  });
}

export function registerRuntime(args: {
  pid: number;
  endpoint: IRegistryEntryEndpoint;
  state?: "running" | "starting";
}): void {
  const projectRoot = getProjectRoot();
  const projectKey = getProjectKey(projectRoot);
  const data = readRegistry();
  const now = Date.now();
  data.entries[projectKey] = {
    projectKey,
    projectRoot,
    pid: args.pid,
    endpoint: args.endpoint,
    state: args.state ?? "running",
    lastSeenAt: now,
  };
  writeRegistry(data);
}

export function heartbeatRuntime(): void {
  const projectKey = getProjectKey(getProjectRoot());
  const data = readRegistry();
  const entry = data.entries[projectKey];
  if (!entry) return;
  entry.lastSeenAt = Date.now();
  writeRegistry(data);
}

export function unregisterRuntime(projectRoot: string): void {
  const projectKey = getProjectKey(projectRoot);
  const data = readRegistry();
  delete data.entries[projectKey];
  writeRegistry(data);
}
