/**
 * Hunter extension offline queue.
 *
 * Two-layer storage:
 *   - IndexedDB "hunter"/"payloads": full QueuePayload bodies, keyed by id.
 *   - chrome.storage.local: lightweight QueueIndexEntry[] for fast popup render,
 *     plus counters, schemaVersion, lease, and lastSeen server status.
 *
 * Concurrency: callers must wrap mutating flows in withLease(). The lease is a
 * best-effort CAS over chrome.storage.local with a 30s TTL; duplicate work in a
 * race is safe because both the client (canonical-url replace) and the server
 * (canonical-url upsert) are idempotent.
 *
 * Backends (indexedDB, chrome.storage.local, crypto, now) are injectable via
 * configureQueue() so tests can run on fake-indexeddb and a JS Map shim.
 */

/**
 * @typedef {object} QueueSnapshot
 * @property {string} url
 * @property {string} [title]
 * @property {string} [canonicalUrl]
 * @property {string} [html]
 * @property {string} [textContent]
 * @property {string} [selectedText]
 * @property {string} [excerpt]
 * @property {string} [siteName]
 * @property {string} [favicon]
 * @property {string[]} [imageCandidates]
 * @property {string} [publishedAt]
 */

/**
 * @typedef {object} QueuePayload
 * @property {string} url
 * @property {string} [note]
 * @property {string[]} [tags]
 * @property {QueueSnapshot} snapshot
 */

/**
 * @typedef {"queued" | "syncing" | "failed"} QueueState
 */

/**
 * @typedef {object} QueueIndexEntry
 * @property {string} id
 * @property {string} canonicalUrl
 * @property {string} host
 * @property {string} title
 * @property {number} queuedAt
 * @property {number} attempts
 * @property {QueueState} state
 * @property {string} [lastError]
 * @property {boolean} [degraded]
 * @property {number} nextAttemptAt
 */

/**
 * @typedef {object} EnqueueResult
 * @property {QueueIndexEntry} entry
 * @property {boolean} replaced
 * @property {boolean} degraded
 */

/**
 * @typedef {object} StorageShim Minimal subset of chrome.storage.local we depend on.
 * @property {(keys: string | string[] | object | null) => Promise<Record<string, unknown>>} get
 * @property {(items: Record<string, unknown>) => Promise<void>} set
 * @property {(keys: string | string[]) => Promise<void>} [remove]
 */

/**
 * @typedef {object} QueueBackends
 * @property {IDBFactory} [indexedDB]
 * @property {StorageShim} [storage]
 * @property {{ randomUUID?: () => string }} [crypto]
 * @property {() => number} [now]
 */

export const DB_NAME = "hunter";
export const DB_VERSION = 1;
export const STORE_PAYLOADS = "payloads";
export const SCHEMA_VERSION = 1;

export const STORAGE_KEYS = Object.freeze({
  INDEX: "hunter:queue:index",
  COUNTERS: "hunter:queue:counters",
  LEASE: "hunter:queue:lease",
  SCHEMA_VERSION: "hunter:queue:schemaVersion",
  LAST_SEEN: "hunter:server:lastSeen"
});

export const LEASE_TTL_MS = 30_000;
export const MAX_ATTEMPTS = 10;
export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_ENTRIES = 200;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

// Tracking-param dedupe list. Mirror of server/sources/url.ts; server remains
// the source of truth, but client-side dedupe avoids enqueueing the same article
// from N campaign links into N payloads.
const TRACKING_PARAMS = new Set([
  "_hsenc",
  "_hsmi",
  "ck_subscriber_id",
  "dclid",
  "fbclid",
  "gclid",
  "gbraid",
  "igshid",
  "li_fat_id",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "msclkid",
  "oly_anon_id",
  "oly_enc_id",
  "scid",
  "spm",
  "twclid",
  "vero_id",
  "wbraid",
  "yclid"
]);

let backends = /** @type {Required<QueueBackends>} */ ({
  get indexedDB() {
    return globalThis.indexedDB;
  },
  get storage() {
    return /** @type {StorageShim} */ (globalThis.chrome?.storage?.local);
  },
  get crypto() {
    return globalThis.crypto;
  },
  now() {
    return Date.now();
  }
});

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

/**
 * Replace one or more backends. Used by tests and could be used to point the
 * queue at a different storage area. Resets the cached IDB connection.
 *
 * @param {QueueBackends} overrides
 */
export function configureQueue(overrides) {
  const next = { ...backends };
  if (overrides.indexedDB) next.indexedDB = overrides.indexedDB;
  if (overrides.storage) next.storage = overrides.storage;
  if (overrides.crypto) next.crypto = overrides.crypto;
  if (overrides.now) next.now = overrides.now;
  backends = next;
  dbPromise = null;
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  if (dbPromise) return dbPromise;
  const factory = backends.indexedDB;
  if (!factory) throw new Error("queue: indexedDB backend missing");

  dbPromise = new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PAYLOADS)) {
        const store = db.createObjectStore(STORE_PAYLOADS, { keyPath: "id" });
        store.createIndex("byCanonicalUrl", "canonicalUrl", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/**
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("queue: transaction aborted"));
  });
}

/**
 * @returns {StorageShim}
 */
function storage() {
  const s = backends.storage;
  if (!s) throw new Error("queue: storage backend missing");
  return s;
}

/**
 * Read a single key from storage. Tolerates both `get(string)` (chrome native)
 * and the polyfill that always returns an object.
 *
 * @template T
 * @param {string} key
 * @returns {Promise<T | undefined>}
 */
async function storageGet(key) {
  const res = await storage().get([key]);
  return /** @type {T | undefined} */ (res?.[key]);
}

/**
 * @returns {Promise<{ entries: QueueIndexEntry[]; counters: { queued: number; failed: number } }>}
 */
async function readIndex() {
  const res = await storage().get([STORAGE_KEYS.INDEX, STORAGE_KEYS.COUNTERS]);
  return {
    entries: /** @type {QueueIndexEntry[]} */ (res?.[STORAGE_KEYS.INDEX] ?? []),
    counters: /** @type {{ queued: number; failed: number }} */ (res?.[STORAGE_KEYS.COUNTERS] ?? { queued: 0, failed: 0 })
  };
}

/**
 * @param {QueueIndexEntry[]} entries
 */
async function writeIndex(entries) {
  const counters = recomputeCounters(entries);
  await storage().set({
    [STORAGE_KEYS.INDEX]: entries,
    [STORAGE_KEYS.COUNTERS]: counters,
    [STORAGE_KEYS.SCHEMA_VERSION]: SCHEMA_VERSION
  });
}

/**
 * @param {QueueIndexEntry[]} entries
 */
function recomputeCounters(entries) {
  let queued = 0;
  let failed = 0;
  for (const entry of entries) {
    if (entry.state === "failed") failed += 1;
    else queued += 1;
  }
  return { queued, failed };
}

/**
 * Best-effort canonical URL. Mirrors server/sources/url.ts: drops the hash,
 * strips well-known tracking params, sorts remaining params. Falls back to the
 * input string when URL parsing fails (e.g. extension-only file:// schemes).
 *
 * @param {string} value
 * @returns {string}
 */
export function canonicalize(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return value;
  }
}

/**
 * @param {string} url
 * @returns {string}
 */
function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function makeId() {
  const c = backends.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `q-${backends.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Approximate the byte cost of a payload by JSON-encoding it. Used for capacity
 * accounting; rough but consistent across entries.
 *
 * @param {QueuePayload} payload
 */
function approxPayloadBytes(payload) {
  return JSON.stringify(payload).length;
}

/**
 * Strip a payload down to URL identity. Used when capacity protection has to
 * choose between dropping a save entirely or keeping the URL so the server can
 * later re-fetch public content. The snapshot body is the expensive part; URL
 * alone keeps Save honest (entry still syncs; recognition falls back to public
 * HTML fetch instead of using the captured snapshot).
 *
 * @param {QueuePayload} payload
 * @returns {QueuePayload}
 */
function degradePayload(payload) {
  return {
    url: payload.url,
    note: payload.note,
    tags: payload.tags,
    snapshot: {
      url: payload.snapshot.url,
      canonicalUrl: payload.snapshot.canonicalUrl,
      title: payload.snapshot.title,
      siteName: payload.snapshot.siteName,
      favicon: payload.snapshot.favicon,
      publishedAt: payload.snapshot.publishedAt
    }
  };
}

/**
 * @typedef {object} StoredPayloadRecord
 * @property {string} id
 * @property {string} canonicalUrl
 * @property {QueuePayload} payload
 * @property {number} capturedAt
 * @property {number} attempts
 * @property {number} nextAttemptAt
 * @property {number} [bytes]
 * @property {boolean} [degraded]
 */

/**
 * Stream all payload records via cursor, returning lightweight metadata.
 * Avoids materializing every payload body in memory at once.
 *
 * @param {IDBDatabase} db
 * @returns {Promise<Array<{ id: string; bytes: number; capturedAt: number; degraded: boolean }>>}
 */
function listPayloadMeta(db) {
  return new Promise((resolve, reject) => {
    /** @type {Array<{ id: string; bytes: number; capturedAt: number; degraded: boolean }>} */
    const out = [];
    const tx = db.transaction(STORE_PAYLOADS, "readonly");
    const store = tx.objectStore(STORE_PAYLOADS);
    const request = store.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = /** @type {IDBCursorWithValue | null} */ (request.result);
      if (!cursor) {
        resolve(out);
        return;
      }
      const value = /** @type {StoredPayloadRecord} */ (cursor.value);
      out.push({
        id: value.id,
        bytes: typeof value.bytes === "number" ? value.bytes : approxPayloadBytes(value.payload),
        capturedAt: value.capturedAt,
        degraded: Boolean(value.degraded)
      });
      cursor.continue();
    };
  });
}

/**
 * Apply two-tier capacity protection.
 *
 *   1. Bytes over MAX_TOTAL_BYTES: degrade oldest non-degraded payloads
 *      (replace snapshot with URL-only) until under the cap. Mark the index
 *      entry `degraded: true` so the UI can disclose to the user.
 *   2. Entry count over MAX_ENTRIES: drop oldest already-degraded entries
 *      first; only drop fresh entries as a last resort.
 *
 * "Degrade then drop" is preferred over "drop fresh" because the URL is
 * recoverable (server can re-fetch public content), the snapshot is not.
 *
 * @param {IDBDatabase} db
 * @param {QueueIndexEntry[]} entries
 * @returns {Promise<{ degradedIds: string[]; removedIds: string[] }>}
 */
async function enforceCapacity(db, entries) {
  const meta = await listPayloadMeta(db);
  const metaById = new Map(meta.map((m) => [m.id, m]));

  /** @type {Set<string>} */
  const degradedIds = new Set();
  /** @type {Set<string>} */
  const removedIds = new Set();

  let total = meta.reduce((sum, m) => sum + m.bytes, 0);
  if (total > MAX_TOTAL_BYTES) {
    const candidates = [...entries].filter((e) => !e.degraded && metaById.has(e.id)).sort((a, b) => a.queuedAt - b.queuedAt);
    for (const candidate of candidates) {
      if (total <= MAX_TOTAL_BYTES) break;
      const record = /** @type {StoredPayloadRecord | undefined} */ (
        await reqAsPromise(db.transaction(STORE_PAYLOADS, "readonly").objectStore(STORE_PAYLOADS).get(candidate.id))
      );
      if (!record) continue;
      const degraded = degradePayload(record.payload);
      const newBytes = approxPayloadBytes(degraded);
      const tx = db.transaction(STORE_PAYLOADS, "readwrite");
      tx.objectStore(STORE_PAYLOADS).put({
        ...record,
        payload: degraded,
        bytes: newBytes,
        degraded: true
      });
      await txDone(tx);
      total = total - (metaById.get(candidate.id)?.bytes ?? 0) + newBytes;
      metaById.set(candidate.id, {
        id: candidate.id,
        bytes: newBytes,
        capturedAt: record.capturedAt,
        degraded: true
      });
      degradedIds.add(candidate.id);
    }
  }

  let remainingCount = entries.length;
  if (remainingCount > MAX_ENTRIES) {
    const candidates = [...entries]
      .map((e) => ({
        ...e,
        degraded: e.degraded || degradedIds.has(e.id)
      }))
      .sort((a, b) => Number(b.degraded) - Number(a.degraded) || a.queuedAt - b.queuedAt);
    for (const candidate of candidates) {
      if (remainingCount <= MAX_ENTRIES) break;
      const tx = db.transaction(STORE_PAYLOADS, "readwrite");
      tx.objectStore(STORE_PAYLOADS).delete(candidate.id);
      await txDone(tx);
      removedIds.add(candidate.id);
      remainingCount -= 1;
    }
  }

  return { degradedIds: [...degradedIds], removedIds: [...removedIds] };
}

/**
 * Add a payload to the queue. Idempotent on canonicalUrl: if an entry with the
 * same canonical URL already exists, its payload is replaced and attempts/state
 * reset so the next flush retries with the fresher snapshot.
 *
 * Applies capacity protection after insert.
 *
 * @param {QueuePayload} payload
 * @returns {Promise<EnqueueResult>}
 */
async function enqueue(payload) {
  if (!payload?.snapshot?.url) {
    throw new Error("queue.enqueue: payload.snapshot.url is required");
  }

  const now = backends.now();
  const canonicalUrl = canonicalize(payload.snapshot.canonicalUrl || payload.snapshot.url);
  const host = safeHost(canonicalUrl);
  const title = payload.snapshot.title?.trim() || host || "Untitled";

  const { entries } = await readIndex();
  const existing = entries.find((entry) => entry.canonicalUrl === canonicalUrl);

  const id = existing?.id ?? makeId();
  const replaced = Boolean(existing);

  /** @type {QueueIndexEntry} */
  const entry = {
    id,
    canonicalUrl,
    host,
    title,
    queuedAt: existing ? existing.queuedAt : now,
    attempts: 0,
    state: "queued",
    nextAttemptAt: now,
    degraded: false
  };

  const db = await openDb();
  const tx = db.transaction(STORE_PAYLOADS, "readwrite");
  tx.objectStore(STORE_PAYLOADS).put({
    id,
    canonicalUrl,
    payload,
    capturedAt: now,
    attempts: 0,
    nextAttemptAt: now,
    bytes: approxPayloadBytes(payload),
    degraded: false
  });
  await txDone(tx);

  const draftEntries = replaced ? entries.map((e) => (e.id === id ? entry : e)) : [...entries, entry];

  const { degradedIds, removedIds } = await enforceCapacity(db, draftEntries);

  let nextEntries = draftEntries;
  if (degradedIds.length > 0 || removedIds.length > 0) {
    const degradedSet = new Set(degradedIds);
    const removedSet = new Set(removedIds);
    nextEntries = draftEntries.filter((e) => !removedSet.has(e.id)).map((e) => (degradedSet.has(e.id) ? { ...e, degraded: true } : e));
  }

  await writeIndex(nextEntries);

  const finalEntry = nextEntries.find((e) => e.id === id) ?? entry;
  return { entry: finalEntry, replaced, degraded: degradedIds.includes(id) };
}

/**
 * @param {{ state?: QueueState }} [filter]
 * @returns {Promise<QueueIndexEntry[]>}
 */
async function list(filter) {
  const { entries } = await readIndex();
  if (!filter?.state) return entries;
  return entries.filter((entry) => entry.state === filter.state);
}

/**
 * @param {string} id
 * @returns {Promise<QueuePayload | null>}
 */
async function loadPayload(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_PAYLOADS, "readonly");
  const record = /** @type {{ payload?: QueuePayload } | undefined} */ (await reqAsPromise(tx.objectStore(STORE_PAYLOADS).get(id)));
  await txDone(tx);
  return record?.payload ?? null;
}

/**
 * Delete both the payload and the index entry. Called after a successful POST.
 *
 * @param {string} id
 */
async function markSynced(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_PAYLOADS, "readwrite");
  tx.objectStore(STORE_PAYLOADS).delete(id);
  await txDone(tx);

  const { entries } = await readIndex();
  const next = entries.filter((entry) => entry.id !== id);
  await writeIndex(next);
}

/**
 * Mark dead-letter. Payload is kept in IDB so the user can manually retry via
 * the Pending panel; index reflects state=failed and lastError.
 *
 * @param {string} id
 * @param {string} error
 */
async function markFailed(id, error) {
  const { entries } = await readIndex();
  const next = entries.map((entry) =>
    entry.id === id ? { ...entry, state: /** @type {QueueState} */ ("failed"), lastError: error } : entry
  );
  await writeIndex(next);
}

/**
 * Record a retryable failure: bump attempts and reschedule. Auto-promotes to
 * failed when the entry exceeds MAX_ATTEMPTS or MAX_AGE_MS.
 *
 * @param {string} id
 * @param {string} error
 * @param {number} nextAttemptAt
 */
async function bumpAttempt(id, error, nextAttemptAt) {
  const now = backends.now();
  const { entries } = await readIndex();
  const next = entries.map((entry) => {
    if (entry.id !== id) return entry;
    const attempts = entry.attempts + 1;
    /** @type {QueueState} */
    let state = "queued";
    if (attempts >= MAX_ATTEMPTS || now - entry.queuedAt > MAX_AGE_MS) {
      state = "failed";
    }
    return { ...entry, attempts, lastError: error, nextAttemptAt, state };
  });
  await writeIndex(next);
}

/**
 * Manual remove (e.g. user clicks Remove on a failed entry).
 *
 * @param {string} id
 */
async function remove(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_PAYLOADS, "readwrite");
  tx.objectStore(STORE_PAYLOADS).delete(id);
  await txDone(tx);

  const { entries } = await readIndex();
  const next = entries.filter((entry) => entry.id !== id);
  await writeIndex(next);
}

/**
 * Drop failed entries older than MAX_AGE_MS. Returns counts for observability.
 * Capacity-based degrade (PR-A4) will return non-zero `degraded`.
 *
 * @returns {Promise<{ removed: number; degraded: number }>}
 */
async function prune() {
  const now = backends.now();
  const { entries } = await readIndex();

  /** @type {string[]} */
  const droppedIds = [];
  /** @type {QueueIndexEntry[]} */
  const surviving = [];
  for (const entry of entries) {
    if (entry.state === "failed" && now - entry.queuedAt > MAX_AGE_MS) {
      droppedIds.push(entry.id);
    } else {
      surviving.push(entry);
    }
  }

  if (droppedIds.length > 0) {
    const db = await openDb();
    const tx = db.transaction(STORE_PAYLOADS, "readwrite");
    const store = tx.objectStore(STORE_PAYLOADS);
    for (const id of droppedIds) store.delete(id);
    await txDone(tx);
    await writeIndex(surviving);
  }

  return { removed: droppedIds.length, degraded: 0 };
}

/**
 * @returns {Promise<{ queued: number; failed: number }>}
 */
async function counters() {
  const { counters: c } = await readIndex();
  return c;
}

/**
 * @typedef {object} LeaseHandle
 * @property {() => Promise<void>} renew Extend the lease by another LEASE_TTL_MS.
 */

/**
 * Run `fn` while holding the queue lease. Returns null when the lease is busy
 * so the caller can give up cheaply. The lease auto-expires after LEASE_TTL_MS
 * to recover from killed service workers; `handle.renew()` should be called
 * after each long step to avoid TTL expiry while still mid-flush.
 *
 * @template T
 * @param {string} holder
 * @param {(handle: LeaseHandle) => Promise<T>} fn
 * @returns {Promise<T | null>}
 */
async function withLease(holder, fn) {
  const current = await storageGet(STORAGE_KEYS.LEASE);
  const now = backends.now();
  const active = /** @type {{ holder: string; expiresAt: number } | undefined} */ (current);
  if (active && active.expiresAt > now && active.holder !== holder) {
    return null;
  }

  await storage().set({ [STORAGE_KEYS.LEASE]: { holder, expiresAt: now + LEASE_TTL_MS } });

  // Re-read to detect concurrent acquisition. Storage writes are last-write-wins,
  // so the loser drops out. This is best-effort; a rare double-run is harmless
  // because POST is idempotent on canonicalUrl.
  const verify = await storageGet(STORAGE_KEYS.LEASE);
  const verifyActive = /** @type {{ holder: string; expiresAt: number } | undefined} */ (verify);
  if (verifyActive?.holder !== holder) return null;

  /** @type {LeaseHandle} */
  const handle = {
    async renew() {
      await storage().set({
        [STORAGE_KEYS.LEASE]: { holder, expiresAt: backends.now() + LEASE_TTL_MS }
      });
    }
  };

  try {
    return await fn(handle);
  } finally {
    const final = await storageGet(STORAGE_KEYS.LEASE);
    const finalActive = /** @type {{ holder: string; expiresAt: number } | undefined} */ (final);
    if (finalActive?.holder === holder) {
      await storage().set({ [STORAGE_KEYS.LEASE]: { holder, expiresAt: 0 } });
    }
  }
}

export const queue = {
  enqueue,
  list,
  loadPayload,
  markSynced,
  markFailed,
  bumpAttempt,
  remove,
  prune,
  counters,
  withLease
};

/**
 * @returns {Promise<void>}
 */
export async function __resetForTests() {
  dbPromise = null;
}
