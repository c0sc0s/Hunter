#!/usr/bin/env node

import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import chokidar from "chokidar";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const extensionRoot = resolve(projectRoot, "extension");
const outDir = resolve(extensionRoot, "dist");
const watchMode = process.argv.includes("--watch");
const rebuildDebounceMs = 120;

let rebuildTimer;
let building = false;
let queued = false;

await buildExtension();

if (watchMode) {
  const watcher = chokidar.watch(["manifest.json", "popup.html", "styles.css", "icons", "src"], {
    cwd: extensionRoot,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 120,
      pollInterval: 30
    }
  });

  watcher
    .on("all", (eventName, changedPath) => {
      if (eventName === "addDir" || eventName === "unlinkDir") return;
      scheduleRebuild(`${eventName} ${changedPath}`);
    })
    .on("ready", () => {
      console.log("[build-extension] watching extension manifest, popup, styles, icons, and src");
    })
    .on("error", (error) => {
      console.error(`[build-extension] watcher error: ${errorMessage(error)}`);
    });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void watcher.close().finally(() => process.exit(0));
    });
  }

  await new Promise(() => undefined);
}

function scheduleRebuild(reason) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = undefined;
    void rebuild(reason);
  }, rebuildDebounceMs);
}

async function rebuild(reason) {
  if (building) {
    queued = true;
    return;
  }

  building = true;
  console.log(`[build-extension] ${reason}; rebuilding`);
  try {
    await buildExtension();
  } catch (error) {
    console.error(`[build-extension] rebuild failed: ${errorMessage(error)}`);
  } finally {
    building = false;
  }

  if (queued) {
    queued = false;
    scheduleRebuild("queued changes");
  }
}

async function buildExtension() {
  building = true;
  try {
    await rm(outDir, { recursive: true, force: true });
    await mkdir(resolve(outDir, "src"), { recursive: true });

    await Promise.all([
      cp(resolve(extensionRoot, "manifest.json"), resolve(outDir, "manifest.json")),
      cp(resolve(extensionRoot, "popup.html"), resolve(outDir, "popup.html")),
      cp(resolve(extensionRoot, "styles.css"), resolve(outDir, "styles.css")),
      cp(resolve(extensionRoot, "icons"), resolve(outDir, "icons"), { recursive: true })
    ]);

    const common = {
      bundle: true,
      platform: "browser",
      target: ["chrome120"],
      sourcemap: true,
      logLevel: "info"
    };

    await build({
      ...common,
      entryPoints: [resolve(extensionRoot, "src/background.ts")],
      outfile: resolve(outDir, "src/background.js"),
      format: "esm"
    });

    await build({
      ...common,
      entryPoints: [resolve(extensionRoot, "src/popup.ts")],
      outfile: resolve(outDir, "src/popup.js"),
      format: "esm"
    });

    await build({
      ...common,
      entryPoints: [resolve(extensionRoot, "src/extractor.ts")],
      outfile: resolve(outDir, "src/extractor.js"),
      format: "iife"
    });

    console.log(`[build-extension] wrote ${outDir}`);
  } finally {
    building = false;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
