import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomBytes, timingSafeEqual } from "crypto";
import { RESTRICTIVE_FILE_MODE } from "../core/app-data-permissions.js";
import { getProjectRoot } from "../core/project-root.js";
import { ensureProjectDir, getProjectDir } from "../core/project-key.js";

const TOKEN_FILENAME = "http-token";

function tokenFile(): string {
  return join(getProjectDir(getProjectRoot()), TOKEN_FILENAME);
}

export function getOrCreateAuthToken(): string {
  ensureProjectDir(getProjectRoot());
  const file = tokenFile();
  if (existsSync(file)) {
    return readFileSync(file, "utf-8").trim();
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(file, token, {
    encoding: "utf-8",
    mode: RESTRICTIVE_FILE_MODE,
  });
  return token;
}

export function validateAuthToken(header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice(7).trim();
  const file = tokenFile();
  if (!token.length || !existsSync(file)) return false;
  const expected = readFileSync(file, "utf-8").trim();
  if (expected.length === 0) return false;
  const a = Buffer.from(token, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
