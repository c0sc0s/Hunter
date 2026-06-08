import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { PROBE_CACHE_TTL_MS, configureApiBase, listLocalCandidates, resetApiBaseCache, resolveApiBase } from "../src/apiBase.js";

type FetchCall = { url: string; init?: RequestInit };

function makeFetch(responder: (url: string) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return responder(url);
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

function ok(owner = "standalone", startedAt = "2026-06-04T00:00:00.000Z", status = 200) {
  return new Response(JSON.stringify({ ok: true, service: "hunter-api", owner, startedAt }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function notFound() {
  return new Response("nope", { status: 404 });
}

const clock = { time: 1_000_000 };

beforeEach(() => {
  clock.time = 1_000_000;
  // Reset apiBase module state by reconfiguring with no overrides; we then
  // install fresh backends per test.
  resetApiBaseCache();
});

test("resolveApiBase: returns user value verbatim when non-localhost", async () => {
  const { fn, calls } = makeFetch(() => ok());
  configureApiBase({ fetch: fn, now: () => clock.time, candidates: ["http://127.0.0.1:4317"] });

  const result = await resolveApiBase("https://my-hunter.example.com");
  assert.equal(result, "https://my-hunter.example.com");
  assert.equal(calls.length, 0, "no probing for remote bases");
});

test("resolveApiBase: probes candidates and returns first healthy Hunter API for equal rank", async () => {
  const { fn, calls } = makeFetch((url) => {
    if (url.startsWith("http://127.0.0.1:4317")) return notFound();
    if (url.startsWith("http://127.0.0.1:4318")) return ok();
    return notFound();
  });
  configureApiBase({
    fetch: fn,
    now: () => clock.time,
    candidates: ["http://127.0.0.1:4317", "http://127.0.0.1:4318", "http://127.0.0.1:4319"]
  });

  const result = await resolveApiBase("http://127.0.0.1:4317");
  assert.equal(result, "http://127.0.0.1:4318");
  assert.equal(calls.length, 3, "probes all candidates so it can rank competing sidecars");
  assert.match(calls[0].url, /\/api\/health$/);
});

test("resolveApiBase: probes a configured off-list localhost base before default candidates", async () => {
  const { fn, calls } = makeFetch((url) => {
    if (url.startsWith("http://127.0.0.1:49152")) return ok();
    if (url.startsWith("http://127.0.0.1:4317")) return ok();
    return notFound();
  });
  configureApiBase({
    fetch: fn,
    now: () => clock.time,
    candidates: ["http://127.0.0.1:4317"]
  });

  const result = await resolveApiBase("http://127.0.0.1:49152", { preferConfigured: true });
  assert.equal(result, "http://127.0.0.1:49152");
  assert.equal(calls.length, 1, "configured localhost base should win when healthy");
  assert.match(calls[0].url, /^http:\/\/127\.0\.0\.1:49152\/api\/health$/);
});

test("resolveApiBase: default local discovery prefers packaged Electron sidecar over older dev API", async () => {
  const { fn } = makeFetch((url) => {
    if (url.startsWith("http://127.0.0.1:4317")) return ok("electron-dev", "2026-06-04T12:00:00.000Z");
    if (url.startsWith("http://127.0.0.1:4318")) return ok("electron-packaged", "2026-06-04T11:00:00.000Z");
    return notFound();
  });
  configureApiBase({
    fetch: fn,
    now: () => clock.time,
    candidates: ["http://127.0.0.1:4317", "http://127.0.0.1:4318", "http://127.0.0.1:4319"]
  });

  const result = await resolveApiBase("http://127.0.0.1:4317");
  assert.equal(result, "http://127.0.0.1:4318");
});

test("resolveApiBase: explicit local config wins over automatic sidecar ranking", async () => {
  const { fn, calls } = makeFetch((url) => {
    if (url.startsWith("http://127.0.0.1:4317")) return ok("electron-dev", "2026-06-04T12:00:00.000Z");
    if (url.startsWith("http://127.0.0.1:4318")) return ok("electron-packaged", "2026-06-04T11:00:00.000Z");
    return notFound();
  });
  configureApiBase({
    fetch: fn,
    now: () => clock.time,
    candidates: ["http://127.0.0.1:4317", "http://127.0.0.1:4318"]
  });

  const result = await resolveApiBase("http://127.0.0.1:4317", { preferConfigured: true });
  assert.equal(result, "http://127.0.0.1:4317");
  assert.equal(calls.length, 1, "manual local config probes only the configured origin");
});

test("resolveApiBase: ignores non-Hunter health responses", async () => {
  const { fn } = makeFetch((url) => {
    if (url.startsWith("http://127.0.0.1:4317")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (url.startsWith("http://127.0.0.1:4318")) return ok("electron-dev");
    return notFound();
  });
  configureApiBase({
    fetch: fn,
    now: () => clock.time,
    candidates: ["http://127.0.0.1:4317", "http://127.0.0.1:4318"]
  });

  const result = await resolveApiBase("http://127.0.0.1:4317");
  assert.equal(result, "http://127.0.0.1:4318");
});

test("resolveApiBase: caches a successful probe for TTL", async () => {
  let n = 0;
  const { fn, calls } = makeFetch(() => {
    n += 1;
    return ok();
  });
  configureApiBase({
    fetch: fn,
    now: () => clock.time,
    candidates: ["http://127.0.0.1:4317", "http://127.0.0.1:4318"]
  });

  await resolveApiBase("http://127.0.0.1:4317");
  assert.equal(n, 2, "one full candidate scan");
  assert.equal(calls.length, 2);

  // Within TTL: cache hit, no new probes.
  clock.time += PROBE_CACHE_TTL_MS - 1;
  await resolveApiBase("http://127.0.0.1:4317");
  assert.equal(n, 2, "cache hit within TTL");

  // After TTL: re-probes.
  clock.time += 2;
  await resolveApiBase("http://127.0.0.1:4317");
  assert.equal(n, 4, "re-probe after TTL");
});

test("resolveApiBase: does NOT cache a failed probe", async () => {
  let attempt = 0;
  const { fn, calls } = makeFetch(() => {
    attempt += 1;
    // First three attempts (one round of candidates) all fail.
    if (attempt <= 3) return notFound();
    return attempt === 4 ? ok() : notFound();
  });
  configureApiBase({
    fetch: fn,
    now: () => clock.time,
    candidates: ["http://127.0.0.1:4317", "http://127.0.0.1:4318", "http://127.0.0.1:4319"]
  });

  const first = await resolveApiBase("http://127.0.0.1:4317");
  assert.equal(first, "http://127.0.0.1:4317", "fallback to configured base on full miss");
  assert.equal(calls.length, 3, "probed all candidates");

  // Immediately retry: server now up on first candidate. Must re-probe, not
  // cache the failure.
  const second = await resolveApiBase("http://127.0.0.1:4317");
  assert.equal(second, "http://127.0.0.1:4317");
  assert.equal(calls.length, 6, "re-probed all candidates after failure");
});

test("resolveApiBase: aborted/timed-out probe is treated as miss", async () => {
  const { fn } = makeFetch(async () => {
    // Never resolve until aborted.
    return await new Promise<Response>((_, reject) => {
      setTimeout(() => reject(new Error("simulated abort")), 50);
    });
  });
  configureApiBase({
    fetch: fn,
    now: () => clock.time,
    candidates: ["http://127.0.0.1:4317"]
  });
  const result = await resolveApiBase("http://127.0.0.1:4317");
  // Falls back to configured base because the single candidate hangs/fails.
  assert.equal(result, "http://127.0.0.1:4317");
});

test("resolveApiBase: empty configured base falls back to default candidate list", async () => {
  const { fn, calls } = makeFetch(() => ok());
  configureApiBase({
    fetch: fn,
    now: () => clock.time,
    candidates: ["http://127.0.0.1:4317"]
  });

  const result = await resolveApiBase("   ");
  assert.equal(result, "http://127.0.0.1:4317");
  assert.equal(calls.length, 1);
});

test("listLocalCandidates: includes user's localhost base when off the standard list", () => {
  configureApiBase({
    candidates: ["http://127.0.0.1:4317", "http://127.0.0.1:4318"]
  });
  const candidates = listLocalCandidates("http://localhost:9999");
  assert.deepEqual(candidates, ["http://localhost:9999", "http://127.0.0.1:4317", "http://127.0.0.1:4318"]);
});

test("listLocalCandidates: does not duplicate when user base already in list", () => {
  configureApiBase({
    candidates: ["http://127.0.0.1:4317", "http://127.0.0.1:4318"]
  });
  const candidates = listLocalCandidates("http://127.0.0.1:4318");
  assert.deepEqual(candidates, ["http://127.0.0.1:4318", "http://127.0.0.1:4317"]);
});

test("listLocalCandidates: ignores non-localhost user base", () => {
  configureApiBase({
    candidates: ["http://127.0.0.1:4317"]
  });
  const candidates = listLocalCandidates("https://remote.example.com");
  assert.deepEqual(candidates, ["http://127.0.0.1:4317"]);
});
