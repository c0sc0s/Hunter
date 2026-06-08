#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, extname, relative, resolve } from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

import chokidar from "chokidar";
import electronPath from "electron";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteUrl = process.env.HUNTER_ELECTRON_DEV_URL ?? "http://127.0.0.1:5173";
const electronRestartDebounceMs = 300;
const electronRestartTimeoutMs = 5_000;
const restartableExtensions = new Set([".cjs", ".cts", ".js", ".json", ".mjs", ".mts", ".ts", ".tsx"]);
const restartWatchPaths = ["electron/main.cjs", "electron/preload.cjs", "server", "shared"];

await assertDevPortFree(viteUrl);

const vite = spawnManaged("pnpm", ["dev:web"], {
  cwd: projectRoot,
  env: process.env
});

let electron;
let restartWatcher;
let restartTimer;
let restartInProgress = false;
let queuedRestartReason = null;
let stopping = false;
const restartingElectronChildren = new Set();

try {
  await Promise.race([waitForHttp(viteUrl), waitForExit(vite, "Vite dev server")]);
  electron = startElectron();
  restartWatcher = startRestartWatcher();
} catch (error) {
  stop(vite);
  throw error;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    closeRestartWatcher();
    stop(electron);
    stop(vite);
    process.exit(0);
  });
}

function startElectron() {
  const child = spawnManaged(electronPath, [projectRoot], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HUNTER_ELECTRON_DEV: "1",
      HUNTER_ELECTRON_DEV_URL: viteUrl
    }
  });

  child.once("exit", (code) => {
    if (restartingElectronChildren.delete(child) || stopping || restartInProgress) return;

    stopping = true;
    closeRestartWatcher();
    stop(vite);
    process.exit(code ?? 0);
  });

  return child;
}

function startRestartWatcher() {
  const watcher = chokidar.watch(restartWatchPaths, {
    cwd: projectRoot,
    ignoreInitial: true,
    ignored: shouldIgnoreRestartPath,
    awaitWriteFinish: {
      stabilityThreshold: 120,
      pollInterval: 30
    }
  });

  watcher
    .on("all", (eventName, changedPath) => {
      if (eventName === "addDir" || eventName === "unlinkDir") return;
      scheduleElectronRestart(`${eventName} ${changedPath}`);
    })
    .on("error", (error) => {
      console.error(`[hunter:dev] file watcher error: ${error.message}`);
    })
    .on("ready", () => {
      console.log("[hunter:dev] watching electron/main.cjs, electron/preload.cjs, server/, and shared/ for restart");
    });

  return watcher;
}

function shouldIgnoreRestartPath(filePath, stats) {
  const normalizedPath = normalizePath(filePath);
  const relativePath = normalizedPath.startsWith(normalizePath(projectRoot))
    ? normalizePath(relative(projectRoot, filePath))
    : normalizedPath;

  if (relativePath === "electron/dev.mjs" || relativePath.startsWith("electron/resources/") || relativePath.startsWith("server/tests/")) {
    return true;
  }

  return Boolean(stats?.isFile()) && !restartableExtensions.has(extname(relativePath));
}

function scheduleElectronRestart(reason) {
  if (stopping) return;

  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    void restartElectron(reason);
  }, electronRestartDebounceMs);
}

async function restartElectron(reason) {
  if (stopping) return;

  if (restartInProgress) {
    queuedRestartReason = reason;
    return;
  }

  restartInProgress = true;
  console.log(`[hunter:dev] ${reason}; restarting Electron`);

  try {
    const previousElectron = electron;
    if (isRunning(previousElectron)) restartingElectronChildren.add(previousElectron);
    await stopAndWait(previousElectron, electronRestartTimeoutMs);
    if (!stopping) {
      electron = startElectron();
    }
  } catch (error) {
    console.error(`[hunter:dev] failed to restart Electron: ${error.message}`);
    stopping = true;
    closeRestartWatcher();
    stop(vite);
    process.exit(1);
  } finally {
    restartInProgress = false;
  }

  if (queuedRestartReason && !stopping) {
    const nextReason = queuedRestartReason;
    queuedRestartReason = null;
    scheduleElectronRestart(nextReason);
  }
}

function spawnManaged(command, args, options) {
  return spawn(command, args, {
    ...options,
    stdio: "inherit",
    detached: process.platform !== "win32"
  });
}

function stop(child) {
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

function stopAndWait(child, timeoutMs) {
  if (!isRunning(child)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn("[hunter:dev] timed out waiting for Electron to stop; launching a fresh process");
      resolve();
    }, timeoutMs);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    stop(child);
  });
}

function isRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function closeRestartWatcher() {
  clearTimeout(restartTimer);
  restartTimer = undefined;

  if (!restartWatcher) return;

  void restartWatcher.close();
  restartWatcher = undefined;
}

function normalizePath(value) {
  return value.split("\\").join("/");
}

async function waitForHttp(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForExit(child, label) {
  return new Promise((_, reject) => {
    child.once("exit", (code, signal) => {
      reject(new Error(`${label} exited before becoming ready: code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  });
}

async function assertDevPortFree(url) {
  const parsed = new URL(url);
  const port = Number(parsed.port);
  const host = parsed.hostname;
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`${url} is already in use. Stop the existing Vite process before running pnpm dev.`));
      } else {
        reject(error);
      }
    });
    server.once("listening", () => {
      server.close(resolve);
    });
    server.listen(port, host);
  });
}
