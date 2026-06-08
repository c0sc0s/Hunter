import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DataDirInUseError, acquireDataDirLock } from "../dataDirLock.js";

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "hunter-lock-"));
}

test("acquireDataDirLock writes our pid into <dataDir>/.lock", () => {
  const dir = makeTempDir();
  try {
    const handle = acquireDataDirLock(dir, 12345);
    assert.equal(handle.lockPath, path.join(dir, ".lock"));
    const content = readFileSync(handle.lockPath, "utf8");
    assert.equal(content, "12345");
    handle.release();
    assert.equal(existsSync(handle.lockPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("acquireDataDirLock rejects when another live process holds the lock", () => {
  const dir = makeTempDir();
  try {
    // process.pid is guaranteed alive — simulate a competing live holder.
    writeFileSync(path.join(dir, ".lock"), String(process.pid));
    assert.throws(
      () => acquireDataDirLock(dir, process.pid + 1),
      (err: unknown) => {
        assert.ok(err instanceof DataDirInUseError);
        assert.equal((err as DataDirInUseError).holderPid, process.pid);
        return true;
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("acquireDataDirLock reclaims a stale lock left by a dead pid", () => {
  const dir = makeTempDir();
  try {
    // PID 1 (init/launchd) is always alive, so use a large unlikely PID for
    // the dead case. We probe with kill(0); a non-existent PID surfaces as
    // ESRCH which acquireDataDirLock treats as stale.
    const deadPid = 2_147_483_640;
    writeFileSync(path.join(dir, ".lock"), String(deadPid));
    const handle = acquireDataDirLock(dir, process.pid + 2);
    try {
      assert.equal(readFileSync(handle.lockPath, "utf8"), String(process.pid + 2));
    } finally {
      handle.release();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("acquireDataDirLock tolerates a malformed lock file (treats as stale)", () => {
  const dir = makeTempDir();
  try {
    writeFileSync(path.join(dir, ".lock"), "not-a-pid");
    const handle = acquireDataDirLock(dir, process.pid + 3);
    try {
      assert.equal(readFileSync(handle.lockPath, "utf8"), String(process.pid + 3));
    } finally {
      handle.release();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("acquireDataDirLock release() is a no-op when another holder has taken over", () => {
  const dir = makeTempDir();
  try {
    const handle = acquireDataDirLock(dir, 11111);
    // Simulate another holder replacing the lock file.
    writeFileSync(handle.lockPath, "22222");
    handle.release();
    assert.equal(readFileSync(handle.lockPath, "utf8"), "22222");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("acquireDataDirLock creates lock under an existing nested data dir", () => {
  const root = makeTempDir();
  try {
    const dir = path.join(root, "nested");
    mkdirSync(dir, { recursive: true });
    const handle = acquireDataDirLock(dir, 33333);
    try {
      assert.equal(existsSync(handle.lockPath), true);
    } finally {
      handle.release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
