/**
 * Save pipeline used by the extension background worker.
 *
 * Separation of concerns:
 *   - `tryPost` knows nothing about the queue; it just classifies one HTTP
 *     attempt as `ok`, `client-error` (no point retrying), or `transient`
 *     (network/5xx/timeout).
 *   - `performSave` is the user-facing single-shot save: try online once,
 *     and on transient failure park the payload in the queue.
 *   - `flushQueue` drains queued payloads while holding the queue lease.
 *
 * All HTTP, time, and backoff functions are injectable via `configureSaveActions`
 * so unit tests can drive the pipeline without real fetch.
 */

import { queue, type QueueIndexEntry, type QueuePayload } from "./queue.js";

type SaveActionsBackends = {
  fetch?: typeof fetch;
  now?: () => number;
};

type PostOk = {
  kind: "ok";
  item: unknown;
};

type PostClientError = {
  kind: "client-error";
  error: string;
  status: number;
};

type PostTransient = {
  kind: "transient";
  error: string;
  status?: number;
};

type PostResult = PostOk | PostClientError | PostTransient;

export type SaveOk = {
  ok: true;
  queued: false;
  item: unknown;
};

export type SaveQueued = {
  ok: true;
  queued: true;
  entry: QueueIndexEntry;
};

export type SaveFailed = {
  ok: false;
  queued: false;
  error: string;
  status?: number;
};

export type SaveResult = SaveOk | SaveQueued | SaveFailed;

export type FlushResult = {
  flushed: number;
  halted?: boolean;
  skipped?: "lease-busy" | "server-down";
};

export const POST_TIMEOUT_MS = 4_000;
export const FLUSH_POST_TIMEOUT_MS = 8_000;
export const HEALTH_TIMEOUT_MS = 2_000;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 30 * 60_000;

const backends = {
  fetch: globalThis.fetch.bind(globalThis),
  now: () => Date.now()
};

export function configureSaveActions(overrides: SaveActionsBackends) {
  if (overrides.fetch) backends.fetch = overrides.fetch;
  if (overrides.now) backends.now = overrides.now;
}

/**
 */
function normalizeBase(apiBase: string): string {
  return apiBase.replace(/\/+$/, "");
}

/**
 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await backends.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Quick liveness check. Treats any non-2xx or thrown error as `down`.
 *
 */
export async function pingHealth(apiBase: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${normalizeBase(apiBase)}/api/health`, { method: "GET" }, HEALTH_TIMEOUT_MS);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * One POST attempt. Classifies the outcome so callers can decide whether to
 * retry, dead-letter, or surface to the user.
 *
 * Status mapping (matches docs/DESKTOP_OFFLINE_ARCHITECTURE.md §2.5):
 *   - 2xx                       → ok
 *   - 4xx (except 408 / 429)    → client-error (dead-letter candidate)
 *   - 408, 429, 5xx, no response → transient
 *
 */
export async function tryPost(apiBase: string, payload: QueuePayload, timeoutMs = POST_TIMEOUT_MS): Promise<PostResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${normalizeBase(apiBase)}/api/items`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      },
      timeoutMs
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "transient", error: message };
  }

  if (response.ok) {
    const item = await response.json().catch(() => null);
    return { kind: "ok", item };
  }

  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return { kind: "transient", error: `HTTP ${response.status}`, status: response.status };
  }

  return { kind: "client-error", error: `HTTP ${response.status}`, status: response.status };
}

/**
 * User-facing single save attempt. Returns `queued: true` when the server is
 * not reachable so the popup can show "saved offline".
 *
 */
export async function performSave(apiBase: string, payload: QueuePayload): Promise<SaveResult> {
  const result = await tryPost(apiBase, payload);
  if (result.kind === "ok") {
    return { ok: true, queued: false, item: result.item };
  }
  if (result.kind === "client-error") {
    return { ok: false, queued: false, error: result.error, status: result.status };
  }
  const { entry } = await queue.enqueue(payload);
  return { ok: true, queued: true, entry };
}

/**
 */
function nextAttemptAt(attempts: number, now: number): number {
  const delay = Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_MAX_MS);
  return now + delay;
}

/**
 * Drain the queue while holding the lease. Pings `/api/health` first to avoid
 * waking and tearing through N payloads against a dead server.
 *
 * Returns:
 *   - `{ skipped: "lease-busy" }`  another worker is already flushing
 *   - `{ skipped: "server-down" }` health check failed; nothing consumed
 *   - `{ flushed: N, halted: bool }` otherwise
 *
 * `halted` is true when a transient failure mid-loop caused us to stop and let
 * the next alarm retry from where we left off.
 *
 */
export async function flushQueue(apiBase: string): Promise<FlushResult> {
  const outcome = await queue.withLease("flush", async ({ renew }) => {
    if (!(await pingHealth(apiBase))) {
      return { flushed: 0, skipped: "server-down" } satisfies FlushResult;
    }

    const all = await queue.list({ state: "queued" });
    const now = backends.now();
    const due = all.filter((entry) => entry.nextAttemptAt <= now);

    let flushed = 0;
    for (const entry of due) {
      const payload = await queue.loadPayload(entry.id);
      if (!payload) {
        // Index/payload desynced (manual storage edit, partial migration, etc.).
        // Drop the orphan rather than retrying forever.
        await queue.remove(entry.id);
        continue;
      }

      const post = await tryPost(apiBase, payload, FLUSH_POST_TIMEOUT_MS);
      if (post.kind === "ok") {
        await queue.markSynced(entry.id);
        flushed += 1;
        await renew();
        continue;
      }
      if (post.kind === "client-error") {
        await queue.markFailed(entry.id, post.error);
        continue;
      }
      // transient: don't burn through the rest of the queue; let the next
      // alarm tick retry on the new state.
      await queue.bumpAttempt(entry.id, post.error, nextAttemptAt(entry.attempts, backends.now()));
      return { flushed, halted: true } satisfies FlushResult;
    }

    return { flushed } satisfies FlushResult;
  });

  if (outcome === null) return { flushed: 0, skipped: "lease-busy" };
  return outcome;
}
