/**
 * Single-writer lock for the Hunter data directory.
 *
 * Why this exists: the sidecar persists state via `server/store.ts`. If two
 * sidecars run against the same data directory (typical cause: an orphan
 * survived a previous `pnpm dev`), their writes race and the on-disk JSON gets
 * torn. Atomic writes in `store.ts` protect against half-written files, but
 * cannot prevent one writer from clobbering the other's updates.
 *
 * The lock is advisory and PID-based:
 *   - On acquire we drop `<dataDir>/.lock` containing our PID (O_EXCL).
 *   - If the file already exists we read the PID and probe it with `kill(0)`.
 *     A live PID => refuse to start, surfacing a clear error to the supervisor.
 *     A dead PID => stale lock, remove and retry once.
 *   - On graceful shutdown we delete the lock so the next launch is clean.
 *
 * This is not a defence against malicious processes — it solves the orphan
 * case we actually have. For production multi-process scenarios upgrade to
 * `proper-lockfile` or a real OS lock (fcntl/flock).
 */

import { openSync, readFileSync, unlinkSync, writeSync, closeSync } from "node:fs";
import path from "node:path";

export class DataDirInUseError extends Error {
  readonly holderPid: number;
  readonly lockPath: string;
  constructor(holderPid: number, lockPath: string) {
    super(
      `Hunter data directory is already locked by pid ${holderPid} (${lockPath}). ` + `Stop the existing sidecar before starting a new one.`
    );
    this.name = "DataDirInUseError";
    this.holderPid = holderPid;
    this.lockPath = lockPath;
  }
}

export type DataDirLockHandle = {
  readonly lockPath: string;
  release: () => void;
};

export function acquireDataDirLock(dataDir: string, ownPid: number = process.pid): DataDirLockHandle {
  const lockPath = path.join(dataDir, ".lock");
  tryWriteLock(lockPath, ownPid, /* allowStaleRetry */ true);

  const release = () => {
    try {
      const content = readFileSync(lockPath, "utf8").trim();
      if (Number(content) !== ownPid) {
        // Someone else owns it now; do not touch their lock.
        return;
      }
      unlinkSync(lockPath);
    } catch {
      // Already gone — fine.
    }
  };

  // Best-effort cleanup. `exit` runs synchronously and only for graceful exits;
  // SIGINT/SIGTERM convert to a normal exit so the lock is removed before the
  // process terminates. SIGKILL leaves a stale lock, which the next acquire
  // detects via `isAlive`.
  process.once("exit", release);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => {
      release();
      process.exit(0);
    });
  }

  return { lockPath, release };
}

function tryWriteLock(lockPath: string, ownPid: number, allowStaleRetry: boolean): void {
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const holderPid = readHolderPid(lockPath);
    if (holderPid !== null && holderPid !== ownPid && isAlive(holderPid)) {
      throw new DataDirInUseError(holderPid, lockPath);
    }
    if (!allowStaleRetry) {
      throw new DataDirInUseError(holderPid ?? 0, lockPath);
    }
    try {
      unlinkSync(lockPath);
    } catch {
      // Another process may have cleaned it up; harmless.
    }
    return tryWriteLock(lockPath, ownPid, /* allowStaleRetry */ false);
  }

  try {
    writeSync(fd, String(ownPid));
  } finally {
    closeSync(fd);
  }
}

function readHolderPid(lockPath: string): number | null {
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 does not deliver a signal; it just checks for permission to
    // signal the target, which doubles as a liveness probe.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // EPERM means the process exists but we cannot signal it — still alive.
    return code === "EPERM";
  }
}
