#!/usr/bin/env node
// enforce-package-manager - exits 0 only when npm user agent is pnpm; otherwise prints error and exits 1. Used as preinstall script in package.json so only pnpm install is allowed.
const userAgent = process.env.npm_config_user_agent ?? "";

if (userAgent.startsWith("pnpm/")) {
  process.exit(0);
}

if (userAgent.startsWith("npm/") || userAgent.startsWith("yarn/")) {
  console.error("Install blocked: use pnpm for this repo.");
  console.error("Run: pnpm install");
  process.exit(1);
}

console.error("Unable to detect package manager. Use pnpm.");
console.error("Run: pnpm install");
process.exit(1);
