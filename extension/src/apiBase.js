/**
 * Resolves which local Hunter API the extension should talk to.
 *
 * Why this exists: the desktop sidecar binds the first free port in the
 * 4317–4319 range, so the extension can no longer hardcode 4317. We probe the
 * candidates, cache the winner, and fall back to the user-configured value
 * when the user has pointed the extension at a non-local server.
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

export const PROBE_TIMEOUT_MS = 1500;
export const PROBE_CACHE_TTL_MS = 5 * 60 * 1000;

/** @type {{ url: string; expiresAt: number } | null} */
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
 * Probe a single base URL for `/api/health`. Returns true iff it answers 200
 * within PROBE_TIMEOUT_MS. Never throws.
 *
 * @param {string} base
 */
async function probe(base) {
  if (!backends.fetch) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await backends.fetch(`${base.replace(/\/+$/, "")}/api/health`, {
      method: "GET",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
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
 *   3. Otherwise probe the local candidates in order and cache the first hit.
 *   4. If every probe fails, return the user-configured base anyway so save
 *      attempts fail loudly (and are queued) at the HTTP layer instead of
 *      silently returning undefined here.
 *
 * @param {string} configuredBase  the user's saved apiBase (or the default)
 * @returns {Promise<string>}
 */
export async function resolveApiBase(configuredBase) {
  const trimmed = configuredBase?.trim() || LOCAL_CANDIDATES[0];

  if (!isLocalhostBase(trimmed)) {
    return trimmed;
  }

  const now = backends.now();
  if (cache && cache.expiresAt > now) {
    return cache.url;
  }

  for (const candidate of listLocalCandidates(trimmed)) {
    if (await probe(candidate)) {
      cache = { url: candidate, expiresAt: backends.now() + PROBE_CACHE_TTL_MS };
      return candidate;
    }
  }

  return trimmed;
}

/**
 * Returns the candidate list including the user-configured base when it is a
 * localhost URL outside the default 4317–4319 set. Used by callers that want
 * to enumerate every plausible local origin (e.g. flush triggers).
 *
 * @param {string} configuredBase
 */
export function listLocalCandidates(configuredBase) {
  const trimmed = configuredBase?.trim();
  if (!trimmed || !isLocalhostBase(trimmed)) return [...backends.candidates];
  if (backends.candidates.includes(trimmed)) return [...backends.candidates];
  return [trimmed, ...backends.candidates];
}
