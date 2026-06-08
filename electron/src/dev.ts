#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, extname, relative, resolve } from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

import chokidar, { type FSWatcher } from "chokidar";
import electronPath from "electron";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const viteUrl = process.env.HUNTER_ELECTRON_DEV_URL ?? "http://127.0.0.1:5173";
const electronRestartDebounceMs = 300;
const electronRestartTimeoutMs = 5_000;
const restartableExtensions = new Set([".cjs", ".cts", ".js", ".json", ".mjs", ".mts", ".ts", ".tsx"]);
const restartWatchPaths = ["electron/src", "server", "shared"];
const electronBinary = electronPath as unknown as string;

await buildElectron();
await assertDevPortFree(viteUrl);

const vite = spawnManaged("pnpm", ["dev:web"], {
  cwd: projectRoot,
  env: process.env
});

let electron: ChildProcess | undefined;
let restartWatcher: FSWatcher | undefined;
let restartTimer: NodeJS.Timeout | undefined;
let restartInProgress = false;
let queuedRestartReason: string | null = null;
let stopping = false;
const restartingElectronChildren = new Set<ChildProcess>();

try {
  await Promise.race([waitForHttp(viteUrl), waitForExit(vite, "Vite dev server")]);
  electron = startElectron();
  restartWatcher = startRestartWatcher();
} catch (error) {
  stop(vite);
  throw error;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    closeRestartWatcher();
    stop(electron);
    stop(vite);
    process.exit(0);
  });
}

function startElectron(): ChildProcess {
  const child = spawnManaged(electronBinary, [projectRoot], {
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

function startRestartWatcher(): FSWatcher {
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
    .on("error", (error: unknown) => {
      console.error(`[hunter:dev] file watcher error: ${errorMessage(error)}`);
    })
    .on("ready", () => {
      console.log("[hunter:dev] watching electron/src, server/, and shared/ for rebuild + restart");
    });

  return watcher;
}

function shouldIgnoreRestartPath(filePath: string, stats?: { isFile: () => boolean }): boolean {
  const normalizedPath = normalizePath(filePath);
  const relativePath = normalizedPath.startsWith(normalizePath(projectRoot))
    ? normalizePath(relative(projectRoot, filePath))
    : normalizedPath;

  if (
    relativePath.startsWith("electron/dist/") ||
    relativePath.startsWith("electron/resources/") ||
    relativePath.startsWith("server/tests/")
  ) {
    return true;
  }

  return Boolean(stats?.isFile()) && !restartableExtensions.has(extname(relativePath));
}

function scheduleElectronRestart(reason: string): void {
  if (stopping) return;

  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    void restartElectron(reason);
  }, electronRestartDebounceMs);
}

async function restartElectron(reason: string): Promise<void> {
  if (stopping) return;

  if (restartInProgress) {
    queuedRestartReason = reason;
    return;
  }

  restartInProgress = true;
  console.log(`[hunter:dev] ${reason}; rebuilding and restarting Electron`);

  try {
    await buildElectron();
    const previousElectron = electron;
    if (isRunning(previousElectron)) restartingElectronChildren.add(previousElectron);
    await stopAndWait(previousElectron, electronRestartTimeoutMs);
    if (!stopping) {
      electron = startElectron();
    }
  } catch (error) {
    console.error(`[hunter:dev] failed to restart Electron: ${errorMessage(error)}`);
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

function spawnManaged(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): ChildProcess {
  return spawn(command, args, {
    ...options,
    stdio: "inherit",
    detached: process.platform !== "win32"
  });
}

function stop(child: ChildProcess | undefined): void {
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

function stopAndWait(child: ChildProcess | undefined, timeoutMs: number): Promise<void> {
  if (!isRunning(child)) {
    return Promise.resolve();
  }

  return new Promise((resolveDone) => {
    const timeout = setTimeout(() => {
      console.warn("[hunter:dev] timed out waiting for Electron to stop; launching a fresh process");
      resolveDone();
    }, timeoutMs);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolveDone();
    });

    stop(child);
  });
}

function isRunning(child: ChildProcess | undefined): child is ChildProcess {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function closeRestartWatcher(): void {
  clearTimeout(restartTimer);
  restartTimer = undefined;

  if (!restartWatcher) return;

  void restartWatcher.close();
  restartWatcher = undefined;
}

function normalizePath(value: string): string {
  return value.split("\\").join("/");
}

async function waitForHttp(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function waitForExit(child: ChildProcess, label: string): Promise<never> {
  return new Promise((_, reject) => {
    child.once("exit", (code, signal) => {
      reject(new Error(`${label} exited before becoming ready: code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  });
}

async function assertDevPortFree(url: string): Promise<void> {
  const parsed = new URL(url);
  const port = Number(parsed.port);
  const host = parsed.hostname;
  await new Promise<void>((resolveListening, reject) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`${url} is already in use. Stop the existing Vite process before running pnpm dev.`));
      } else {
        reject(error);
      }
    });
    server.once("listening", () => {
      server.close(() => resolveListening());
    });
    server.listen(port, host);
  });
}

async function buildElectron(): Promise<void> {
  await runForExit("pnpm", ["build:electron"], "Electron build");
}

function runForExit(command: string, args: string[], label: string): Promise<void> {
  return new Promise((resolveDone, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit"
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveDone();
        return;
      }
      reject(new Error(`${label} failed: code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
