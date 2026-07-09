import path from "path";
import os from "os";

const APP_DATA = ".steward";

export function appDataPath(): string {
  const envRoot = process.env.CTO_APP_DATA?.trim();
  if (envRoot) return path.resolve(envRoot);
  return path.join(os.homedir(), APP_DATA);
}

export function resolveLogsDir(): string {
  const envRoot = process.env.CTO_LOGS_ROOT?.trim();
  if (envRoot) {
    return path.resolve(envRoot);
  }
  return path.join(os.homedir(), APP_DATA, "logs");
}
