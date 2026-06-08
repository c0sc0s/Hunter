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

export type QueueImageCandidate =
  | string
  | {
      url: string;
      score?: number;
      source?: string;
      width?: number;
      height?: number;
      alt?: string;
      context?: string;
      inContentRoot?: boolean;
      order?: number;
    };

export type QueueContentCandidate = {
  kind: string;
  text?: string;
  html?: string;
  selector?: string;
  score?: number;
};

export type QueueSnapshot = {
  url: string;
  title?: string;
  canonicalUrl?: string;
  html?: string;
  textContent?: string;
  selectedText?: string;
  excerpt?: string;
  siteName?: string;
  favicon?: string;
  imageCandidates?: QueueImageCandidate[];
  contentCandidates?: QueueContentCandidate[];
  publishedAt?: string;
};

export type QueuePayload = {
  url: string;
  note?: string;
  tags?: string[];
  snapshot: QueueSnapshot;
};

export type QueueState = "queued" | "syncing" | "failed";

export type QueueIndexEntry = {
  id: string;
  canonicalUrl: string;
  host: string;
  title: string;
  queuedAt: number;
  attempts: number;
  state: QueueState;
  lastError?: string;
  degraded?: boolean;
  nextAttemptAt: number;
};

export type EnqueueResult = {
  entry: QueueIndexEntry;
  replaced: boolean;
  degraded: boolean;
};

export type StorageShim = {
  get(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string | string[]): Promise<void>;
};

export type QueueBackends = {
  indexedDB?: IDBFactory;
  storage?: StorageShim;
  crypto?: { randomUUID?: () => string };
  now?: () => number;
};

type QueueRuntimeBackends = {
  indexedDB?: IDBFactory;
  storage?: StorageShim;
  crypto?: { randomUUID?: () => string };
  now: () => number;
};

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

let backends: QueueRuntimeBackends = {
  get indexedDB() {
    return globalThis.indexedDB;
  },
  get storage() {
    return globalThis.chrome?.storage?.local as StorageShim | undefined;
  },
  get crypto() {
    return globalThis.crypto;
  },
  now() {
    return Date.now();
  }
};

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Replace one or more backends. Used by tests and could be used to point the
 * queue at a different storage area. Resets the cached IDB connection.
 *
 */
export function configureQueue(overrides: QueueBackends) {
  const next = { ...backends };
  if (overrides.indexedDB) next.indexedDB = overrides.indexedDB;
  if (overrides.storage) next.storage = overrides.storage;
  if (overrides.crypto) next.crypto = overrides.crypto;
  if (overrides.now) next.now = overrides.now;
  backends = next;
  dbPromise = null;
}

function openDb(): Promise<IDBDatabase> {
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

function reqAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("queue: transaction aborted"));
  });
}

function storage(): StorageShim {
  const s = backends.storage;
  if (!s) throw new Error("queue: storage backend missing");
  return s;
}

/**
 * Read a single key from storage. Tolerates both `get(string)` (chrome native)
 * and the polyfill that always returns an object.
 *
 */
async function storageGet<T>(key: string): Promise<T | undefined> {
  const res = await storage().get([key]);
  return res?.[key] as T | undefined;
}

async function readIndex(): Promise<{ entries: QueueIndexEntry[]; counters: { queued: number; failed: number } }> {
  const res = await storage().get([STORAGE_KEYS.INDEX, STORAGE_KEYS.COUNTERS]);
  return {
    entries: (res?.[STORAGE_KEYS.INDEX] ?? []) as QueueIndexEntry[],
    counters: (res?.[STORAGE_KEYS.COUNTERS] ?? { queued: 0, failed: 0 }) as { queued: number; failed: number }
  };
}

async function writeIndex(entries: QueueIndexEntry[]): Promise<void> {
  const counters = recomputeCounters(entries);
  await storage().set({
    [STORAGE_KEYS.INDEX]: entries,
    [STORAGE_KEYS.COUNTERS]: counters,
    [STORAGE_KEYS.SCHEMA_VERSION]: SCHEMA_VERSION
  });
}

function recomputeCounters(entries: QueueIndexEntry[]): { queued: number; failed: number } {
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
 */
export function canonicalize(value: string): string {
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

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function makeId(): string {
  const c = backends.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `q-${backends.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Approximate the byte cost of a payload by JSON-encoding it. Used for capacity
 * accounting; rough but consistent across entries.
 *
 */
function approxPayloadBytes(payload: QueuePayload): number {
  return JSON.stringify(payload).length;
}

/**
 * Strip a payload down to URL identity. Used when capacity protection has to
 * choose between dropping a save entirely or keeping a dead-letterable record.
 * The server will still enforce snapshot-required capture semantics.
 */
function degradePayload(payload: QueuePayload): QueuePayload {
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

type StoredPayloadRecord = {
  id: string;
  canonicalUrl: string;
  payload: QueuePayload;
  capturedAt: number;
  attempts: number;
  nextAttemptAt: number;
  bytes?: number;
  degraded?: boolean;
};

type PayloadMeta = {
  id: string;
  bytes: number;
  capturedAt: number;
  degraded: boolean;
};

/**
 * Stream all payload records via cursor, returning lightweight metadata.
 * Avoids materializing every payload body in memory at once.
 *
 */
function listPayloadMeta(db: IDBDatabase): Promise<PayloadMeta[]> {
  return new Promise((resolve, reject) => {
    const out: PayloadMeta[] = [];
    const tx = db.transaction(STORE_PAYLOADS, "readonly");
    const store = tx.objectStore(STORE_PAYLOADS);
    const request = store.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      const value = cursor.value as StoredPayloadRecord;
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
 * "Degrade then drop" is preferred over "drop fresh" because the URL remains
 * recoverable as an audit/dead-letter record, the snapshot is not.
 *
 */
async function enforceCapacity(db: IDBDatabase, entries: QueueIndexEntry[]): Promise<{ degradedIds: string[]; removedIds: string[] }> {
  const meta = await listPayloadMeta(db);
  const metaById = new Map(meta.map((m) => [m.id, m]));

  const degradedIds = new Set<string>();
  const removedIds = new Set<string>();

  let total = meta.reduce((sum, m) => sum + m.bytes, 0);
  if (total > MAX_TOTAL_BYTES) {
    const candidates = [...entries].filter((e) => !e.degraded && metaById.has(e.id)).sort((a, b) => a.queuedAt - b.queuedAt);
    for (const candidate of candidates) {
      if (total <= MAX_TOTAL_BYTES) break;
      const record = await reqAsPromise<StoredPayloadRecord | undefined>(
        db.transaction(STORE_PAYLOADS, "readonly").objectStore(STORE_PAYLOADS).get(candidate.id)
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
 */
async function enqueue(payload: QueuePayload): Promise<EnqueueResult> {
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

  const entry = {
    id,
    canonicalUrl,
    host,
    title,
    queuedAt: existing ? existing.queuedAt : now,
    attempts: 0,
    state: "queued" as const,
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

async function list(filter?: { state?: QueueState }): Promise<QueueIndexEntry[]> {
  const { entries } = await readIndex();
  if (!filter?.state) return entries;
  return entries.filter((entry) => entry.state === filter.state);
}

async function loadPayload(id: string): Promise<QueuePayload | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_PAYLOADS, "readonly");
  const record = await reqAsPromise<{ payload?: QueuePayload } | undefined>(tx.objectStore(STORE_PAYLOADS).get(id));
  await txDone(tx);
  return record?.payload ?? null;
}

/**
 * Delete both the payload and the index entry. Called after a successful POST.
 *
 */
async function markSynced(id: string): Promise<void> {
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
 */
async function markFailed(id: string, error: string): Promise<void> {
  const { entries } = await readIndex();
  const next = entries.map((entry) => (entry.id === id ? { ...entry, state: "failed" as const, lastError: error } : entry));
  await writeIndex(next);
}

/**
 * Record a retryable failure: bump attempts and reschedule. Auto-promotes to
 * failed when the entry exceeds MAX_ATTEMPTS or MAX_AGE_MS.
 *
 */
async function bumpAttempt(id: string, error: string, nextAttemptAt: number): Promise<void> {
  const now = backends.now();
  const { entries } = await readIndex();
  const next = entries.map((entry) => {
    if (entry.id !== id) return entry;
    const attempts = entry.attempts + 1;
    let state: QueueState = "queued";
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
 */
async function remove(id: string): Promise<void> {
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
 */
async function prune(): Promise<{ removed: number; degraded: number }> {
  const now = backends.now();
  const { entries } = await readIndex();

  const droppedIds: string[] = [];
  const surviving: QueueIndexEntry[] = [];
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

async function counters(): Promise<{ queued: number; failed: number }> {
  const { counters: c } = await readIndex();
  return c;
}

type LeaseHandle = {
  renew(): Promise<void>;
};

/**
 * Run `fn` while holding the queue lease. Returns null when the lease is busy
 * so the caller can give up cheaply. The lease auto-expires after LEASE_TTL_MS
 * to recover from killed service workers; `handle.renew()` should be called
 * after each long step to avoid TTL expiry while still mid-flush.
 *
 */
async function withLease<T>(holder: string, fn: (handle: LeaseHandle) => Promise<T>): Promise<T | null> {
  const current = await storageGet<{ holder: string; expiresAt: number }>(STORAGE_KEYS.LEASE);
  const now = backends.now();
  if (current && current.expiresAt > now && current.holder !== holder) {
    return null;
  }

  await storage().set({ [STORAGE_KEYS.LEASE]: { holder, expiresAt: now + LEASE_TTL_MS } });

  // Re-read to detect concurrent acquisition. Storage writes are last-write-wins,
  // so the loser drops out. This is best-effort; a rare double-run is harmless
  // because POST is idempotent on canonicalUrl.
  const verify = await storageGet<{ holder: string; expiresAt: number }>(STORAGE_KEYS.LEASE);
  if (verify?.holder !== holder) return null;

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
    const final = await storageGet<{ holder: string; expiresAt: number }>(STORAGE_KEYS.LEASE);
    if (final?.holder === holder) {
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

export async function __resetForTests(): Promise<void> {
  dbPromise = null;
}
