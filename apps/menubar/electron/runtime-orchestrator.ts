/**
 * Menubar project runtime lifecycle: start/stop project runtimes, list with status.
 * Persists known/selected project via app-preferences; discovery via registry.
 * startProject resolves only when runtime reports state "running" or rejects on error/timeout.
 */
import { spawn } from "child_process";
import path from "path";
import { getProjectKey } from "./project-key.js";
import { readRegistry, pruneStaleRegistryEntries, removeProjectFromRegistry } from "./registry.js";
import {
  readAppPreferences,
  addKnownProject,
  removeKnownProject,
  setSelectedProject,
  getKnownProjectRoots,
  getSelectedProject,
  getCliProviderForProject,
  setCliProviderForProject,
} from "./app-preferences.js";
import { writeHostLog, formatErrorForLog } from "./logs-service.js";
import { getConnection } from "./runtime-service.js";
import * as gateway from "./runtime-gateway.js";
import type { IAgentCliProvider, IRegistryEntry } from "@steward/contracts/schemas";

const RUNTIME_ARG = "--runtime";
const CONNECTION_WAIT_MS = 1000 * 60 * 15; // 15 minutes
const CONNECTION_POLL_MS = 500; // 0.5 seconds
const READINESS_POLL_MS = 2000; // 2 seconds
const READINESS_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** Resolve runtime main.js path. Set CTO_RUNTIME_MAIN_PATH in dev. */
export function getRuntimeMainPath(): string {
  const fromEnv = process.env.CTO_RUNTIME_MAIN_PATH?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  throw new Error(
    "Runtime path not set. Set CTO_RUNTIME_MAIN_PATH to runtime main.js (e.g. apps/runtime/dist/src/main.js) when starting menubar."
  );
}

export type IProjectWithStatus = {
  projectRoot: string;
  projectKey: string;
  status: "running" | "stopped";
  pid?: number;
  endpoint?: { host: string; port: number };
};

export function listProjectsWithRuntimeStatus(): IProjectWithStatus[] {
  pruneStaleRegistryEntries();
  const prefs = readAppPreferences();
  const known = prefs.knownProjectRoots;
  const registryEntries = readRegistry();
  const byKey = new Map<string, IRegistryEntry>();
  for (const e of registryEntries) byKey.set(e.projectKey, e);

  return known.map((projectRoot) => {
    const projectKey = getProjectKey(projectRoot);
    const entry = byKey.get(projectKey);
    if (entry) {
      return {
        projectRoot,
        projectKey,
        status: "running" as const,
        pid: entry.pid,
        endpoint: entry.endpoint,
      };
    }
    return {
      projectRoot,
      projectKey,
      status: "stopped" as const,
    };
  });
}

export function addProject(projectRoot: string): void {
  const canonical = path.resolve(projectRoot);
  addKnownProject(canonical);
  writeHostLog("info", "orchestrator", `add_project projectRoot=${canonical}`);
}

export async function removeProject(projectRoot: string): Promise<void> {
  const canonical = path.resolve(projectRoot);
  const connection = getConnection(canonical);
  if (connection) {
    try {
      await gateway.shutdownRuntime(connection);
    } catch (e) {
      writeHostLog(
        "error",
        "orchestrator",
        `remove_project failed to shutdown runtime projectRoot=${canonical} error=${formatErrorForLog(e)}`
      );
      throw new Error(
        `Failed to shut down runtime for ${canonical}: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }
  }
  removeKnownProject(canonical);
  writeHostLog("info", "orchestrator", `remove_project projectRoot=${canonical}`);
}

export function selectProject(projectRoot: string | null): void {
  setSelectedProject(projectRoot);
  writeHostLog("info", "orchestrator", `select_project projectRoot=${projectRoot ?? "null"}`);
}

export function getProjectCliProvider(projectRoot: string): IAgentCliProvider {
  return getCliProviderForProject(projectRoot);
}

export function setProjectCliProvider(projectRoot: string, provider: IAgentCliProvider): void {
  const canonical = path.resolve(projectRoot);
  setCliProviderForProject(canonical, provider);
  writeHostLog(
    "info",
    "orchestrator",
    `set_cli_provider projectRoot=${canonical} provider=${provider}`
  );
}

function waitForConnection(
  projectRoot: string
): Promise<NonNullable<ReturnType<typeof getConnection>> | null> {
  const startedAt = Date.now();
  const deadline = startedAt + CONNECTION_WAIT_MS;
  return new Promise((resolve) => {
    function tick(): void {
      pruneStaleRegistryEntries();
      const conn = getConnection(projectRoot);
      if (conn) {
        const elapsedMs = Date.now() - startedAt;
        writeHostLog(
          "info",
          "orchestrator",
          `start_project wait_connection got_conn after_ms=${elapsedMs}`
        );
        resolve(conn);
        return;
      }
      if (Date.now() >= deadline) {
        const elapsedMs = Date.now() - startedAt;
        writeHostLog(
          "warn",
          "orchestrator",
          `start_project wait_connection timeout after_ms=${elapsedMs}`
        );
        resolve(null);
        return;
      }
      setTimeout(tick, CONNECTION_POLL_MS);
    }
    tick();
  });
}

function waitForReady(
  connection: NonNullable<ReturnType<typeof getConnection>>,
  _projectRoot: string
): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    function poll(): void {
      gateway
        .getRuntimeStatus(connection)
        .then((status) => {
          if (!status) {
            if (Date.now() >= deadline) {
              reject(new Error("Runtime did not become ready in time"));
              return;
            }
            setTimeout(poll, READINESS_POLL_MS);
            return;
          }
          if (status.state === "running" || status.state === "needs-config") {
            resolve();
            return;
          }
          if (status.state === "error") {
            reject(new Error(status.lastError?.trim() ?? "Runtime startup failed"));
            return;
          }
          if (Date.now() >= deadline) {
            reject(new Error("Runtime did not become ready in time"));
            return;
          }
          setTimeout(poll, READINESS_POLL_MS);
        })
        .catch((_e) => {
          if (Date.now() >= deadline) {
            reject(new Error("Runtime did not become ready in time"));
            return;
          }
          setTimeout(poll, READINESS_POLL_MS);
        });
    }
    poll();
  });
}

async function isRuntimeRunning(projectRoot: string): Promise<boolean> {
  const connection = getConnection(projectRoot);
  if (!connection) return false;
  try {
    const status = await gateway.getRuntimeStatus(connection);
    return status?.state === "running" || status?.state === "needs-config";
  } catch {
    return false;
  }
}

export async function startProject(projectRoot: string): Promise<void> {
  const canonical = path.resolve(projectRoot);
  addKnownProject(canonical);
  const runtimePath = getRuntimeMainPath();
  const llmProvider = getCliProviderForProject(canonical);
  writeHostLog(
    "info",
    "orchestrator",
    `start_project projectRoot=${canonical} runtime=${runtimePath} llmProvider=${llmProvider}`
  );

  const connection = getConnection(canonical);
  if (connection) {
    try {
      const status = await gateway.getRuntimeStatus(connection);
      if (status?.state === "running" || status?.state === "needs-config") {
        writeHostLog(
          "info",
          "orchestrator",
          `start_project already_running; resuming scanning projectRoot=${canonical}`
        );
        try {
          await gateway.resumeScanning(connection);
          return;
        } catch (e) {
          writeHostLog(
            "error",
            "orchestrator",
            `start_project scanning resume failed projectRoot=${canonical} error=${formatErrorForLog(e)}`
          );
          throw e;
        }
      } else if (status?.state === "error") {
        writeHostLog(
          "info",
          "orchestrator",
          `start_project found old errored runtime, shutting it down and cleaning registry projectRoot=${canonical}`
        );
        try {
          await gateway.shutdownRuntime(connection);
        } catch {
          if (status.pid > 0) {
            try {
              process.kill(status.pid, "SIGKILL");
            } catch (killError) {
              writeHostLog(
                "error",
                "orchestrator",
                `start_project stale runtime kill failed pid=${status.pid} error=${formatErrorForLog(killError)}`
              );
            }
          }
        }
        removeProjectFromRegistry(canonical);
      } else {
        removeProjectFromRegistry(canonical);
      }
    } catch {
      writeHostLog(
        "info",
        "orchestrator",
        `start_project connection unreachable, cleaning registry projectRoot=${canonical}`
      );
      removeProjectFromRegistry(canonical);
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn("node", [runtimePath, RUNTIME_ARG], {
      env: {
        ...process.env,
        CTO_TARGET_PROJECT_ROOT: canonical,
        CTO_LLM_PROVIDER: llmProvider,
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
    writeHostLog(
      "info",
      "orchestrator",
      `start_project spawned runtime pid=${child.pid ?? "undefined"}`
    );
    child.on("error", (err) => {
      writeHostLog("error", "orchestrator", `start_project spawn error: ${formatErrorForLog(err)}`);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on("exit", (code, signal) => {
      writeHostLog(
        "info",
        "orchestrator",
        `start_project child_exit code=${code} signal=${signal ?? "null"} pid=${child.pid ?? "undefined"}`
      );
      if (code !== null && code !== 0) {
        void (async () => {
          if (!settled && (await isRuntimeRunning(canonical))) {
            settled = true;
            writeHostLog(
              "info",
              "orchestrator",
              `start_project child_exited_but_runtime_running code=${code} signal=${signal ?? "null"} projectRoot=${canonical}`
            );
            resolve();
            return;
          }
          writeHostLog(
            "error",
            "orchestrator",
            `start_project exit code=${code} signal=${signal ?? "null"}`
          );
          if (!settled) {
            settled = true;
            reject(new Error(`Runtime exited with code ${code}`));
          }
        })();
      }
    });
    child.unref();

    void (async () => {
      const waitStartedAt = Date.now();
      writeHostLog(
        "info",
        "orchestrator",
        `start_project wait_connection_begin projectRoot=${canonical}`
      );
      const conn = await waitForConnection(canonical);
      const elapsedMs = Date.now() - waitStartedAt;
      if (!conn) {
        writeHostLog(
          "error",
          "orchestrator",
          `start_project register_timeout elapsed_ms=${elapsedMs} (no registry entry or token in time)`
        );
        if (!settled) {
          settled = true;
          reject(new Error("Runtime did not register in time"));
        }
        return;
      }
      writeHostLog(
        "info",
        "orchestrator",
        `start_project wait_ready_begin projectRoot=${canonical}`
      );
      try {
        await waitForReady(conn, canonical);
        await gateway.resumeScanning(conn);
        if (!settled) {
          settled = true;
          resolve();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        writeHostLog("error", "orchestrator", `start_project wait_ready_failed message=${msg}`);
        if (!settled) {
          settled = true;
          reject(e);
        }
      }
    })();
  });
}

export async function stopProject(projectRoot: string): Promise<void> {
  const canonical = path.resolve(projectRoot);
  pruneStaleRegistryEntries();

  const connection = getConnection(canonical);
  if (connection) {
    try {
      await gateway.pauseScanning(connection);
      writeHostLog(
        "info",
        "orchestrator",
        `stop_project requested scanning pause projectRoot=${canonical}`
      );
    } catch (e) {
      writeHostLog(
        "error",
        "orchestrator",
        `stop_project scanning pause failed projectRoot=${canonical} error=${formatErrorForLog(e)}`
      );
      throw e;
    }
  } else {
    writeHostLog(
      "info",
      "orchestrator",
      `stop_project no connection to pause scanning projectRoot=${canonical}`
    );
  }
}

export async function shutdownAllRuntimes(): Promise<void> {
  pruneStaleRegistryEntries();
  const registryEntries = readRegistry();
  writeHostLog("info", "orchestrator", `shutdown_all_runtimes count=${registryEntries.length}`);
  const promises = registryEntries.map(async (entry) => {
    const conn = getConnection(entry.projectRoot);
    if (conn) {
      try {
        await gateway.shutdownRuntime(conn);
      } catch (e) {
        writeHostLog(
          "error",
          "orchestrator",
          `shutdown_all_runtimes failed to shutdown projectRoot=${entry.projectRoot} error=${formatErrorForLog(e)}`
        );
      }
    }
  });
  await Promise.all(promises);
}

export { getKnownProjectRoots, getSelectedProject, readAppPreferences };
