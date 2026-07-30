import { app, globalShortcut } from "electron";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "path";
import { fileURLToPath } from "url";
import {
  CHATGPT_BUNDLED_CODEX_PATH,
  selectCodexCliCommand,
} from "@steward/contracts/runtime-defaults";
import { createCodexTaskClient, type ICodexTaskClient } from "./codex-task-client.js";
import { formatErrorForLog, writeHostLog } from "./logs-service.js";
import { createHostController } from "./host-controller.js";
import { registerIpcHandlers } from "./ipc-handlers.js";
import { createProjectRuntimeController } from "./project-runtime-controller.js";
import { createTrayController } from "./tray-controller.js";
import { createWindowController } from "./window-controller.js";
import { shutdownAllRuntimes } from "./runtime-orchestrator.js";

const SUGGESTIONS_SHORTCUT = "CommandOrControl+Control+0";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);

let statusPollingInterval: ReturnType<typeof setInterval> | null = null;
let codexTaskClient: ICodexTaskClient | null = null;

app
  .whenReady()
  .then(async () => {
    const projectRuntimeController = createProjectRuntimeController();
    const configuredCodexPath = process.env.CTO_CODEX_CLI_PATH?.trim();
    codexTaskClient = createCodexTaskClient({
      codexCliCommand: selectCodexCliCommand({
        configuredPath:
          configuredCodexPath !== undefined && configuredCodexPath.length > 0
            ? configuredCodexPath
            : undefined,
        platform: process.platform,
        bundledCodexExists: existsSync(CHATGPT_BUNDLED_CODEX_PATH),
      }),
      codexHome: path.resolve(process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex")),
      clientVersion: app.getVersion(),
      requestTimeoutMs: 20_000,
      turnTimeoutMs: 10 * 60_000,
    });
    const hostController = createHostController({ projectRuntimeController });
    const windowController = createWindowController(currentDirPath);
    const trayController = createTrayController({
      currentDirPath,
      hostController,
      windowController,
    });

    hostController.loadSelectedProject();
    registerIpcHandlers({ hostController, projectRuntimeController, codexTaskClient });

    windowController.create();
    trayController.create();

    globalShortcut.register(SUGGESTIONS_SHORTCUT, () => {
      windowController.toggle();
    });

    statusPollingInterval = hostController.startStatusPolling((label) => {
      trayController.updateStatusLabel(label);
    });

    await projectRuntimeController.startKnownProjects();
  })
  .catch((error) => {
    writeHostLog("error", "bootstrap", `operation=whenReady error=${formatErrorForLog(error)}`);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", (event) => {
  event.preventDefault();
  globalShortcut.unregisterAll();
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
    statusPollingInterval = null;
  }
  Promise.all([shutdownAllRuntimes(), codexTaskClient?.close() ?? Promise.resolve()])
    .catch((error: unknown) => {
      writeHostLog("error", "shutdown", `error=${formatErrorForLog(error)}`);
    })
    .finally(() => {
      app.exit(0);
    });
});
