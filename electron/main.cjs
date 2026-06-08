const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PORT_RANGE = "4317-4319";
const SIDECAR_WAIT_MS = 10_000;

const isDev = process.env.HUNTER_ELECTRON_DEV === "1" || !app.isPackaged;

let mainWindow = null;
let apiBase = null;
let sidecar = null;
let shuttingDown = false;

ipcMain.handle("hunter:get-api-base", () => apiBase);
ipcMain.handle("hunter:is-autostart-available", () => app.isPackaged);
ipcMain.handle("hunter:get-autostart", () => (app.isPackaged ? app.getLoginItemSettings().openAtLogin : false));
ipcMain.handle("hunter:set-autostart", (_event, enabled) => {
  if (!app.isPackaged) return false;

  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: process.execPath
  });
  return app.getLoginItemSettings().openAtLogin;
});

app.whenReady().then(async () => {
  await startSidecar();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  shuttingDown = true;
  stopSidecar();
});

app.on("window-all-closed", () => {
  app.quit();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdownFromSignal();
  });
}

function createWindow() {
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
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function registerExternalLinkHandlers(window, appUrl) {
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

function openExternalLink(url) {
  if (!isHttpUrl(url)) return false;

  void shell.openExternal(url).catch((error) => {
    console.error(`[hunter] failed to open external link ${url}: ${error.message}`);
  });
  return true;
}

function isAllowedAppNavigation(url, appUrl) {
  if (!appUrl) return false;

  try {
    return new URL(url).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function startSidecar() {
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

    const handleStdoutLine = (line) => {
      console.log(`[sidecar] ${line}`);
      const port = parsePortLine(line);
      if (port && !apiBase) {
        clearTimeout(timeout);
        apiBase = `http://127.0.0.1:${port}`;
        console.log(`[hunter] api ready: ${apiBase}`);
        mainWindow?.webContents.send("hunter:api-ready", { base: apiBase });
        resolveStartup();
      }
    };

    let stdoutBuffer = "";
    let stderrBuffer = "";

    sidecar.stdout.on("data", (chunk) => {
      stdoutBuffer = flushLines(stdoutBuffer + chunk, handleStdoutLine);
    });

    sidecar.stderr.on("data", (chunk) => {
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

function shutdownFromSignal() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopSidecar();
  app.quit();
  setTimeout(() => {
    process.exit(0);
  }, 1_000).unref();
}

function flushLines(buffer, onLine) {
  const lines = buffer.split(/\r?\n/);
  const tail = lines.pop() ?? "";
  for (const line of lines) {
    if (line) onLine(line);
  }
  return tail;
}

function stopSidecar() {
  const child = sidecar;
  sidecar = null;
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

function resolveSidecarCommand() {
  const projectRoot = path.resolve(__dirname, "..");
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

function resolveDataDir() {
  const dir = isDev ? path.join(path.resolve(__dirname, ".."), "data") : app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function parsePortLine(line) {
  const match = /HUNTER_API_PORT=(\d{1,5})/.exec(line);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}
