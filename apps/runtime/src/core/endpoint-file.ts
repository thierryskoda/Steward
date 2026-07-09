/**
 * Per-project runtime endpoint persistence. Written at runtime start; read by menubar to connect.
 */
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { RESTRICTIVE_FILE_MODE } from "./app-data-permissions.js";
import { getProjectRoot } from "./project-root.js";
import { ensureProjectDir, getProjectDir } from "./project-key.js";
import { EndpointSchema, type IEndpoint } from "./endpoint-file.schemas.js";

const ENDPOINT_FILENAME = "endpoint.json";

export function writeEndpointFile(endpoint: IEndpoint): void {
  const dir = ensureProjectDir(getProjectRoot());
  const path = join(dir, ENDPOINT_FILENAME);
  writeFileSync(path, JSON.stringify(endpoint, null, 2), {
    encoding: "utf-8",
    mode: RESTRICTIVE_FILE_MODE,
  });
}

export function readEndpointFile(projectRoot: string): IEndpoint | null {
  const path = join(getProjectDir(projectRoot), ENDPOINT_FILENAME);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = EndpointSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
