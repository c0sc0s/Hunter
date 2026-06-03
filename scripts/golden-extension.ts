import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createServer as createHttpServer } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Worker } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import type { CaptureEventsResponse, LibraryItem, LibraryResponse } from "../shared/types";

type ExtensionSaveResponse = {
  ok: boolean;
  item?: LibraryItem & { captureInput?: unknown };
  error?: string;
};

type ChromeApi = {
  action: {
    openPopup(): Promise<void>;
  };
  runtime: {
    sendMessage(message: Record<string, unknown>): Promise<ExtensionSaveResponse>;
  };
  storage: {
    local: {
      set(values: Record<string, string>): Promise<void>;
    };
  };
  tabs: {
    query(queryInfo: { url: string }): Promise<Array<{ id?: number }>>;
  };
};

declare const chrome: ChromeApi;

const apiPort = await getFreePort();
const webPort = await getFreePort();
const fixturePort = await getFreePort();
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;
const fixtureBase = `http://127.0.0.1:${fixturePort}`;
const fixtureUrl = `${fixtureBase}/article`;
const popupFixtureUrl = `${fixtureBase}/popup-article`;
const fixtureTitle = "Extension Installed Capture Article";
const popupFixtureTitle = "Extension Popup Click Capture Article";
const uniquePhrase =
  "Extension installed E2E paragraph proves the loaded Chrome extension can capture focused article content through its own background worker.";
const popupUniquePhrase = "Popup click E2E paragraph proves the visible extension save button reuses the same background capture pipeline.";

process.env.HUNTTER_DISABLE_LISTEN = "true";
process.env.HUNTTER_REPOSITORY = "sqlite";
process.env.HUNTTER_SQLITE_PATH = ":memory:";
process.env.HUNTTER_SQLITE_IMPORT_JSON = "false";
process.env.HUNTTER_API_PROXY_TARGET = apiBase;

let apiServer: Server | undefined;
let fixtureServer: Server | undefined;
let viteServer: ViteDevServer | undefined;
let context: BrowserContext | undefined;
let tempRoot: string | undefined;

try {
  const { app } = await import("../server/index");
  apiServer = await listenApp(app, apiPort);
  await waitForJson(`${apiBase}/api/health`);

  viteServer = await createServer({
    server: {
      host: "127.0.0.1",
      port: webPort,
      strictPort: true
    }
  });
  await viteServer.listen();
  await waitForText(webBase, "Huntter");

  fixtureServer = createFixtureServer();
  await listenServer(fixtureServer, fixturePort);
  await waitForText(fixtureUrl, fixtureTitle);

  const extensionPath = await prepareExtension(apiBase, fixtureBase);
  const userDataDir = path.join(tempRoot!, "chromium-profile");
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });

  const serviceWorker = await getExtensionWorker(context);
  const extensionId = extensionIdFromWorker(serviceWorker);

  const fixturePage = await context.newPage();
  await fixturePage.goto(fixtureUrl);
  await fixturePage.getByRole("heading", { name: fixtureTitle }).waitFor();
  await fixturePage.bringToFront();

  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/test.html`);
  const saveResponse = (await extensionPage.evaluate(
    async ({ apiBase, fixtureBase }) => {
      await chrome.storage.local.set({ apiBase });
      const [tab] = await chrome.tabs.query({ url: `${fixtureBase}/*` });
      return chrome.runtime.sendMessage({
        type: "huntter-save-active-tab",
        tabId: tab?.id,
        tags: ["extension-e2e"],
        note: "saved through installed extension golden"
      });
    },
    { apiBase, fixtureBase }
  )) as ExtensionSaveResponse;

  assert.equal(saveResponse.ok, true, saveResponse.error);
  assert.ok(saveResponse.item, "Installed extension should return a queued item");
  assert.equal(saveResponse.item.enrichmentState, "processing");
  assert.equal("captureInput" in saveResponse.item, false);

  const savedItem = await waitForApiItem((item) => item.id === saveResponse.item?.id && item.enrichmentState === "ready");
  assert.equal(savedItem.title, fixtureTitle);
  assert.equal(savedItem.sourceType, "article");
  assert.equal(savedItem.sourceAccess, "browser_snapshot");
  assert.equal(savedItem.captureMethod, "extension_snapshot");
  assert.match(savedItem.readableText ?? "", /loaded Chrome extension can capture focused article content/);
  assert.equal("captureInput" in savedItem, false);

  const captureEvents = await waitForCaptureEvent(savedItem.id);
  assert.equal(captureEvents.resultState, "ready");
  assert.equal(captureEvents.captureMethod, "extension_snapshot");
  assert.ok(captureEvents.snapshotBytes > 0, "Capture Event should record snapshot byte size");

  const captureEventsResponse = await fetchJson<CaptureEventsResponse>(`${apiBase}/api/capture-events?limit=20`);
  assert.equal(JSON.stringify(captureEventsResponse).includes(uniquePhrase), false);

  const appPage = await context.newPage();
  await appPage.goto(webBase);
  await appPage.getByRole("heading", { name: "Huntter" }).waitFor();
  await appPage.getByRole("button", { name: "Reload", exact: true }).click();
  await appPage.getByText(fixtureTitle).first().waitFor();
  await appPage.getByText(fixtureTitle).first().click();
  await appPage.getByText("extension_snapshot", { exact: true }).first().waitFor();
  await appPage.getByRole("button", { name: "Reload capture events" }).click();
  await appPage.getByText("Article / extension_snapshot").first().waitFor();
  await appPage.frameLocator(`iframe[title="${fixtureTitle} reader"]`).getByText("loaded Chrome extension can capture").waitFor();

  const popupFixturePage = await context.newPage();
  await popupFixturePage.goto(popupFixtureUrl);
  await popupFixturePage.getByRole("heading", { name: popupFixtureTitle }).waitFor();
  await popupFixturePage.bringToFront();

  await assertToolbarPopupLaunch(serviceWorker);

  const popupTabId = await extensionPage.evaluate(
    async ({ popupFixtureUrl }) => {
      const [tab] = await chrome.tabs.query({ url: popupFixtureUrl });
      return tab?.id;
    },
    { popupFixtureUrl }
  );
  assert.equal(typeof popupTabId, "number", "Popup fixture tab should be visible to the installed extension");

  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tabId=${popupTabId}`);
  await popupPage.getByText(popupFixtureTitle).waitFor();
  await popupPage.locator("#tags").fill("popup-e2e");
  await popupPage.locator("#note").fill("saved through visible popup golden");
  await popupPage.getByRole("button", { name: "Save" }).click();
  await popupPage.getByText("Saved. Click Reload in Huntter.").waitFor();

  const popupSavedItem = await waitForApiItem((item) => item.title === popupFixtureTitle && item.enrichmentState === "ready");
  assert.equal(popupSavedItem.sourceAccess, "browser_snapshot");
  assert.equal(popupSavedItem.captureMethod, "extension_snapshot");
  assert.deepEqual(popupSavedItem.tags, ["popup-e2e"]);
  assert.equal(popupSavedItem.note, "saved through visible popup golden");
  assert.match(popupSavedItem.readableText ?? "", /visible extension save button reuses/);
  assert.equal("captureInput" in popupSavedItem, false);

  await appPage.getByRole("button", { name: "Reload", exact: true }).click();
  await appPage.getByText(popupFixtureTitle).first().waitFor();
  await appPage.getByText(popupFixtureTitle).first().click();
  await appPage.frameLocator(`iframe[title="${popupFixtureTitle} reader"]`).getByText("visible extension save button").waitFor();

  console.log("extension golden journey passed");
} finally {
  await context?.close();
  await viteServer?.close();
  await closeServer(fixtureServer);
  await closeServer(apiServer);
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function prepareExtension(apiOrigin: string, fixtureOrigin: string): Promise<string> {
  tempRoot = await mkdtemp(path.join(tmpdir(), "huntter-extension-golden-"));
  const extensionSource = path.resolve("extension");
  const extensionPath = path.join(tempRoot, "extension");
  await cp(extensionSource, extensionPath, { recursive: true });

  const manifestPath = path.join(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    permissions?: string[];
    host_permissions?: string[];
  };
  manifest.permissions = uniqueValues([...(manifest.permissions ?? []), "tabs"]);
  manifest.host_permissions = uniqueValues([...(manifest.host_permissions ?? []), `${apiOrigin}/*`, `${fixtureOrigin}/*`]);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(extensionPath, "test.html"), "<!doctype html><title>Huntter extension golden</title>");

  return extensionPath;
}

function createFixtureServer(): Server {
  return createHttpServer((request, response) => {
    if (request.url === "/cover.jpg") {
      response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store"
      });
      response.end(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]));
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    const title = request.url === "/popup-article" ? popupFixtureTitle : fixtureTitle;
    const phrase = request.url === "/popup-article" ? popupUniquePhrase : uniquePhrase;
    const description =
      request.url === "/popup-article"
        ? "A deterministic article used by the visible extension popup golden journey."
        : "A deterministic article used by the installed extension golden journey.";

    response.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="Installed extension capture fixture." />
    <meta property="og:image" content="${fixtureBase}/cover.jpg" />
    <meta property="article:published_time" content="2026-06-03T08:30:00.000Z" />
    <link rel="canonical" href="${request.url === "/popup-article" ? popupFixtureUrl : fixtureUrl}" />
  </head>
  <body>
    <header><nav>Navigation chrome that should not dominate extraction.</nav></header>
    <main>
      <article>
        <h1>${title}</h1>
        <p>${phrase}</p>
        <p>This second paragraph gives the recognizer enough readable material to move from queued processing into a ready saved article.</p>
        <p>The fixture intentionally includes a main article root, metadata, and page chrome so the extension extractor has to choose focused content.</p>
        <img src="/cover.jpg" width="640" height="360" alt="Extension capture fixture cover" />
      </article>
    </main>
    <aside>Low-value sidebar text should stay secondary.</aside>
  </body>
</html>`);
  });
}

async function getExtensionWorker(browserContext: BrowserContext): Promise<Worker> {
  return browserContext.serviceWorkers()[0] ?? browserContext.waitForEvent("serviceworker");
}

function extensionIdFromWorker(worker: Worker): string {
  const match = /^chrome-extension:\/\/([^/]+)\//.exec(worker.url());
  assert.ok(match, `Expected extension service worker URL, received ${worker.url()}`);
  return match[1];
}

async function assertToolbarPopupLaunch(worker: Worker): Promise<void> {
  await worker.evaluate(async () => {
    if (!chrome.action?.openPopup) {
      throw new Error("chrome.action.openPopup is not available in this Chromium build");
    }

    await chrome.action.openPopup();
  });
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Could not allocate a free port"));
      });
    });
  });
}

async function listenApp(app: { listen: (port: number, host: string, callback: () => void) => Server }, port: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function listenServer(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });
}

async function waitForJson(url: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server not ready yet
    }
    await wait(100);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForText(url: string, text: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok && (await response.text()).includes(text)) return;
    } catch {
      // server not ready yet
    }
    await wait(100);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForApiItem(predicate: (item: LibraryItem) => boolean): Promise<LibraryItem> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const library = await fetchJson<LibraryResponse>(`${apiBase}/api/items`);
    const item = library.items.find((candidate) => predicate(candidate));
    if (item) return item;
    await wait(100);
  }

  throw new Error("Timed out waiting for installed extension capture item");
}

async function waitForCaptureEvent(itemId: string): Promise<CaptureEventsResponse["events"][number]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetchJson<CaptureEventsResponse>(`${apiBase}/api/capture-events?limit=20`);
    const event = response.events.find((candidate) => candidate.itemId === itemId && candidate.resultState === "ready");
    if (event) return event;
    await wait(100);
  }

  throw new Error("Timed out waiting for installed extension Capture Event");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  assert.equal(response.ok, true, `Expected ${url} to return HTTP 2xx, got ${response.status}`);
  return (await response.json()) as T;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}
