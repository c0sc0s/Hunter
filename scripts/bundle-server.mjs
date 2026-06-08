#!/usr/bin/env node
// Bundle the Hunter API server into a single CJS file that the Electron main
// process can spawn as a sidecar.
//
// Strategy:
//   - esbuild bundles pure-JS deps into one CJS file.
//   - A small set of packages stays external (native binding OR runtime path
//     resolution that esbuild can't trace). Those packages are materialised
//     as a real flat node_modules tree via `npm install`, which is the only
//     deterministic way to get correct transitive version resolution that
//     mirrors how Node.js' own require() walks node_modules.
//
//     Why npm and not pnpm: pnpm's nested + symlinked layout encodes
//     per-package version resolution via symlinks back to the store. Copying
//     selected packages out of that layout loses the encoding and produces
//     silent version conflicts at runtime (lru-cache@5 grabbed when v10 is
//     needed, etc.). A fresh `npm install` rebuilds a flat tree that Node
//     resolves correctly.

import { execFile as execFileCb } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";

const execFile = promisify(execFileCb);

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const entry = resolve(projectRoot, "server/index.ts");
const resourcesDir = resolve(projectRoot, "electron/resources");
const out = resolve(resourcesDir, "server.cjs");
const runtimeNodeModules = resolve(resourcesDir, "runtime/node_modules");

// Externals — see file header for rationale.
const RUNTIME_EXTERNALS = ["re2", "jsdom", "unpdf"];
// fsevents is a Mac-only optional chokidar dep; not used in production.
const OPTIONAL_EXTERNALS = ["fsevents"];

await mkdir(dirname(out), { recursive: true });

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: out,
  sourcemap: true,
  external: [...RUNTIME_EXTERNALS, ...OPTIONAL_EXTERNALS],
  keepNames: true,
  logLevel: "info"
});

const pnpmStoreDir = resolve(projectRoot, "node_modules/.pnpm");
const pnpmEntries = await readdir(pnpmStoreDir);

/**
 * Read the actual installed version for a top-level external from the pnpm
 * store. We pin npm-install to that exact version so our runtime matches what
 * the project is actually using in dev — no surprise major-version drift.
 *
 * When multiple versions of the same package are present in the store (common
 * for transitive deps like `jsdom`), pick the highest semver so the build is
 * reproducible across machines regardless of install ordering.
 */
async function installedVersion(pkg) {
  const prefix = pkg.startsWith("@") ? `${pkg.replace("/", "+")}@` : `${pkg}@`;
  // Avoid matching e.g. "jsdom-abab" when looking for "jsdom"; require a
  // digit after the @.
  const candidates = pnpmEntries
    .filter((name) => name.startsWith(prefix) && /^\d/.test(name.slice(prefix.length)))
    .map((dir) => ({
      dir,
      // pnpm dirs can carry a peer suffix like `1.2.3(react@18)` or
      // `1.2.3_pnpm-internal-hash`; only the leading semver matters.
      version: dir.slice(prefix.length).replace(/[+_(].*$/, "")
    }));

  if (candidates.length === 0) {
    throw new Error(`[bundle-server] cannot find ${pkg} under node_modules/.pnpm`);
  }
  candidates.sort((a, b) => compareSemver(b.version, a.version));
  const best = candidates[0];

  const pkgJson = JSON.parse(await readFile(resolve(pnpmStoreDir, best.dir, "node_modules", pkg, "package.json"), "utf8"));
  return pkgJson.version;
}

/** Numeric semver compare, ignoring pre-release suffixes. */
function compareSemver(a, b) {
  const parse = (v) =>
    v
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const pinned = {};
for (const pkg of RUNTIME_EXTERNALS) {
  const version = await installedVersion(pkg);
  pinned[pkg] = version;
  console.log(`[bundle-server] pinning ${pkg}@${version}`);
}

const tempDir = resolve(projectRoot, "electron/.bundle-tmp");
await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });
await writeFile(
  resolve(tempDir, "package.json"),
  JSON.stringify(
    {
      name: "hunter-server-runtime",
      version: "0.0.0",
      private: true,
      dependencies: pinned
    },
    null,
    2
  )
);

console.log("[bundle-server] running npm install --omit=dev --omit=optional ...");
await execFile("npm", ["install", "--omit=dev", "--omit=optional", "--no-package-lock", "--no-audit", "--no-fund"], {
  cwd: tempDir,
  env: { ...process.env, npm_config_yes: "true" }
});

await rm(runtimeNodeModules, { recursive: true, force: true });
await mkdir(dirname(runtimeNodeModules), { recursive: true });
await cp(resolve(tempDir, "node_modules"), runtimeNodeModules, {
  recursive: true,
  dereference: true,
  errorOnExist: false,
  force: true
});
await rm(tempDir, { recursive: true, force: true });

const installed = (await readdir(runtimeNodeModules)).filter((n) => !n.startsWith("."));
console.log(`[bundle-server] installed ${installed.length} packages into runtime/node_modules`);
console.log(`[bundle-server] wrote ${out}`);
