import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { spawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";

import type { ApiReadyPayload } from "../../shared/desktopBridge";

const PORT_RANGE = "4317-4319";
const SIDECAR_WAIT_MS = 10_000;

const projectRoot = path.resolve(__dirname, "..", "..");
const isDev = process.env.HUNTER_ELECTRON_DEV === "1" || !app.isPackaged;

type SidecarProcess = ChildProcessByStdio<null, Readable, Readable>;

type SidecarCommand = {
  program: string;
  args: string[];
  cwd: string;
};

let mainWindow: BrowserWindow | null = null;
let apiBase: string | null = null;
let sidecar: SidecarProcess | null = null;
let shuttingDown = false;

ipcMain.handle("hunter:get-api-base", () => apiBase);
ipcMain.handle("hunter:is-autostart-available", () => app.isPackaged);
ipcMain.handle("hunter:get-autostart", () => (app.isPackaged ? app.getLoginItemSettings().openAtLogin : false));
ipcMain.handle("hunter:set-autostart", (_event: IpcMainInvokeEvent, enabled: unknown) => {
  if (!app.isPackaged) return false;

  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: process.execPath
  });
  return app.getLoginItemSettings().openAtLogin;
});

app
  .whenReady()
  .then(async () => {
    await startSidecar();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch((error: unknown) => {
    console.error(`[hunter] failed to start Electron app: ${errorMessage(error)}`);
    app.quit();
  });

app.on("before-quit", () => {
  shuttingDown = true;
  stopSidecar();
});

app.on("window-all-closed", () => {
  app.quit();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdownFromSignal();
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Hunter",
    backgroundColor: "#070809",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 24, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const rendererUrl = process.env.HUNTER_ELECTRON_DEV_URL ?? "http://127.0.0.1:5173";
  registerExternalLinkHandlers(mainWindow, isDev ? rendererUrl : null);

  if (isDev) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(path.join(projectRoot, "dist", "index.html"));
  }
}

function registerExternalLinkHandlers(window: BrowserWindow, appUrl: string | null): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalLink(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedAppNavigation(url, appUrl)) return;

    openExternalLink(url);
    event.preventDefault();
  });
}

function openExternalLink(url: string): boolean {
  if (!isHttpUrl(url)) return false;

  void shell.openExternal(url).catch((error: unknown) => {
    console.error(`[hunter] failed to open external link ${url}: ${errorMessage(error)}`);
  });
  return true;
}

function isAllowedAppNavigation(url: string, appUrl: string | null): boolean {
  if (!appUrl) return false;

  try {
    return new URL(url).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function startSidecar(): Promise<void> {
  const command = resolveSidecarCommand();
  const dataDir = resolveDataDir();

  return new Promise((resolve) => {
    let startupResolved = false;
    const resolveStartup = () => {
      if (startupResolved) return;
      startupResolved = true;
      resolve();
    };

    sidecar = spawn(command.program, command.args, {
      cwd: command.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        HUNTER_API_OWNER: isDev ? "electron-dev" : "electron-packaged",
        HUNTER_PORT_RANGE: PORT_RANGE,
        HUNTER_DATA_DIR: dataDir,
        HUNTER_REPOSITORY: "sqlite"
      }
    });

    sidecar.stdout.setEncoding("utf8");
    sidecar.stderr.setEncoding("utf8");

    const timeout = setTimeout(() => {
      console.error(`[hunter] sidecar did not announce port within ${SIDECAR_WAIT_MS}ms`);
      resolveStartup();
    }, SIDECAR_WAIT_MS);

    const handleStdoutLine = (line: string) => {
      console.log(`[sidecar] ${line}`);
      const port = parsePortLine(line);
      if (port && !apiBase) {
        clearTimeout(timeout);
        apiBase = `http://127.0.0.1:${port}`;
        const payload = { base: apiBase } satisfies ApiReadyPayload;
        console.log(`[hunter] api ready: ${apiBase}`);
        mainWindow?.webContents.send("hunter:api-ready", payload);
        resolveStartup();
      }
    };

    let stdoutBuffer = "";
    let stderrBuffer = "";

    sidecar.stdout.on("data", (chunk: string | Buffer) => {
      stdoutBuffer = flushLines(stdoutBuffer + chunk, handleStdoutLine);
    });

    sidecar.stderr.on("data", (chunk: string | Buffer) => {
      stderrBuffer = flushLines(stderrBuffer + chunk, (line) => {
        console.error(`[sidecar:err] ${line}`);
      });
    });

    sidecar.once("error", (error) => {
      clearTimeout(timeout);
      console.error(`[hunter] failed to spawn sidecar: ${error.message}`);
      resolveStartup();
    });

    sidecar.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (stdoutBuffer) handleStdoutLine(stdoutBuffer);
      if (stderrBuffer) console.error(`[sidecar:err] ${stderrBuffer}`);
      console.error(`[hunter] sidecar exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      sidecar = null;
      apiBase = null;
      resolveStartup();
    });
  });
}

function shutdownFromSignal(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  stopSidecar();
  app.quit();
  setTimeout(() => {
    process.exit(0);
  }, 1_000).unref();
}

function flushLines(buffer: string, onLine: (line: string) => void): string {
  const lines = buffer.split(/\r?\n/);
  const tail = lines.pop() ?? "";
  for (const line of lines) {
    if (line) onLine(line);
  }
  return tail;
}

function stopSidecar(): void {
  const child = sidecar;
  sidecar = null;
  stopChild(child);
}

function stopChild(child: ChildProcess | null): void {
  if (!child || child.killed) return;
  if (child.pid === undefined) {
    child.kill("SIGTERM");
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function resolveSidecarCommand(): SidecarCommand {
  const runtime = process.execPath;

  if (isDev) {
    return {
      program: runtime,
      args: [path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"), "server/index.ts"],
      cwd: projectRoot
    };
  }

  return {
    program: runtime,
    args: [path.join(process.resourcesPath, "server.cjs")],
    cwd: process.resourcesPath
  };
}

function resolveDataDir(): string {
  const dir = isDev ? path.join(projectRoot, "data") : app.getPath("userData");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function parsePortLine(line: string): number | null {
  const match = /HUNTER_API_PORT=(\d{1,5})/.exec(line);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
