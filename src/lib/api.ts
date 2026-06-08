import type {
  AgentIncrementalClassificationResponse,
  AgentLlmSettings,
  CaptureEventsResponse,
  LibraryQuery,
  LibraryResponse,
  PublicLibraryItem,
  UpdateAgentLlmSettingsInput,
  UpdateItemInput
} from "../../shared/types";
import { getDesktopBridge, type HunterDesktopBridge } from "./desktopBridge";

// Single owner of the HTTP API contract on the client. Routes that change here
// should change in one place; components and hooks tell, they don't ask.

// In the Electron shell the renderer loads from Vite/dev or file://, so a
// relative `/api/...` URL would not reliably reach the Node sidecar. We
// discover the sidecar's chosen port (4317-4319) through the preload bridge.
// In a regular browser context the Vite dev proxy / same-origin path keeps the
// empty-string base correct.
const apiBasePromise: Promise<string> = resolveApiBase();

async function resolveApiBase(): Promise<string> {
  const bridge = getDesktopBridge() ?? (await waitForDesktopBridge());
  if (!bridge) return "";
  try {
    return await resolveDesktopApiBase(bridge);
  } catch (error) {
    console.warn("[hunter] could not resolve desktop API base", error);
    return "";
  }
}

async function waitForDesktopBridge(): Promise<ReturnType<typeof getDesktopBridge>> {
  if (!inElectronRenderer()) return undefined;

  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const bridge = getDesktopBridge();
    if (bridge) return bridge;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

function inElectronRenderer(): boolean {
  if (typeof navigator === "undefined") return false;
  return /\bElectron\//.test(navigator.userAgent);
}

/**
 * The webview is created before the sidecar finishes its port handshake, so
 * the first IPC request for the API base may return null. We race two
 * sources to avoid the deadlock:
 *
 *   - `hunter:api-ready` event from Electron when the sidecar announces its
 *     port. Cheap and instant when it arrives.
 *   - Polling `getApiBase` — covers the case where the event fired before our
 *     listener attached, or arrived but was lost to a webview hiccup.
 *
 * Bound the wait at 15s (10s sidecar timeout + 5s buffer). If we still
 * have nothing, fall back to "" so the first fetch fails visibly instead of
 * freezing the UI on a startup spinner.
 */
const SIDECAR_WAIT_MS = 15_000;
const SIDECAR_POLL_MS = 250;

async function resolveDesktopApiBase(bridge: HunterDesktopBridge): Promise<string> {
  const readBase = () => bridge.getApiBase().then(nonEmpty);

  const immediate = await readBase();
  if (immediate) return immediate;

  return new Promise<string>((resolve) => {
    const unlisten = bridge.onApiReady((payload) => {
      const value = nonEmpty(payload?.base);
      if (value) settle(value);
    });
    let settled = false;

    // `settle` runs in event handlers and timers, all of which fire after the
    // const handles below are initialised — TDZ never bites us here.
    const settle = (value: string) => {
      if (settled) return;
      settled = true;
      unlisten?.();
      clearInterval(pollHandle);
      clearTimeout(timeoutHandle);
      resolve(value);
    };

    const pollHandle = setInterval(() => {
      readBase()
        .then((value) => {
          if (value) settle(value);
        })
        .catch(() => {
          /* next tick retries */
        });
    }, SIDECAR_POLL_MS);

    const timeoutHandle = setTimeout(() => {
      console.warn(`[hunter] sidecar did not announce an API base within ${SIDECAR_WAIT_MS}ms`);
      settle("");
    }, SIDECAR_WAIT_MS);
  });
}

function nonEmpty(value: string | null | undefined): string {
  return typeof value === "string" && value.length > 0 ? value : "";
}

async function url(path: string): Promise<string> {
  const base = await apiBasePromise;
  return `${base}${path}`;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export async function fetchLibrary(query: LibraryQuery & { offset?: number; limit?: number }): Promise<LibraryResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.filter && query.filter !== "all") params.set("filter", query.filter);
  if (query.sourceType) params.set("sourceType", query.sourceType);
  if (query.agentCategoryId) params.set("agentCategoryId", query.agentCategoryId);
  if (query.q?.trim()) params.set("q", query.q.trim());

  return getJson<LibraryResponse>(await url(`/api/items?${params.toString()}`));
}

export async function patchLibraryItem(id: string, patch: UpdateItemInput): Promise<PublicLibraryItem> {
  return sendJson<PublicLibraryItem>(await url(`/api/items/${encodeURIComponent(id)}`), "PATCH", patch);
}

export async function classifyLibraryItem(id: string): Promise<PublicLibraryItem> {
  return sendJson<PublicLibraryItem>(await url(`/api/agent/items/${encodeURIComponent(id)}/classify`), "POST", undefined);
}

export async function classifyIncrementalLibraryItems(limit = 6): Promise<AgentIncrementalClassificationResponse> {
  return sendJson<AgentIncrementalClassificationResponse>(await url("/api/agent/items/classify-missing"), "POST", { limit });
}

export async function fetchAgentLlmStatus(): Promise<{ ok: boolean; error?: string }> {
  return getJson<{ ok: boolean; error?: string }>(await url("/api/agent/local-llm"));
}

export async function fetchAgentLlmSettings(): Promise<AgentLlmSettings> {
  return getJson<AgentLlmSettings>(await url("/api/agent/settings"));
}

export async function saveAgentLlmSettings(input: UpdateAgentLlmSettingsInput): Promise<AgentLlmSettings> {
  return sendJson<AgentLlmSettings>(await url("/api/agent/settings"), "PATCH", input);
}

export async function deleteLibraryItem(id: string): Promise<void> {
  const response = await fetch(await url(`/api/items/${encodeURIComponent(id)}`), { method: "DELETE" });
  if (!response.ok && response.status !== 204) {
    throw new ApiError(response.status, `Could not delete item: HTTP ${response.status}`);
  }
}

export async function fetchCaptureEvents(limit = 50): Promise<CaptureEventsResponse> {
  return getJson<CaptureEventsResponse>(await url(`/api/capture-events?limit=${encodeURIComponent(limit)}`));
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw await apiError(response, "Request failed");
  return (await response.json()) as T;
}

async function sendJson<T>(url: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) throw await apiError(response, "Request failed");
  return (await response.json()) as T;
}

async function apiError(response: Response, fallback: string): Promise<ApiError> {
  return new ApiError(response.status, await errorMessage(response, fallback));
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; code?: unknown };
    const message = typeof body.error === "string" && body.error.trim() ? body.error.trim() : fallback;
    const code = typeof body.code === "string" && body.code.trim() ? body.code.trim() : undefined;
    return code ? `${message} (${code})` : message;
  } catch {
    return `${fallback}: HTTP ${response.status}`;
  }
}
