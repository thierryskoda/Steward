/**
 * Validates .env for runtime startup. Exits 0 on success, 1 on failure.
 * Loads dotenv from repo root, parses via runtime env schema.
 */
import "./load-env.js";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseDotenv } from "dotenv";
import { REQUIRED_ENV_KEYS, parseEnv } from "../src/core/env.js";

function parseDotenvFile(): Record<string, string> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(scriptDir, "../../../.env");
  if (!existsSync(envPath)) {
    throw new Error(`.env file not found at ${envPath}`);
  }
  return parseDotenv(readFileSync(envPath, "utf8"));
}

function validateExpectedEnvKeysPresent(envFile: Record<string, string>): string[] {
  return REQUIRED_ENV_KEYS.filter((key) => envFile[key] === undefined);
}

function main(): number {
  try {
    const envFile = parseDotenvFile();
    const missingKeys = validateExpectedEnvKeysPresent(envFile);
    if (missingKeys.length > 0) {
      console.error(`FAIL: missing required env keys in .env: ${missingKeys.join(", ")}`);
      return 1;
    }
    const env = parseEnv(process.env);
    const cursorRoot = env.CTO_CURSOR_PROJECTS_ROOT;
    if (cursorRoot && !existsSync(cursorRoot)) {
      console.error(`FAIL: CTO_CURSOR_PROJECTS_ROOT path does not exist: ${cursorRoot}`);
      return 1;
    }
    console.log("OK: env valid");
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`FAIL: env parse error: ${msg}`);
    return 1;
  }
}

process.exit(main());
