#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

import electronPath from "electron";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteUrl = process.env.HUNTER_ELECTRON_DEV_URL ?? "http://127.0.0.1:5173";

await assertDevPortFree(viteUrl);

const vite = spawnManaged("pnpm", ["dev:web"], {
  cwd: projectRoot,
  env: process.env
});

let electron;
try {
  await Promise.race([waitForHttp(viteUrl), waitForExit(vite, "Vite dev server")]);

  electron = spawnManaged(electronPath, [projectRoot], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HUNTER_ELECTRON_DEV: "1",
      HUNTER_ELECTRON_DEV_URL: viteUrl
    }
  });
} catch (error) {
  stop(vite);
  throw error;
}

electron.once("exit", (code) => {
  stop(vite);
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stop(electron);
    stop(vite);
    process.exit(0);
  });
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
