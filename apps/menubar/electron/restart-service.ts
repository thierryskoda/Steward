import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { z } from "zod";
import { appDataPath } from "./paths.js";
import { getProjectKey } from "./project-key.js";

const RuntimeConfigSchema = z.object({
  nodePath: z.string().min(1),
  projectRoot: z.string().min(1),
  mainJs: z.string().min(1),
});

type IRuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

function readRuntimeConfig(projectRoot: string): IRuntimeConfig {
  const configPath = path.join(
    appDataPath(),
    "projects",
    getProjectKey(projectRoot),
    "runtime.json"
  );
  if (!fs.existsSync(configPath)) {
    throw new Error("runtime.json not found. Run `pnpm dev` from project root first.");
  }
  const raw = fs.readFileSync(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`runtime.json invalid: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    });
  }
  const result = RuntimeConfigSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`runtime.json invalid: ${details}`);
  }
  const config = result.data;
  if (!fs.existsSync(config.nodePath)) {
    throw new Error(
      `node_path in runtime.json does not exist: ${config.nodePath}. Run \`pnpm dev\` to refresh.`
    );
  }
  if (!fs.existsSync(config.projectRoot)) {
    throw new Error(
      `project_root in runtime.json does not exist: ${config.projectRoot}. Run \`pnpm dev\` to refresh.`
    );
  }
  if (!fs.existsSync(config.mainJs)) {
    throw new Error(
      `main_js in runtime.json does not exist: ${config.mainJs}. Run \`pnpm dev\` from project root.`
    );
  }
  return config;
}

function resolveWorkspaceRoot(mainJs: string): string {
  let dir = path.dirname(mainJs);
  for (let i = 0; i < 20; i++) {
    const devSh = path.join(dir, "scripts", "dev.sh");
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(devSh) && fs.existsSync(pkg)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not resolve workspace root from runtime main_js path: ${mainJs}`);
}

export function launchFullStackRestart(projectRoot: string): void {
  const config = readRuntimeConfig(projectRoot);
  const workspaceRoot = resolveWorkspaceRoot(config.mainJs);
  const logsDir = path.join(workspaceRoot, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  spawn("sh", ["-lc", "nohup pnpm dev > logs/restart-stack.log 2>&1 &"], {
    cwd: workspaceRoot,
    stdio: "ignore",
    detached: true,
  });
}
