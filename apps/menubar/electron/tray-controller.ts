import { app, Menu, nativeImage, shell, Tray, type MenuItemConstructorOptions } from "electron";
import path from "path";
import { formatErrorForLog, getLogsDir, writeHostLog } from "./logs-service.js";
import { launchFullStackRestart } from "./restart-service.js";
import type { IHostController } from "./host-controller.js";
import type { IWindowController } from "./window-controller.js";

export type ITrayController = {
  create(): Tray;
  updateStatusLabel(label: string): void;
};

export function createTrayController(args: {
  currentDirPath: string;
  hostController: IHostController;
  windowController: IWindowController;
}): ITrayController {
  let tray: Tray | null = null;
  let statusLabel = "Status: unknown";

  function openLogsDirectory(): void {
    void shell.openPath(getLogsDir());
  }

  function restartRuntime(): void {
    try {
      const root = args.hostController.getSelectedProjectRoot();
      if (!root) {
        writeHostLog("error", "restart", "No project selected");
        return;
      }
      launchFullStackRestart(root);
      app.quit();
    } catch (error) {
      writeHostLog("error", "restart", formatErrorForLog(error));
    }
  }

  function buildContextMenu(): MenuItemConstructorOptions[] {
    return [
      { label: "Open", click: () => args.windowController.open() },
      { label: statusLabel, id: "status", enabled: false },
      { type: "separator" },
      { label: "Open Logs", click: openLogsDirectory },
      { label: "Restart", click: restartRuntime },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ];
  }

  function updateTrayMenu(): void {
    if (!tray) return;
    tray.setContextMenu(Menu.buildFromTemplate(buildContextMenu()));
  }

  function create(): Tray {
    const iconPath = path.join(args.currentDirPath, "icons/32x32.png");
    const icon = nativeImage.createFromPath(iconPath);
    const trayIcon = icon.isEmpty()
      ? icon
      : process.platform === "darwin"
        ? icon.resize({ width: 16, height: 16 })
        : icon;
    tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
    if (process.platform === "darwin") {
      tray.setTitle("Steward");
    }
    tray.on("click", () => {
      updateTrayMenu();
      tray?.popUpContextMenu();
    });
    updateTrayMenu();
    return tray;
  }

  function updateStatusLabel(label: string): void {
    statusLabel = label;
    updateTrayMenu();
  }

  return { create, updateStatusLabel };
}
