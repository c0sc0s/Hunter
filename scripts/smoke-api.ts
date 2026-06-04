import assert from "node:assert/strict";
import type { Server } from "node:http";

process.env.HUNTER_DISABLE_LISTEN = "true";
process.env.HUNTER_REPOSITORY = "sqlite";
process.env.HUNTER_SQLITE_PATH = ":memory:";
process.env.HUNTER_SQLITE_IMPORT_JSON = "false";

const { app } = await import("../server/index");

const server = await new Promise<Server>((resolve) => {
  const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
});
const address = server.address();
assert.ok(address && typeof address === "object", "API server did not bind to a local port");

const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const health = await getJson<{ ok: boolean; service: string }>("/api/health");
  assert.equal(health.ok, true);
  assert.equal(health.service, "hunter-api");

  const sources = await getJson<{ sources: Array<{ id: string; label: string }> }>("/api/sources");
  assert.deepEqual(
    sources.sources.map((source) => source.id),
    ["feishu", "x", "pdf", "generic-web"]
  );

  const missingSnapshot = await postRaw("/api/items", { url: "https://example.com/article" });
  assert.equal(missingSnapshot.status, 400, "POST /api/items without snapshot must return 400");

  const articleText =
    "Snapshot-only capture replaces server-side fetching. " +
    "The browser extension hands us the visible DOM, selected text, and metadata. ".repeat(20);
  const article = await postJson<{
    id: string;
    canonicalUrl: string;
    title: string;
    sourceType: string;
    enrichmentState: string;
  }>("/api/items", {
    url: "https://example.com/article",
    snapshot: {
      url: "https://example.com/article",
      title: "Snapshot first capture",
      textContent: articleText,
      excerpt: articleText.slice(0, 280),
      siteName: "Example",
      html: `<html><body><article><h1>Snapshot first capture</h1><p>${articleText}</p></article></body></html>`
    }
  });
  assert.equal(article.enrichmentState, "processing");

  const recognizedArticle = await waitForItem<{
    id: string;
    enrichmentState: string;
    readableText?: string;
    recognitionDurationMs?: number;
    captureInput?: unknown;
  }>(article.id, "ready");
  assert.ok(recognizedArticle.readableText && recognizedArticle.readableText.length >= 200);
  assert.equal(typeof recognizedArticle.recognitionDurationMs, "number");
  assert.equal("captureInput" in recognizedArticle, false);

  const patched = await patchJson<{
    id: string;
    status: string;
    favorite: boolean;
    tags: string[];
  }>(`/api/items/${article.id}`, {
    status: "reading",
    favorite: true,
    tags: ["smoke"]
  });
  assert.equal(patched.status, "reading");
  assert.equal(patched.favorite, true);
  assert.deepEqual(patched.tags, ["smoke"]);

  const refreshed = await postJson<{
    id: string;
    enrichmentState: string;
    status: string;
    favorite: boolean;
    tags: string[];
    readableText?: string;
  }>(`/api/items/${article.id}/enrich`, undefined, 200);
  assert.equal(refreshed.enrichmentState, "ready");
  assert.equal(refreshed.status, "reading");
  assert.equal(refreshed.favorite, true);
  assert.ok(refreshed.tags.includes("smoke"));
  assert.ok(refreshed.readableText && refreshed.readableText.length >= 200);

  const captureEvents = await getJson<{
    events: Array<{
      itemId?: string;
      snapshotBytes: number;
      resultState: string;
    }>;
  }>("/api/capture-events?limit=20");
  assert.ok(captureEvents.events.some((event) => event.itemId === article.id && event.resultState === "ready" && event.snapshotBytes > 0));
  assert.equal(JSON.stringify(captureEvents).includes(articleText), false);

  const deleted = await deleteRaw(`/api/items/${article.id}`);
  assert.equal(deleted.status, 204, "DELETE /api/items/:id must return 204");

  console.log("api smoke passed");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.ok, true, `${path} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown, expectedStatus = 201): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  assert.equal(response.status, expectedStatus, `${path} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  assert.equal(response.ok, true, `${path} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function postRaw(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function deleteRaw(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: "DELETE" });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForItem<T extends { id: string; enrichmentState: string }>(id: string, state: string): Promise<T> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const library = await getJson<{ items: T[] }>("/api/items");
    const item = library.items.find((candidate) => candidate.id === id);
    if (item?.enrichmentState === state) return item;
    await wait(50);
  }

  throw new Error(`Timed out waiting for ${id} to reach ${state}`);
}
