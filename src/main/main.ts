import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { registerIpc } from "./ipc.js";

let mainWindow: BrowserWindow | null = null;
let quitting = false;

const isMac = process.platform === "darwin";

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1140,
    height: 740,
    minWidth: 960,
    minHeight: 620,
    title: "BufferTV",
    // Estética nativa en macOS: barra integrada y vibrancia de barra lateral.
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: isMac ? "sidebar" : undefined,
    visualEffectState: "active",
    backgroundColor: isMac ? undefined : "#111114",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadFile(join(__dirname, "..", "renderer", "index.html"), {
    query: { vibrant: isMac ? "1" : "0" },
  });
}

const playback = registerIpc(() => mainWindow);

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Igual que la versión Python: cerrar la ventana termina la reproducción.
app.on("window-all-closed", () => app.quit());

app.on("before-quit", (event) => {
  if (quitting || !playback.isActive()) return;
  event.preventDefault();
  quitting = true;
  void playback.shutdown().finally(() => app.quit());
});
