#!/usr/bin/env node

import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const electronRoot = resolve(projectRoot, "electron");
const outDir = resolve(electronRoot, "dist");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  logLevel: "info",
  external: ["electron"]
};

await build({
  ...common,
  entryPoints: [resolve(electronRoot, "src/main.ts")],
  outfile: resolve(outDir, "main.cjs")
});

await build({
  ...common,
  entryPoints: [resolve(electronRoot, "src/preload.ts")],
  outfile: resolve(outDir, "preload.cjs")
});

console.log(`[build-electron] wrote ${outDir}`);
