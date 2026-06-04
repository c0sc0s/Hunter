import assert from "node:assert/strict";
import { test } from "node:test";
import { IDBFactory } from "fake-indexeddb";

import { configureQueue, queue } from "../src/queue.js";
import {
  FLUSH_POST_TIMEOUT_MS,
  HEALTH_TIMEOUT_MS,
  POST_TIMEOUT_MS,
  configureSaveActions,
  flushQueue,
  performSave,
  pingHealth,
  tryPost
} from "../src/saveActions.js";

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
}

type FetchCall = { url: string; init: RequestInit | undefined };
type Responder = (call: FetchCall) => Response | Promise<Response>;

let clock = { time: 1_700_000_000_000 };
let fetchCalls: FetchCall[] = [];
let nextResponders: Responder[] = [];

function setup() {
  clock = { time: 1_700_000_000_000 };
  fetchCalls = [];
  nextResponders = [];
  configureQueue({
    indexedDB: new IDBFactory(),
    storage: new FakeStorage() as unknown as Parameters<typeof configureQueue>[0]["storage"],
    crypto: { randomUUID: () => `uuid-${Math.random().toString(36).slice(2, 10)}` },
    now: () => clock.time
  });
  configureSaveActions({
    now: () => clock.time,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push({ url, init });
      const responder = nextResponders.shift();
      if (!responder) throw new Error(`unexpected fetch: ${url}`);
      return responder({ url, init });
    }) as typeof fetch
  });
}

function whenFetch(...responders: Responder[]) {
  nextResponders.push(...responders);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function emptyResponse(status: number) {
  return new Response(null, { status });
}

function payloadOf(url: string) {
  return {
    url,
    snapshot: { url, title: "T", html: "<p>x</p>", textContent: "x" }
  };
}

test("tryPost: 200 → ok with item", async () => {
  setup();
  whenFetch(() => jsonResponse({ id: "srv-1" }, 201));
  const result = await tryPost("http://127.0.0.1:4317", payloadOf("https://a"));
  assert.equal(result.kind, "ok");
  assert.deepEqual((result as { item: unknown }).item, { id: "srv-1" });
});

test("tryPost: 422 → client-error", async () => {
  setup();
  whenFetch(() => emptyResponse(422));
  const result = await tryPost("http://127.0.0.1:4317", payloadOf("https://a"));
  assert.equal(result.kind, "client-error");
  assert.equal((result as { status: number }).status, 422);
});

test("tryPost: 503 → transient", async () => {
  setup();
  whenFetch(() => emptyResponse(503));
  const result = await tryPost("http://127.0.0.1:4317", payloadOf("https://a"));
  assert.equal(result.kind, "transient");
  assert.equal((result as { status?: number }).status, 503);
});

test("tryPost: 429 → transient (retry-worthy)", async () => {
  setup();
  whenFetch(() => emptyResponse(429));
  const result = await tryPost("http://127.0.0.1:4317", payloadOf("https://a"));
  assert.equal(result.kind, "transient");
});

test("tryPost: 408 → transient", async () => {
  setup();
  whenFetch(() => emptyResponse(408));
  const result = await tryPost("http://127.0.0.1:4317", payloadOf("https://a"));
  assert.equal(result.kind, "transient");
});

test("tryPost: network error → transient", async () => {
  setup();
  whenFetch(() => {
    throw new TypeError("Failed to fetch");
  });
  const result = await tryPost("http://127.0.0.1:4317", payloadOf("https://a"));
  assert.equal(result.kind, "transient");
  assert.match((result as { error: string }).error, /Failed to fetch/);
});

test("tryPost: abort/timeout → transient", async () => {
  setup();
  whenFetch(
    (call) =>
      new Promise<Response>((_resolve, reject) => {
        call.init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })
  );
  const result = await tryPost("http://127.0.0.1:4317", payloadOf("https://a"), 5);
  assert.equal(result.kind, "transient");
});

test("tryPost: trims trailing slashes from apiBase", async () => {
  setup();
  whenFetch(() => jsonResponse({ id: "x" }, 201));
  await tryPost("http://127.0.0.1:4317///", payloadOf("https://a"));
  assert.equal(fetchCalls[0]?.url, "http://127.0.0.1:4317/api/items");
});

test("performSave: ok → no enqueue", async () => {
  setup();
  whenFetch(() => jsonResponse({ id: "srv" }, 201));
  const result = await performSave("http://127.0.0.1:4317", payloadOf("https://a"));
  assert.equal(result.ok, true);
  assert.equal(result.queued, false);
  assert.equal((await queue.counters()).queued, 0);
});

test("performSave: transient → enqueued, ok:true", async () => {
  setup();
  whenFetch(() => {
    throw new TypeError("Failed to fetch");
  });
  const result = await performSave("http://127.0.0.1:4317", payloadOf("https://a"));
  assert.equal(result.ok, true);
  assert.equal(result.queued, true);
  assert.equal((await queue.counters()).queued, 1);
});

test("performSave: client-error → ok:false, not queued", async () => {
  setup();
  whenFetch(() => emptyResponse(400));
  const result = await performSave("http://127.0.0.1:4317", payloadOf("https://a"));
  assert.equal(result.ok, false);
  assert.equal(result.queued, false);
  assert.equal((await queue.counters()).queued, 0);
});

test("flushQueue: skips when server down", async () => {
  setup();
  await queue.enqueue(payloadOf("https://a"));
  whenFetch(() => emptyResponse(503)); // health
  const result = await flushQueue("http://127.0.0.1:4317");
  assert.equal(result.skipped, "server-down");
  assert.equal(result.flushed, 0);
  assert.equal((await queue.counters()).queued, 1, "payload preserved");
});

test("flushQueue: drains all due queued items", async () => {
  setup();
  await queue.enqueue(payloadOf("https://a"));
  await queue.enqueue(payloadOf("https://b"));
  whenFetch(
    () => jsonResponse({ ok: true }, 200), // health
    () => jsonResponse({ id: "s-a" }, 201),
    () => jsonResponse({ id: "s-b" }, 201)
  );
  const result = await flushQueue("http://127.0.0.1:4317");
  assert.equal(result.flushed, 2);
  assert.equal(result.halted, undefined);
  assert.deepEqual(await queue.counters(), { queued: 0, failed: 0 });
});

test("flushQueue: halts on transient mid-loop, bumps attempt", async () => {
  setup();
  const a = await queue.enqueue(payloadOf("https://a"));
  await queue.enqueue(payloadOf("https://b"));
  whenFetch(
    () => jsonResponse({ ok: true }, 200), // health
    () => jsonResponse({ id: "s-a" }, 201), // a ok
    () => emptyResponse(503) // b transient
  );
  const result = await flushQueue("http://127.0.0.1:4317");
  assert.equal(result.flushed, 1);
  assert.equal(result.halted, true);
  const remaining = await queue.list();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].attempts, 1);
  assert.equal(remaining[0].state, "queued");
  assert.ok(remaining[0].nextAttemptAt > clock.time);
  assert.equal(
    remaining.find((e) => e.id === a.entry.id),
    undefined,
    "a should be synced"
  );
});

test("flushQueue: client-error dead-letters immediately", async () => {
  setup();
  await queue.enqueue(payloadOf("https://a"));
  whenFetch(
    () => jsonResponse({ ok: true }, 200), // health
    () => emptyResponse(400) // a 400
  );
  const result = await flushQueue("http://127.0.0.1:4317");
  assert.equal(result.flushed, 0);
  const after = await queue.list();
  assert.equal(after[0].state, "failed");
  assert.equal(after[0].lastError, "HTTP 400");
});

test("flushQueue: skips items whose nextAttemptAt is in the future", async () => {
  setup();
  const { entry } = await queue.enqueue(payloadOf("https://a"));
  await queue.bumpAttempt(entry.id, "previously transient", clock.time + 60_000);
  whenFetch(() => jsonResponse({ ok: true }, 200)); // health only, no items posted
  const result = await flushQueue("http://127.0.0.1:4317");
  assert.equal(result.flushed, 0);
  assert.equal(fetchCalls.length, 1, "only health was called");
  assert.equal((await queue.list())[0].attempts, 1, "unchanged");
});

test("flushQueue: drops orphan index entry when payload missing", async () => {
  const storage = new FakeStorage();
  configureQueue({
    indexedDB: new IDBFactory(),
    storage: storage as unknown as Parameters<typeof configureQueue>[0]["storage"],
    crypto: { randomUUID: () => "ghost-id" },
    now: () => clock.time
  });
  configureSaveActions({
    now: () => clock.time,
    fetch: (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/health")) return jsonResponse({ ok: true }, 200);
      throw new Error("payload POST should not be attempted for orphan");
    }) as typeof fetch
  });

  // Write a phantom index entry directly: no IDB payload exists for it.
  await storage.set({
    "hunter:queue:index": [
      {
        id: "ghost-id",
        canonicalUrl: "https://example.com/ghost",
        host: "example.com",
        title: "Ghost",
        queuedAt: clock.time,
        attempts: 0,
        state: "queued",
        nextAttemptAt: clock.time
      }
    ],
    "hunter:queue:counters": { queued: 1, failed: 0 }
  });

  const result = await flushQueue("http://127.0.0.1:4317");
  assert.equal(result.flushed, 0);
  assert.equal(result.skipped, undefined);
  assert.equal((await queue.list()).length, 0, "orphan removed");
});

test("flushQueue: returns lease-busy when another worker holds it", async () => {
  setup();
  await queue.enqueue(payloadOf("https://a"));

  let releaseFirst: () => void = () => {};
  const firstRunning = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstLease = queue.withLease("worker-A", async () => {
    await firstRunning;
  });
  // Yield so the lease write completes before the flush attempt.
  await new Promise((r) => setTimeout(r, 0));

  const result = await flushQueue("http://127.0.0.1:4317");
  assert.equal(result.skipped, "lease-busy");
  assert.equal(fetchCalls.length, 0, "no HTTP attempted while lease was busy");

  releaseFirst();
  await firstLease;
});

test("pingHealth: 200 → true", async () => {
  setup();
  whenFetch(() => jsonResponse({ ok: true }, 200));
  assert.equal(await pingHealth("http://127.0.0.1:4317"), true);
});

test("pingHealth: 500 → false", async () => {
  setup();
  whenFetch(() => emptyResponse(500));
  assert.equal(await pingHealth("http://127.0.0.1:4317"), false);
});

test("pingHealth: network error → false (no throw)", async () => {
  setup();
  whenFetch(() => {
    throw new TypeError("conn refused");
  });
  assert.equal(await pingHealth("http://127.0.0.1:4317"), false);
});

test("timeout constants are within sensible bounds", () => {
  assert.ok(POST_TIMEOUT_MS >= 1_000 && POST_TIMEOUT_MS <= 10_000);
  assert.ok(FLUSH_POST_TIMEOUT_MS >= POST_TIMEOUT_MS, "flush post may take longer");
  assert.ok(HEALTH_TIMEOUT_MS <= POST_TIMEOUT_MS, "health should fail fast");
});
