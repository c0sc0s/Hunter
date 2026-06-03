import assert from "node:assert/strict";
import type { Server } from "node:http";

process.env.HUNTTER_DISABLE_LISTEN = "true";
process.env.HUNTTER_REPOSITORY = "sqlite";
process.env.HUNTTER_SQLITE_PATH = ":memory:";
process.env.HUNTTER_SQLITE_IMPORT_JSON = "false";
process.env.HUNTTER_CONNECTOR_SECRET_KEY = "smoke-connector-secret";
delete process.env.HUNTTER_FEISHU_CLIENT_ID;
delete process.env.HUNTTER_FEISHU_CLIENT_SECRET;
delete process.env.HUNTTER_FEISHU_REDIRECT_URI;
delete process.env.HUNTTER_FEISHU_SCOPES;

const { app } = await import("../server/index");
const { libraryRepository } = await import("../server/repository");

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
  assert.equal(connectors.connectors[0]?.availability, "available");
  assert.equal(connectors.connectors[1]?.availability, "planned");

  const missingFeishuOAuth = await postJson<{ error: string; missing: string[] }>("/api/connectors/feishu/oauth/start", undefined, 409);
  assert.deepEqual(missingFeishuOAuth.missing, ["HUNTTER_FEISHU_CLIENT_ID", "HUNTTER_FEISHU_CLIENT_SECRET"]);

  process.env.HUNTTER_FEISHU_CLIENT_ID = "cli_a_test";
  process.env.HUNTTER_FEISHU_CLIENT_SECRET = "feishu-secret";
  process.env.HUNTTER_FEISHU_REDIRECT_URI = `${baseUrl}/api/connectors/feishu/oauth/callback`;
  process.env.HUNTTER_FEISHU_SCOPES = "offline_access docx:document:readonly";

  const oauthStart = await postJson<{
    provider: string;
    authorizationUrl: string;
    redirectUri: string;
    scopes: string[];
    state: string;
    expiresAt: string;
  }>("/api/connectors/feishu/oauth/start", undefined, 200);
  assert.equal(oauthStart.provider, "feishu");
  assert.equal(oauthStart.redirectUri, `${baseUrl}/api/connectors/feishu/oauth/callback`);
  assert.deepEqual(oauthStart.scopes, ["offline_access", "docx:document:readonly"]);
  assert.match(oauthStart.expiresAt, /^20/);

  const authorizationUrl = new URL(oauthStart.authorizationUrl);
  assert.equal(authorizationUrl.origin, "https://accounts.feishu.cn");
  assert.equal(authorizationUrl.pathname, "/open-apis/authen/v1/authorize");
  assert.equal(authorizationUrl.searchParams.get("client_id"), "cli_a_test");
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), `${baseUrl}/api/connectors/feishu/oauth/callback`);
  assert.equal(authorizationUrl.searchParams.get("state"), oauthStart.state);
  assert.equal(authorizationUrl.searchParams.get("scope"), "offline_access docx:document:readonly");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizationUrl.searchParams.get("code_challenge"));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    if (requestUrl === "https://open.feishu.cn/open-apis/authen/v2/oauth/token") {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      assert.equal(body.grant_type, "authorization_code");
      assert.equal(body.client_id, "cli_a_test");
      assert.equal(body.client_secret, "feishu-secret");
      assert.equal(body.code, "oauth-code");
      assert.equal(body.redirect_uri, `${baseUrl}/api/connectors/feishu/oauth/callback`);
      assert.ok(body.code_verifier);
      return jsonResponse({
        code: 0,
        data: {
          access_token: "u-test-access-token",
          refresh_token: "u-test-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_expires_in: 7200,
          scope: "offline_access docx:document:readonly"
        }
      });
    }

    if (requestUrl === "https://open.feishu.cn/open-apis/authen/v1/user_info") {
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer u-test-access-token");
      return jsonResponse({ code: 0, data: { name: "Huntter Feishu User", open_id: "ou_test" } });
    }

    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const oauthCallback = await getJson<{ connector: { provider: string; connectionState: string; accountLabel?: string } }>(
      `/api/connectors/feishu/oauth/callback?code=oauth-code&state=${oauthStart.state}`
    );
    assert.equal(oauthCallback.connector.provider, "feishu");
    assert.equal(oauthCallback.connector.connectionState, "connected");
    assert.equal(oauthCallback.connector.accountLabel, "Huntter Feishu User");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const credential = await libraryRepository.getConnectorCredential("feishu");
  assert.ok(credential);
  assert.equal(credential.tokenType, "Bearer");
  assert.equal(credential.scope, "offline_access docx:document:readonly");
  assert.equal(credential.accessTokenCiphertext.includes("u-test-access-token"), false);
  assert.equal(credential.refreshTokenCiphertext?.includes("u-test-refresh-token"), false);

  const directFeishuDocUrl = "https://bytedance.larkoffice.com/docx/doxbcmEtbFrbbq10nPNu8gO1F3b";
  const directFeishu = await postJson<{ id: string; enrichmentState: string; captureInput?: unknown }>("/api/items", {
    url: directFeishuDocUrl,
    tags: ["connector-sync"]
  });
  assert.equal(directFeishu.enrichmentState, "processing");
  const connectorNeededFeishu = await waitForItem<{
    id: string;
    enrichmentState: string;
    requiredConnector?: string;
    captureInput?: unknown;
  }>(directFeishu.id, "needs_connector");
  assert.equal(connectorNeededFeishu.requiredConnector, "feishu");
  assert.equal("captureInput" in connectorNeededFeishu, false);

  const importedFeishuText = Array.from(
    { length: 8 },
    (_, index) =>
      `Feishu connector imported paragraph ${index + 1} proves raw content can replace URL-only connector-needed items without browser snapshots.`
  ).join(" ");
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    if (requestUrl === "https://open.feishu.cn/open-apis/docx/v1/documents/doxbcmEtbFrbbq10nPNu8gO1F3b/raw_content?lang=0") {
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer u-test-access-token");
      return jsonResponse({ code: 0, data: { content: importedFeishuText } });
    }

    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const feishuImportSync = await postJson<{
      connector: { provider: string; connectionState: string; lastSyncAt?: string };
      imported: number;
      skipped: number;
      failed: number;
      message?: string;
    }>("/api/connectors/feishu/sync", undefined, 200);
    assert.equal(feishuImportSync.connector.provider, "feishu");
    assert.equal(feishuImportSync.connector.connectionState, "connected");
    assert.match(feishuImportSync.connector.lastSyncAt ?? "", /^20/);
    assert.equal(feishuImportSync.imported, 1);
    assert.equal(feishuImportSync.skipped, 0);
    assert.equal(feishuImportSync.failed, 0);
    assert.match(feishuImportSync.message ?? "", /imported 1/i);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const importedFeishu = await waitForItem<{
    id: string;
    enrichmentState: string;
    captureMethod?: string;
    sourceAccess?: string;
    requiredConnector?: string;
    readableText?: string;
    contentHtml?: string;
    contentHash?: string;
    captureInput?: unknown;
  }>(directFeishu.id, "ready");
  assert.equal(importedFeishu.captureMethod, "connector");
  assert.equal(importedFeishu.sourceAccess, "requires_auth");
  assert.equal(importedFeishu.requiredConnector, undefined);
  assert.match(importedFeishu.readableText ?? "", /raw content can replace URL-only connector-needed items/);
  assert.match(importedFeishu.contentHtml ?? "", /raw content can replace URL-only connector-needed items/);
  assert.match(importedFeishu.contentHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal("captureInput" in importedFeishu, false);

  const feishuImportEvents = await getJson<{
    events: Array<{
      itemId?: string;
      captureMethod: string;
      snapshotBytes: number;
      resultState: string;
    }>;
  }>("/api/capture-events?limit=20");
  assert.ok(
    feishuImportEvents.events.some(
      (event) =>
        event.itemId === directFeishu.id &&
        event.captureMethod === "connector" &&
        event.snapshotBytes === 0 &&
        event.resultState === "ready"
    )
  );
  assert.equal(JSON.stringify(feishuImportEvents).includes(importedFeishuText), false);

  const disconnectedFeishuConnector = await deleteJson<{ connector: { provider: string; connectionState: string; accountLabel?: string } }>(
    "/api/connectors/feishu"
  );
  assert.equal(disconnectedFeishuConnector.connector.provider, "feishu");
  assert.equal(disconnectedFeishuConnector.connector.connectionState, "not_connected");
  assert.equal(disconnectedFeishuConnector.connector.accountLabel, undefined);
  assert.equal(await libraryRepository.getConnectorCredential("feishu"), undefined);

  const patchedFeishuConnector = await patchJson<{
    connector: { provider: string; label: string; connectionState: string; accountLabel?: string; lastError?: string };
  }>("/api/connectors/feishu", {
    connectionState: "error",
    accountLabel: "Docs Bot",
    lastError: "missing document scope"
  });
  assert.equal(patchedFeishuConnector.connector.provider, "feishu");
  assert.equal(patchedFeishuConnector.connector.label, "Feishu / Lark");
  assert.equal(patchedFeishuConnector.connector.connectionState, "error");
  assert.equal(patchedFeishuConnector.connector.accountLabel, "Docs Bot");
  assert.equal(patchedFeishuConnector.connector.lastError, "missing document scope");

  const feishuConnector = await getJson<{ provider: string; connectionState: string; lastError?: string }>("/api/connectors/feishu");
  assert.equal(feishuConnector.connectionState, "error");
  assert.equal(feishuConnector.lastError, "missing document scope");

  const feishuSync = await postJson<{ reason: string; error: string }>("/api/connectors/feishu/sync", undefined, 409);
  assert.equal(feishuSync.reason, "not_connected");
  assert.match(feishuSync.error, /not connected/i);

  const patchedXConnector = await patchJson<{
    connector: { provider: string; connectionState: string; accountLabel?: string; connectedAt?: string };
  }>("/api/connectors/x", {
    connectionState: "connected",
    accountLabel: "@huntter-test"
  });
  assert.equal(patchedXConnector.connector.provider, "x");
  assert.equal(patchedXConnector.connector.connectionState, "connected");
  assert.equal(patchedXConnector.connector.accountLabel, "@huntter-test");
  assert.match(patchedXConnector.connector.connectedAt ?? "", /^20/);

  const xSync = await postJson<{ reason: string; error: string }>("/api/connectors/x/sync", undefined, 501);
  assert.equal(xSync.reason, "not_available");
  assert.match(xSync.error, /not available yet/i);

  const disconnectedXConnector = await deleteJson<{ connector: { provider: string; connectionState: string; accountLabel?: string } }>(
    "/api/connectors/x"
  );
  assert.equal(disconnectedXConnector.connector.provider, "x");
  assert.equal(disconnectedXConnector.connector.connectionState, "not_connected");
  assert.equal(disconnectedXConnector.connector.accountLabel, undefined);

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
  const createdLibraryItem = library.items.find((item) => item.id === created.id);
  assert.ok(createdLibraryItem);
  assert.equal(createdLibraryItem.enrichmentState, "needs_connector");
  assert.equal(createdLibraryItem.sourceAccess, "connector_required");
  assert.equal(createdLibraryItem.requiredConnector, "feishu");
  assert.equal(createdLibraryItem.recognitionVersion, 1);
  assert.match(createdLibraryItem.recognizedAt ?? "", /^20/);
  assert.equal(typeof createdLibraryItem.recognitionDurationMs, "number");
  assert.equal(createdLibraryItem.recognitionTiming?.totalMs, createdLibraryItem.recognitionDurationMs);
  assert.equal(typeof createdLibraryItem.recognitionTiming?.sourceAdapterMs, "number");
  assert.match(createdLibraryItem.contentHash ?? "", /^[a-f0-9]{64}$/);

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

async function deleteJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { method: "DELETE" });
  assert.equal(response.ok, true, `${path} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
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
