import { app, globalShortcut } from "electron";
import path from "path";
import { fileURLToPath } from "url";
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

app
  .whenReady()
  .then(() => {
    const projectRuntimeController = createProjectRuntimeController();
    const hostController = createHostController({ projectRuntimeController });
    const windowController = createWindowController(currentDirPath);
    const trayController = createTrayController({
      currentDirPath,
      hostController,
      windowController,
    });

    hostController.loadSelectedProject();
    registerIpcHandlers({ hostController, projectRuntimeController });

    windowController.create();
    trayController.create();

    globalShortcut.register(SUGGESTIONS_SHORTCUT, () => {
      windowController.toggle();
    });

    statusPollingInterval = hostController.startStatusPolling((label) => {
      trayController.updateStatusLabel(label);
    });
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
  shutdownAllRuntimes().finally(() => {
    app.exit(0);
  });
});
