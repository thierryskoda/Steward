#!/usr/bin/env node
// check-forbidden-lockfiles - scans repo for package-lock.json/yarn.lock and exits non-zero if found. Used in verify/CI to enforce pnpm-only; run from repo root.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const FORBIDDEN = new Set(["package-lock.json", "yarn.lock"]);
const SKIP_DIRS = new Set([
  ".git",
  ".yarn",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
]);

const violations = [];

function scan(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      scan(path.join(dirPath, entry.name));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!FORBIDDEN.has(entry.name)) {
      continue;
    }

    violations.push(path.relative(ROOT, path.join(dirPath, entry.name)));
  }
}

scan(ROOT);

if (violations.length === 0) {
  process.exit(0);
}

console.error("Forbidden lockfiles found:");
for (const filePath of violations.sort()) {
  console.error(`- ${filePath}`);
}
console.error("Remove them and keep only pnpm-lock.yaml at repo root.");
process.exit(1);
