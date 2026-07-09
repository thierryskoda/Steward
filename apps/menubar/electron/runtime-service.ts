import fs from "fs";
import path from "path";
import { type IRuntimeStatusResponse } from "@steward/contracts/schemas";
import { appDataPath } from "./paths.js";
import { getProjectKey } from "./project-key.js";
import { readRegistry } from "./registry.js";

export type IRuntimeStatus = IRuntimeStatusResponse;

export type IConnection = { baseUrl: string; token: string };

function tokenPath(projectRoot: string): string {
  return path.join(appDataPath(), "projects", getProjectKey(projectRoot), "http-token");
}

/**
 * Returns connection for the given project, or null if not available.
 * Endpoint comes only from the project runtime registry (no fallback to endpoint file).
 */
export function getConnection(projectRoot: string): IConnection | null {
  if (!projectRoot?.trim()) return null;
  const key = getProjectKey(projectRoot);
  const registryEntries = readRegistry();
  const entry = registryEntries.find((e) => e.projectKey === key);
  if (!entry) return null;

  const host = entry.endpoint.host;
  const port = entry.endpoint.port;
  if (!fs.existsSync(tokenPath(projectRoot))) return null;
  const token = fs.readFileSync(tokenPath(projectRoot), "utf8").trim();
  if (!token) return null;

  return {
    baseUrl: `http://${host}:${port}`,
    token,
  };
}

/**
 * Returns HTTP token for the given project. Prefer getConnection(projectRoot) when baseUrl is also needed.
 */
export function getHttpToken(projectRoot: string): string {
  const conn = getConnection(projectRoot);
  if (conn) return conn.token;
  throw new Error("HTTP token not found. Start project runtime first.");
}
