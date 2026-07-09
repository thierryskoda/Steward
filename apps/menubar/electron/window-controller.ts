import { app, BrowserWindow } from "electron";
import path from "path";

const WINDOW_WIDTH = 1020;
const WINDOW_HEIGHT = 720;
const DEV_SERVER_URL = "http://localhost:1420";

export type IWindowController = {
  create(): BrowserWindow;
  get(): BrowserWindow | null;
  open(): void;
  toggle(): void;
};

export function createWindowController(currentDirPath: string): IWindowController {
  let suggestionsWindow: BrowserWindow | null = null;

  function create(): BrowserWindow {
    const win = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      show: false,
      resizable: true,
      title: "Steward",
      webPreferences: {
        preload: path.join(currentDirPath, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    if (process.env.NODE_ENV === "development" || !app.isPackaged) {
      void win.loadURL(DEV_SERVER_URL);
    } else {
      void win.loadFile(path.join(currentDirPath, "../dist/index.html"));
    }

    win.on("close", (event) => {
      event.preventDefault();
      win.hide();
    });

    win.maximize();
    suggestionsWindow = win;
    return win;
  }

  function get(): BrowserWindow | null {
    return suggestionsWindow && !suggestionsWindow.isDestroyed() ? suggestionsWindow : null;
  }

  function open(): void {
    const win = get();
    if (!win) return;
    win.show();
    win.focus();
  }

  function toggle(): void {
    const win = get();
    if (!win) return;
    if (win.isVisible()) {
      win.hide();
      return;
    }
    win.show();
    win.focus();
  }

  return { create, get, open, toggle };
}
