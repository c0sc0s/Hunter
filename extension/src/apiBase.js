/**
 * Resolves which local Hunter API the extension should talk to.
 *
 * Why this exists: the desktop sidecar binds the first free port in the
 * 4317–4319 range, so the extension can no longer hardcode 4317. In automatic
 * mode we probe every candidate, verify that it is a Hunter API, rank the
 * sidecars, cache the winner, and fall back to the configured value when no
 * candidate is reachable.
 *
 * Caching policy:
 *   - On a successful probe we remember the URL for PROBE_CACHE_TTL_MS.
 *   - On failure we do NOT cache; the next save re-probes immediately so the
 *     extension picks up the server as soon as it comes online.
 *   - The cache lives in module scope. The service worker may be unloaded by
 *     the browser between events, which simply forces a fresh probe — that is
 *     acceptable: probing 3 ports against a live server is ~1ms; probing all
 *     3 against a dead server is bounded by PROBE_TIMEOUT_MS.
 */

const LOCAL_CANDIDATES = Object.freeze(["http://127.0.0.1:4317", "http://127.0.0.1:4318", "http://127.0.0.1:4319"]);
const DEFAULT_LOCAL_BASE = LOCAL_CANDIDATES[0];

export const PROBE_TIMEOUT_MS = 1500;
export const PROBE_CACHE_TTL_MS = 5 * 60 * 1000;

/** @type {{ key: string; url: string; expiresAt: number } | null} */
let cache = null;

/**
 * For tests: lets you swap fetch, clock, storage, and candidate list. Pass
 * `undefined` for any field you want to leave at the production default.
 *
 * @typedef {object} ApiBaseBackends
 * @property {typeof fetch} [fetch]
 * @property {() => number} [now]
 * @property {{ get: (defaults: Record<string, unknown>) => Promise<Record<string, unknown>> }} [storage]
 * @property {readonly string[]} [candidates]
 *
 * @param {ApiBaseBackends} [overrides]
 */
export function configureApiBase(overrides = {}) {
  if (overrides.fetch) backends.fetch = overrides.fetch;
  if (overrides.now) backends.now = overrides.now;
  if (overrides.storage) backends.storage = overrides.storage;
  if (overrides.candidates) backends.candidates = overrides.candidates;
  cache = null;
}

export function resetApiBaseCache() {
  cache = null;
}

const backends = {
  fetch: typeof fetch === "function" ? fetch.bind(globalThis) : undefined,
  now: () => Date.now(),
  /** @type {{ get: (defaults: Record<string, unknown>) => Promise<Record<string, unknown>> } | undefined} */
  storage: typeof chrome !== "undefined" ? chrome?.storage?.local : undefined,
  candidates: LOCAL_CANDIDATES
};

/**
 * @typedef {object} HealthProbe
 * @property {string} url
 * @property {string} [owner]
 * @property {number} [startedAtMs]
 */

/**
 * Probe a single base URL for `/api/health`. Returns a structured signal only
 * for real Hunter APIs, not arbitrary services that happen to answer 200.
 * Never throws.
 *
 * @param {string} base
 * @returns {Promise<HealthProbe | undefined>}
 */
async function probe(base) {
  if (!backends.fetch) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await backends.fetch(`${base.replace(/\/+$/, "")}/api/health`, {
      method: "GET",
      signal: controller.signal
    });
    if (!response.ok) return undefined;
    const body = await response.json().catch(() => undefined);
    if (!body || body.service !== "hunter-api") return undefined;
    const startedAtMs = typeof body.startedAt === "string" ? Date.parse(body.startedAt) : Number.NaN;
    return {
      url: base,
      owner: typeof body.owner === "string" ? body.owner : undefined,
      startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : undefined
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns true if `value` looks like one of our localhost API origins.
 * Treats default 127.0.0.1:4317 / localhost:4317 as "the user did not pick a
 * custom server", so probing is allowed.
 *
 * @param {string} value
 */
function isLocalhostBase(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:") return false;
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

/**
 * Return the best API base URL right now.
 *
 *   1. If the user has explicitly configured a non-localhost server, respect
 *      it verbatim (no probing).
 *   2. Otherwise consult the cache; if still valid, return it.
 *   3. Otherwise probe and rank the local candidates, then cache the best hit.
 *   4. If every probe fails, return the user-configured base anyway so save
 *      attempts fail loudly (and are queued) at the HTTP layer instead of
 *      silently returning undefined here.
 *
 * @typedef {object} ResolveApiBaseOptions
 * @property {boolean} [preferConfigured] true when the user explicitly chose this local base.
 */

/**
 * @param {string} configuredBase  the user's saved apiBase (or the default)
 * @param {ResolveApiBaseOptions} [options]
 * @returns {Promise<string>}
 */
export async function resolveApiBase(configuredBase, options = {}) {
  const trimmed = configuredBase?.trim() || DEFAULT_LOCAL_BASE;
  const preferConfigured = Boolean(options.preferConfigured);

  if (!isLocalhostBase(trimmed)) {
    return trimmed;
  }

  const cacheKey = `${preferConfigured ? "configured" : "auto"}:${trimmed}`;
  const now = backends.now();
  if (cache && cache.key === cacheKey && cache.expiresAt > now) {
    return cache.url;
  }

  if (preferConfigured) {
    const configuredHit = await probe(trimmed);
    if (configuredHit) {
      cache = { key: cacheKey, url: trimmed, expiresAt: backends.now() + PROBE_CACHE_TTL_MS };
      return trimmed;
    }
    return trimmed;
  }

  const hits = [];
  for (const candidate of listLocalCandidates(trimmed)) {
    const hit = await probe(candidate);
    if (hit) hits.push(hit);
  }

  const best = pickBestLocalCandidate(hits);
  if (best) {
    cache = { key: cacheKey, url: best.url, expiresAt: backends.now() + PROBE_CACHE_TTL_MS };
    return best.url;
  }

  return trimmed;
}

/**
 * Returns the candidate list with the configured local base first, without
 * duplicating it in the default 4317–4319 set.
 *
 * @param {string} configuredBase
 */
export function listLocalCandidates(configuredBase) {
  const trimmed = configuredBase?.trim();
  if (!trimmed || !isLocalhostBase(trimmed)) return [...backends.candidates];
  return [trimmed, ...backends.candidates.filter((candidate) => candidate !== trimmed)];
}

/**
 * @param {HealthProbe[]} hits
 */
function pickBestLocalCandidate(hits) {
  return hits
    .map((hit, order) => ({
      hit,
      order,
      ownerScore: ownerPriority(hit.owner),
      startedAtMs: hit.startedAtMs ?? 0
    }))
    .sort((a, b) => b.ownerScore - a.ownerScore || b.startedAtMs - a.startedAtMs || a.order - b.order)[0]?.hit;
}

/**
 * @param {string | undefined} owner
 */
function ownerPriority(owner) {
  return (
    {
      "electron-packaged": 300,
      "electron-dev": 200,
      standalone: 100
    }[owner || ""] ?? 0
  );
}
