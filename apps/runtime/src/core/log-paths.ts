import { homedir } from "os";
import { join, resolve } from "path";

const APP_DATA_DIR = ".steward";
const LOGS_DIR_NAME = "logs";

export const RUNTIME_LOG_FILE = "runtime.log";

export function resolveLogsDir(args: { logsRootOverride: string | undefined }): string {
  const logsRoot = args.logsRootOverride?.trim();
  if (logsRoot) return resolve(logsRoot);
  return join(homedir(), APP_DATA_DIR, LOGS_DIR_NAME);
}
