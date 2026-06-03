import assert from "node:assert/strict";
import type { Server } from "node:http";

process.env.HUNTTER_DISABLE_LISTEN = "true";
process.env.HUNTTER_REPOSITORY = "sqlite";
process.env.HUNTTER_SQLITE_PATH = ":memory:";
process.env.HUNTTER_SQLITE_IMPORT_JSON = "false";

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
  assert.equal(health.service, "huntter-api");

  const sources = await getJson<{ sources: Array<{ id: string; label: string }> }>("/api/sources");
  assert.deepEqual(
    sources.sources.map((source) => source.id),
    ["feishu", "x", "pdf", "video", "generic-web"]
  );

  const connectors = await getJson<{ connectors: Array<{ provider: string; connectionState: string; availability: string }> }>(
    "/api/connectors"
  );
  assert.deepEqual(
    connectors.connectors.map((connector) => connector.provider),
    ["feishu", "x"]
  );
  assert.equal(connectors.connectors[0]?.connectionState, "not_connected");
  assert.equal(connectors.connectors[0]?.availability, "planned");

  const created = await postJson<{
    id: string;
    sourceType: string;
    enrichmentState: string;
    sourceMessage?: string;
    requiredConnector?: string;
    recognitionVersion?: number;
    recognitionDurationMs?: number;
    recognitionTiming?: {
      totalMs: number;
      sourceAdapterMs: number;
      contentSignalsMs: number;
      itemBuildMs: number;
    };
    contentHash?: string;
    captureInput?: unknown;
  }>("/api/items", {
    url: "https://bytedance.larkoffice.com/wiki/SjaPwstMjiA2f4khXz1cX6vFnLg",
    tags: ["smoke"]
  });

  assert.equal(created.sourceType, "feishu");
  assert.equal(created.enrichmentState, "processing");
  assert.equal(created.recognitionVersion, 1);
  assert.match(created.contentHash ?? "", /^[a-f0-9]{64}$/);
  assert.match(created.sourceMessage ?? "", /extracting content/i);
  assert.equal("captureInput" in created, false);

  await wait(50);

  const library = await getJson<{
    items: Array<{
      id: string;
      enrichmentState: string;
      sourceAccess?: string;
      requiredConnector?: string;
      recognitionVersion?: number;
      recognizedAt?: string;
      recognitionDurationMs?: number;
      recognitionTiming?: {
        totalMs: number;
        sourceAdapterMs: number;
        contentSignalsMs: number;
        itemBuildMs: number;
      };
      contentHash?: string;
    }>;
  }>("/api/items");
  assert.equal(library.items.length, 1);
  assert.equal(library.items[0]?.id, created.id);
  assert.equal(library.items[0]?.enrichmentState, "needs_connector");
  assert.equal(library.items[0]?.sourceAccess, "connector_required");
  assert.equal(library.items[0]?.requiredConnector, "feishu");
  assert.equal(library.items[0]?.recognitionVersion, 1);
  assert.match(library.items[0]?.recognizedAt ?? "", /^20/);
  assert.equal(typeof library.items[0]?.recognitionDurationMs, "number");
  assert.equal(library.items[0]?.recognitionTiming?.totalMs, library.items[0]?.recognitionDurationMs);
  assert.equal(typeof library.items[0]?.recognitionTiming?.sourceAdapterMs, "number");
  assert.match(library.items[0]?.contentHash ?? "", /^[a-f0-9]{64}$/);

  const feishuCaptureEvents = await getJson<{
    events: Array<{
      itemId?: string;
      sourceUrl: string;
      captureMethod: string;
      snapshotBytes: number;
      resultState: string;
      recognitionDurationMs?: number;
      contentHash?: string;
    }>;
  }>("/api/capture-events?limit=10");

  assert.ok(feishuCaptureEvents.events.some((event) => event.itemId === created.id && event.resultState === "processing"));
  assert.ok(
    feishuCaptureEvents.events.some(
      (event) =>
        event.itemId === created.id &&
        event.resultState === "needs_connector" &&
        event.captureMethod === "url_fetch" &&
        event.snapshotBytes === 0 &&
        typeof event.recognitionDurationMs === "number" &&
        /^[a-f0-9]{64}$/.test(event.contentHash ?? "")
    )
  );

  const patched = await patchJson<{ id: string; status: string; favorite: boolean }>(`/api/items/${created.id}`, {
    status: "reading",
    favorite: true
  });

  assert.equal(patched.status, "reading");
  assert.equal(patched.favorite, true);

  const privateFeishuText = Array.from(
    { length: 8 },
    (_, index) =>
      `Private Feishu refresh paragraph ${index + 1} proves that manual refresh reuses the original browser snapshot and preserves user workflow fields.`
  ).join(" ");
  const privateFeishu = await postJson<{
    id: string;
    enrichmentState: string;
    captureInput?: unknown;
  }>("/api/items", {
    url: "https://bytedance.larkoffice.com/docx/HuntterPrivateRefreshDoc",
    tags: ["private"],
    note: "initial private note",
    snapshot: {
      url: "https://bytedance.larkoffice.com/docx/HuntterPrivateRefreshDoc",
      title: "Private Feishu Refresh Doc",
      siteName: "Feishu",
      textContent: privateFeishuText,
      html: `<main><h1>Private Feishu Refresh Doc</h1><p>${privateFeishuText}</p></main>`
    }
  });

  assert.equal(privateFeishu.enrichmentState, "processing");
  assert.equal("captureInput" in privateFeishu, false);

  const recognizedPrivateFeishu = await waitForItem<{
    id: string;
    enrichmentState: string;
    sourceAccess?: string;
    readableText?: string;
    recognitionDurationMs?: number;
    recognitionTiming?: {
      totalMs: number;
      sourceAdapterMs: number;
      contentSignalsMs: number;
      itemBuildMs: number;
    };
    captureInput?: unknown;
  }>(privateFeishu.id, "ready");
  assert.equal(recognizedPrivateFeishu.sourceAccess, "browser_snapshot");
  assert.match(recognizedPrivateFeishu.readableText ?? "", /manual refresh reuses the original browser snapshot/);
  assert.equal("captureInput" in recognizedPrivateFeishu, false);

  const patchedPrivateFeishu = await patchJson<{
    id: string;
    status: string;
    favorite: boolean;
    note?: string;
    tags: string[];
  }>(`/api/items/${privateFeishu.id}`, {
    status: "reading",
    favorite: true,
    note: "user refresh note",
    tags: ["user-tag"]
  });

  assert.equal(patchedPrivateFeishu.status, "reading");
  assert.equal(patchedPrivateFeishu.favorite, true);
  assert.equal(patchedPrivateFeishu.note, "user refresh note");
  assert.deepEqual(patchedPrivateFeishu.tags, ["user-tag"]);

  const refreshedPrivateFeishu = await postJson<{
    id: string;
    enrichmentState: string;
    sourceAccess?: string;
    status: string;
    favorite: boolean;
    note?: string;
    tags: string[];
    readableText?: string;
    recognitionDurationMs?: number;
    recognitionTiming?: {
      totalMs: number;
      sourceAdapterMs: number;
      contentSignalsMs: number;
      itemBuildMs: number;
    };
    captureInput?: unknown;
  }>(`/api/items/${privateFeishu.id}/enrich`, undefined, 200);

  assert.equal(refreshedPrivateFeishu.enrichmentState, "ready");
  assert.equal(refreshedPrivateFeishu.sourceAccess, "browser_snapshot");
  assert.equal(refreshedPrivateFeishu.status, "reading");
  assert.equal(refreshedPrivateFeishu.favorite, true);
  assert.equal(refreshedPrivateFeishu.note, "user refresh note");
  assert.ok(refreshedPrivateFeishu.tags.includes("user-tag"));
  assert.equal(typeof refreshedPrivateFeishu.recognitionDurationMs, "number");
  assert.equal(refreshedPrivateFeishu.recognitionTiming?.totalMs, refreshedPrivateFeishu.recognitionDurationMs);
  assert.match(refreshedPrivateFeishu.readableText ?? "", /manual refresh reuses the original browser snapshot/);
  assert.equal("captureInput" in refreshedPrivateFeishu, false);

  const allCaptureEvents = await getJson<{
    events: Array<{
      itemId?: string;
      captureMethod: string;
      snapshotBytes: number;
      resultState: string;
    }>;
  }>("/api/capture-events?limit=20");

  assert.ok(
    allCaptureEvents.events.some(
      (event) =>
        event.itemId === privateFeishu.id &&
        event.resultState === "ready" &&
        event.captureMethod === "extension_snapshot" &&
        event.snapshotBytes > 0
    )
  );
  assert.equal(JSON.stringify(allCaptureEvents).includes(privateFeishuText), false);

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForItem<T extends { id: string; enrichmentState: string }>(id: string, state: string): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const library = await getJson<{ items: T[] }>("/api/items");
    const item = library.items.find((candidate) => candidate.id === id);
    if (item?.enrichmentState === state) return item;
    await wait(25);
  }

  throw new Error(`Timed out waiting for ${id} to reach ${state}`);
}
