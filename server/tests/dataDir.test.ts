import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { hunterDataPath, resolveDataDir } from "../dataDir.js";

test("resolveDataDir: defaults to cwd/data when no env", () => {
  assert.equal(resolveDataDir({}), path.resolve("data"));
});

test("resolveDataDir: HUNTER_DATA_DIR overrides default", () => {
  assert.equal(resolveDataDir({ HUNTER_DATA_DIR: "/var/lib/hunter" }), "/var/lib/hunter");
});

test("resolveDataDir: trims whitespace around env value", () => {
  assert.equal(resolveDataDir({ HUNTER_DATA_DIR: "  /var/lib/hunter  " }), "/var/lib/hunter");
});

test("resolveDataDir: empty HUNTER_DATA_DIR falls back to cwd/data", () => {
  assert.equal(resolveDataDir({ HUNTER_DATA_DIR: "" }), path.resolve("data"));
});

test("resolveDataDir: resolves relative HUNTER_DATA_DIR against cwd", () => {
  assert.equal(resolveDataDir({ HUNTER_DATA_DIR: "tmp/data" }), path.resolve("tmp/data"));
});

test("hunterDataPath: joins filename onto resolved data dir", () => {
  assert.equal(hunterDataPath("hunter.sqlite", { HUNTER_DATA_DIR: "/var/lib/hunter" }), "/var/lib/hunter/hunter.sqlite");
});
