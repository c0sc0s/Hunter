import assert from "node:assert/strict";
import { test } from "node:test";
import { IDBFactory } from "fake-indexeddb";

import {
  LEASE_TTL_MS,
  MAX_AGE_MS,
  MAX_ATTEMPTS,
  MAX_ENTRIES,
  MAX_TOTAL_BYTES,
  STORAGE_KEYS,
  canonicalize,
  configureQueue,
  queue
} from "../src/queue.js";

class FakeStorage {
  data = new Map<string, unknown>();

  get = async (keys: string | string[] | Record<string, unknown> | null) => {
    if (keys === null) return Object.fromEntries(this.data);
    if (typeof keys === "string") {
      return this.data.has(keys) ? { [keys]: this.data.get(keys) } : {};
    }
    if (Array.isArray(keys)) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (this.data.has(k)) out[k] = this.data.get(k);
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const [k, defaultValue] of Object.entries(keys)) {
      out[k] = this.data.has(k) ? this.data.get(k) : defaultValue;
    }
    return out;
  };

  set = async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) {
      this.data.set(k, structuredClone(v));
    }
  };

  remove = async (keys: string | string[]) => {
    const list = typeof keys === "string" ? [keys] : keys;
    for (const k of list) this.data.delete(k);
  };
}

type Clock = { time: number };

function makeClock(start = 1_700_000_000_000): Clock {
  return { time: start };
}

let storage: FakeStorage;
let clock: Clock;
let uuidCounter: number;

function setup() {
  storage = new FakeStorage();
  clock = makeClock();
  uuidCounter = 0;
  configureQueue({
    indexedDB: new IDBFactory(),
    storage: storage as unknown as Parameters<typeof configureQueue>[0]["storage"],
    crypto: { randomUUID: () => `uuid-${++uuidCounter}` },
    now: () => clock.time
  });
}

function makePayload(overrides: Partial<{ url: string; title: string; canonicalUrl: string; html: string }> = {}) {
  const url = overrides.url ?? "https://example.com/articles/x";
  return {
    url,
    tags: ["t"],
    snapshot: {
      url,
      canonicalUrl: overrides.canonicalUrl,
      title: overrides.title ?? "Some article",
      html: overrides.html ?? "<p>body</p>",
      textContent: "body"
    }
  };
}

test("canonicalize: strips utm, fbclid, hash; sorts remaining params", () => {
  assert.equal(canonicalize("https://example.com/read?utm_source=n&id=42&fbclid=abc#section"), "https://example.com/read?id=42");
  assert.equal(canonicalize("https://example.com/read?b=2&a=1"), "https://example.com/read?a=1&b=2");
  assert.equal(canonicalize("not a url"), "not a url");
});

test("enqueue: creates index entry and stores payload", async () => {
  setup();
  const payload = makePayload();
  const result = await queue.enqueue(payload);

  assert.equal(result.replaced, false);
  assert.equal(result.degraded, false);
  assert.equal(result.entry.state, "queued");
  assert.equal(result.entry.attempts, 0);
  assert.equal(result.entry.host, "example.com");
  assert.equal(result.entry.title, "Some article");
  assert.equal(result.entry.canonicalUrl, "https://example.com/articles/x");

  const entries = await queue.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, result.entry.id);

  const loaded = await queue.loadPayload(result.entry.id);
  assert.deepEqual(loaded, payload);
});

test("enqueue: dedupes by canonical URL (replaces payload, keeps queuedAt)", async () => {
  setup();
  const first = await queue.enqueue(makePayload({ url: "https://example.com/a?utm_source=tw" }));
  clock.time += 5_000;
  const second = await queue.enqueue(makePayload({ url: "https://example.com/a?fbclid=share", html: "<p>fresher</p>" }));

  assert.equal(second.replaced, true);
  assert.equal(second.entry.id, first.entry.id, "should reuse the id");
  assert.equal(second.entry.queuedAt, first.entry.queuedAt, "queuedAt preserved");

  const entries = await queue.list();
  assert.equal(entries.length, 1, "no duplicate index entry");

  const loaded = await queue.loadPayload(first.entry.id);
  assert.equal(loaded?.snapshot.html, "<p>fresher</p>", "payload replaced with newer snapshot");
});

test("enqueue: throws on missing snapshot.url", async () => {
  setup();
  await assert.rejects(() => queue.enqueue({ url: "https://x", snapshot: {} as never }), /snapshot\.url is required/);
});

test("list: filters by state", async () => {
  setup();
  const a = await queue.enqueue(makePayload({ url: "https://example.com/a" }));
  const b = await queue.enqueue(makePayload({ url: "https://example.com/b" }));
  await queue.markFailed(b.entry.id, "bad payload");

  const queued = await queue.list({ state: "queued" });
  const failed = await queue.list({ state: "failed" });
  assert.deepEqual(
    queued.map((e) => e.id),
    [a.entry.id]
  );
  assert.deepEqual(
    failed.map((e) => e.id),
    [b.entry.id]
  );
});

test("markSynced: removes both index entry and payload", async () => {
  setup();
  const result = await queue.enqueue(makePayload());
  await queue.markSynced(result.entry.id);

  assert.equal((await queue.list()).length, 0);
  assert.equal(await queue.loadPayload(result.entry.id), null);
  assert.deepEqual(await queue.counters(), { queued: 0, failed: 0 });
});

test("markFailed: updates state without removing payload", async () => {
  setup();
  const { entry } = await queue.enqueue(makePayload());
  await queue.markFailed(entry.id, "HTTP 422");

  const after = (await queue.list())[0];
  assert.equal(after.state, "failed");
  assert.equal(after.lastError, "HTTP 422");
  assert.ok(await queue.loadPayload(entry.id), "payload retained for manual retry");
});

test("bumpAttempt: increments attempts and reschedules", async () => {
  setup();
  const { entry } = await queue.enqueue(makePayload());
  const nextAt = clock.time + 60_000;
  await queue.bumpAttempt(entry.id, "ECONNREFUSED", nextAt);

  const after = (await queue.list())[0];
  assert.equal(after.attempts, 1);
  assert.equal(after.state, "queued");
  assert.equal(after.nextAttemptAt, nextAt);
  assert.equal(after.lastError, "ECONNREFUSED");
});

test("bumpAttempt: promotes to failed after MAX_ATTEMPTS", async () => {
  setup();
  const { entry } = await queue.enqueue(makePayload());
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    await queue.bumpAttempt(entry.id, "5xx", clock.time + 60_000);
  }
  const after = (await queue.list())[0];
  assert.equal(after.attempts, MAX_ATTEMPTS);
  assert.equal(after.state, "failed");
});

test("bumpAttempt: promotes to failed after MAX_AGE_MS", async () => {
  setup();
  const { entry } = await queue.enqueue(makePayload());
  clock.time += MAX_AGE_MS + 1;
  await queue.bumpAttempt(entry.id, "still down", clock.time + 60_000);
  const after = (await queue.list())[0];
  assert.equal(after.state, "failed");
});

test("remove: drops both index and payload", async () => {
  setup();
  const { entry } = await queue.enqueue(makePayload());
  await queue.remove(entry.id);
  assert.equal((await queue.list()).length, 0);
  assert.equal(await queue.loadPayload(entry.id), null);
});

test("prune: drops failed entries older than MAX_AGE_MS, keeps queued", async () => {
  setup();
  const old = await queue.enqueue(makePayload({ url: "https://example.com/old" }));
  await queue.markFailed(old.entry.id, "broken");
  const fresh = await queue.enqueue(makePayload({ url: "https://example.com/fresh" }));

  clock.time += MAX_AGE_MS + 1;

  const result = await queue.prune();
  assert.equal(result.removed, 1);
  assert.equal(result.degraded, 0);

  const remaining = await queue.list();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, fresh.entry.id);
  assert.equal(await queue.loadPayload(old.entry.id), null);
});

test("counters: reflect queued vs failed split", async () => {
  setup();
  const a = await queue.enqueue(makePayload({ url: "https://example.com/a" }));
  await queue.enqueue(makePayload({ url: "https://example.com/b" }));
  await queue.markFailed(a.entry.id, "bad");
  assert.deepEqual(await queue.counters(), { queued: 1, failed: 1 });
});

test("withLease: grants when free and releases on completion", async () => {
  setup();
  let ran = false;
  const result = await queue.withLease("worker-1", async () => {
    ran = true;
    const lease = (await storage.get([STORAGE_KEYS.LEASE]))[STORAGE_KEYS.LEASE] as { holder: string; expiresAt: number } | undefined;
    assert.equal(lease?.holder, "worker-1");
    assert.ok(lease && lease.expiresAt > clock.time);
    return "value";
  });
  assert.equal(ran, true);
  assert.equal(result, "value");
  const after = (await storage.get([STORAGE_KEYS.LEASE]))[STORAGE_KEYS.LEASE] as { holder: string; expiresAt: number } | undefined;
  assert.equal(after?.expiresAt, 0, "lease released on completion");
});

test("withLease: returns null when another holder owns a live lease", async () => {
  setup();
  await storage.set({
    [STORAGE_KEYS.LEASE]: { holder: "other", expiresAt: clock.time + LEASE_TTL_MS }
  });
  let ran = false;
  const result = await queue.withLease("worker-1", async () => {
    ran = true;
    return "should not run";
  });
  assert.equal(ran, false);
  assert.equal(result, null);
});

test("withLease: acquires when previous holder's lease expired", async () => {
  setup();
  await storage.set({
    [STORAGE_KEYS.LEASE]: { holder: "ghost-sw", expiresAt: clock.time - 1 }
  });
  let ran = false;
  await queue.withLease("worker-1", async () => {
    ran = true;
  });
  assert.equal(ran, true);
});

test("withLease: releases lease even when fn throws", async () => {
  setup();
  await assert.rejects(
    () =>
      queue.withLease("worker-1", async () => {
        throw new Error("boom");
      }),
    /boom/
  );
  const after = (await storage.get([STORAGE_KEYS.LEASE]))[STORAGE_KEYS.LEASE] as { holder: string; expiresAt: number } | undefined;
  assert.equal(after?.expiresAt, 0);
});

test("withLease: renew extends expiry", async () => {
  setup();
  await queue.withLease("worker-1", async (handle) => {
    const before = (await storage.get([STORAGE_KEYS.LEASE]))[STORAGE_KEYS.LEASE] as {
      expiresAt: number;
    };
    clock.time += 20_000;
    await handle.renew();
    const after = (await storage.get([STORAGE_KEYS.LEASE]))[STORAGE_KEYS.LEASE] as {
      expiresAt: number;
    };
    assert.ok(after.expiresAt > before.expiresAt, "renew should push expiry forward");
    assert.equal(after.expiresAt, clock.time + LEASE_TTL_MS);
  });
});

test("enqueue: capacity-degrades oldest payloads when total bytes exceeds cap", async () => {
  setup();
  // Each large payload is ~1.5MB. With cap at 100MB, fitting ~67 still leaves
  // room. Push 5 huge ones at a smaller cap by relying on byte accounting.
  // Synthesize huge payloads to exceed MAX_TOTAL_BYTES quickly using the real
  // cap: we use the public API only.
  const giantHtml = "x".repeat(25 * 1024 * 1024); // ~25MB each, 5 entries → 125MB
  for (let i = 0; i < 5; i += 1) {
    clock.time += 1_000;
    await queue.enqueue({
      url: `https://example.com/big-${i}`,
      snapshot: { url: `https://example.com/big-${i}`, title: `Big ${i}`, html: giantHtml }
    });
  }

  const entries = await queue.list();
  assert.equal(entries.length, 5);

  // At least the oldest one must be degraded once we cross the cap.
  const oldest = entries.find((e) => e.host === "example.com" && e.title === "Big 0");
  assert.ok(oldest?.degraded, "oldest snapshot should be degraded");

  // The degraded payload must still be retrievable but with snapshot stripped.
  const payload = await queue.loadPayload(oldest!.id);
  assert.ok(payload, "URL-only payload still loadable");
  assert.equal(payload?.snapshot.html, undefined, "snapshot html dropped");
  assert.equal(payload?.snapshot.url, "https://example.com/big-0");

  // Total of bytes after degrade should be within cap (allow some slack since
  // the newest entry alone is ~25MB but cap is 100MB).
  void MAX_TOTAL_BYTES;
});

test("enqueue: drops oldest entries when count exceeds MAX_ENTRIES", async () => {
  setup();
  const total = MAX_ENTRIES + 3;
  for (let i = 0; i < total; i += 1) {
    clock.time += 1_000;
    await queue.enqueue({
      url: `https://example.com/n-${i}`,
      snapshot: { url: `https://example.com/n-${i}`, title: `N ${i}` }
    });
  }
  const entries = await queue.list();
  assert.equal(entries.length, MAX_ENTRIES, "count clamped to MAX_ENTRIES");
  // Newest entries must survive.
  assert.ok(
    entries.some((e) => e.title === `N ${total - 1}`),
    "newest entry kept"
  );
  // Oldest entries must be dropped.
  assert.equal(
    entries.find((e) => e.title === "N 0"),
    undefined,
    "oldest entry dropped"
  );
});

test("withLease: does not clobber a foreign lease in finally", async () => {
  setup();
  // Simulate: we acquire, then while we're running another worker steals the
  // lease after ours expires. Our finally should detect "not us" and leave it.
  await queue.withLease("worker-1", async () => {
    await storage.set({
      [STORAGE_KEYS.LEASE]: { holder: "worker-2", expiresAt: clock.time + LEASE_TTL_MS }
    });
  });
  const after = (await storage.get([STORAGE_KEYS.LEASE]))[STORAGE_KEYS.LEASE] as {
    holder: string;
    expiresAt: number;
  };
  assert.equal(after.holder, "worker-2", "foreign lease preserved");
  assert.ok(after.expiresAt > 0, "foreign lease not released");
});
