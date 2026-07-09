#!/usr/bin/env node
/* global process, console */
/**
 * Run runtime tests: no args = full suite; one path arg = single file (path required, not substring).
 * Single-file runs: pass path (e.g. src/core/env.test.ts), not substring.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(__dirname, "..");
let args = process.argv.slice(2);
if (args[0] === "--") args = args.slice(1);

function runVitest(vitestArgs) {
  const vitestBin = path.join(runtimeRoot, "node_modules", ".bin", "vitest");
  const child = spawn(vitestBin, ["run", ...vitestArgs], { stdio: "inherit", cwd: runtimeRoot });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function run() {
  if (args.length === 0) {
    runVitest([]);
    return;
  }
  if (args.length === 1) {
    const arg = args[0];
    const hasPathSep = arg.includes("/") || arg.includes(path.sep);
    if (!hasPathSep) {
      console.error(
        "Single-file runs require the path (e.g. src/core/env.test.ts), not a substring. Substring args are unreliable and may run the full suite."
      );
      process.exit(1);
    }
    const resolved = path.resolve(runtimeRoot, arg);
    const normalized = path.normalize(resolved);
    const relative = path.relative(runtimeRoot, normalized);
    const underSrc =
      relative.startsWith("src" + path.sep) || relative === "src" || relative.startsWith("src/");
    const underTests =
      relative.startsWith("tests" + path.sep) ||
      relative === "tests" ||
      relative.startsWith("tests/");
    if ((!underSrc && !underTests) || relative.startsWith("..")) {
      console.error(
        "Single-file runs require the path (e.g. src/core/env.test.ts), not a substring. Path must be under src/ or tests/."
      );
      process.exit(1);
    }
    if (!resolved.endsWith(".test.ts")) {
      console.error(
        "Single-file runs require the path (e.g. src/core/env.test.ts), not a substring. File must match *.test.ts."
      );
      process.exit(1);
    }
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      console.error(
        "Single-file runs require the path (e.g. src/core/env.test.ts), not a substring. File not found."
      );
      process.exit(1);
    }
    if (!stat.isFile()) {
      console.error(
        "Single-file runs require the path (e.g. src/core/env.test.ts), not a substring. Path must be a file."
      );
      process.exit(1);
    }
    runVitest([arg]);
    return;
  }
  runVitest(args);
}

run();
