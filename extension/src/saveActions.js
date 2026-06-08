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

import { queue } from "./queue.js";

/**
 * @typedef {object} SaveActionsBackends
 * @property {typeof fetch} [fetch]
 * @property {() => number} [now]
 */

/**
 * @typedef {object} PostOk
 * @property {"ok"} kind
 * @property {unknown} item
 */

/**
 * @typedef {object} PostClientError
 * @property {"client-error"} kind
 * @property {string} error
 * @property {number} status
 */

/**
 * @typedef {object} PostTransient
 * @property {"transient"} kind
 * @property {string} error
 * @property {number} [status]
 */

/**
 * @typedef {PostOk | PostClientError | PostTransient} PostResult
 */

export const POST_TIMEOUT_MS = 4_000;
export const FLUSH_POST_TIMEOUT_MS = 8_000;
export const HEALTH_TIMEOUT_MS = 2_000;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 30 * 60_000;

const backends = {
  /** @type {typeof fetch} */
  fetch: (...args) => globalThis.fetch(...args),
  /** @type {() => number} */
  now: () => Date.now()
};

/**
 * @param {SaveActionsBackends} overrides
 */
export function configureSaveActions(overrides) {
  if (overrides.fetch) backends.fetch = overrides.fetch;
  if (overrides.now) backends.now = overrides.now;
}

/**
 * @param {string} apiBase
 * @returns {string}
 */
function normalizeBase(apiBase) {
  return apiBase.replace(/\/+$/, "");
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 */
async function fetchWithTimeout(url, init, timeoutMs) {
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
 * @param {string} apiBase
 * @returns {Promise<boolean>}
 */
export async function pingHealth(apiBase) {
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
 * @param {string} apiBase
 * @param {import("./queue.js").QueuePayload} payload
 * @param {number} [timeoutMs]
 * @returns {Promise<PostResult>}
 */
export async function tryPost(apiBase, payload, timeoutMs = POST_TIMEOUT_MS) {
  let response;
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
 * @typedef {object} SaveOk
 * @property {true} ok
 * @property {false} queued
 * @property {unknown} item
 */

/**
 * @typedef {object} SaveQueued
 * @property {true} ok
 * @property {true} queued
 * @property {import("./queue.js").QueueIndexEntry} entry
 */

/**
 * @typedef {object} SaveFailed
 * @property {false} ok
 * @property {false} queued
 * @property {string} error
 * @property {number} [status]
 */

/**
 * @typedef {SaveOk | SaveQueued | SaveFailed} SaveResult
 */

/**
 * User-facing single save attempt. Returns `queued: true` when the server is
 * not reachable so the popup can show "saved offline".
 *
 * @param {string} apiBase
 * @param {import("./queue.js").QueuePayload} payload
 * @returns {Promise<SaveResult>}
 */
export async function performSave(apiBase, payload) {
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
 * @param {number} attempts
 * @param {number} now
 */
function nextAttemptAt(attempts, now) {
  const delay = Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_MAX_MS);
  return now + delay;
}

/**
 * @typedef {object} FlushResult
 * @property {number} flushed
 * @property {boolean} [halted]
 * @property {"lease-busy" | "server-down"} [skipped]
 */

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
 * @param {string} apiBase
 * @returns {Promise<FlushResult>}
 */
export async function flushQueue(apiBase) {
  const outcome = await queue.withLease("flush", async ({ renew }) => {
    if (!(await pingHealth(apiBase))) {
      return /** @type {FlushResult} */ ({ flushed: 0, skipped: "server-down" });
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
      return /** @type {FlushResult} */ ({ flushed, halted: true });
    }

    return /** @type {FlushResult} */ ({ flushed });
  });

  if (outcome === null) return { flushed: 0, skipped: "lease-busy" };
  return outcome;
}
