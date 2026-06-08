import assert from "node:assert/strict";
import type { Server } from "node:http";
import net from "node:net";
import { chromium } from "playwright";
import { createServer, type ViteDevServer } from "vite";

const apiPort = await getFreePort();
const webPort = await getFreePort();
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;

process.env.HUNTER_DISABLE_LISTEN = "true";
process.env.HUNTER_REPOSITORY = "sqlite";
process.env.HUNTER_SQLITE_PATH = ":memory:";
process.env.HUNTER_SQLITE_IMPORT_JSON = "false";
process.env.HUNTER_API_PROXY_TARGET = apiBase;

let apiServer: Server | undefined;
let viteServer: ViteDevServer | undefined;

try {
  const { app } = await import("../server/index");
  apiServer = await listen(app, apiPort);
  await waitForJson(`${apiBase}/api/health`);

  viteServer = await createServer({
    server: {
      host: "127.0.0.1",
      port: webPort,
      strictPort: true
    }
  });
  await viteServer.listen();
  await waitForText(webBase, "Hunter");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  try {
    await page.goto(webBase);
    await page.getByRole("heading", { name: "Library" }).waitFor();

    const visibleText = Array.from(
      { length: 8 },
      (_, index) =>
        `Browser golden paragraph ${index + 1} proves that the web app can reload extension-style captures after background recognition.`
    ).join(" ");
    const createdSnapshot = (await page.evaluate(
      async (payload) => {
        const response = await fetch("/api/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        return response.json();
      },
      {
        url: "https://bytedance.larkoffice.com/docx/BrowserGoldenSnapshot",
        tags: ["golden", "snapshot"],
        note: "extension-style snapshot from browser golden test",
        snapshot: {
          url: "https://bytedance.larkoffice.com/docx/BrowserGoldenSnapshot",
          title: "Browser Golden Snapshot",
          siteName: "Feishu",
          textContent: visibleText,
          html: `<main><h1>Browser Golden Snapshot</h1><p>${visibleText}</p></main>`
        }
      }
    )) as { id: string; enrichmentState: string; captureInput?: unknown };

    assert.equal(createdSnapshot.enrichmentState, "processing");
    assert.equal("captureInput" in createdSnapshot, false);
    await waitForApiItem((item) => item.id === createdSnapshot.id && item.enrichmentState === "ready");

    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await page.getByText("Browser Golden Snapshot").first().waitFor();
    await page.getByText("Browser Golden Snapshot").first().click();
    await page.getByRole("heading", { name: "Description" }).waitFor();
    await page.getByRole("complementary").getByText("Browser golden paragraph 1").waitFor();
    await page.getByRole("link", { name: "Open link" }).first().waitFor();

    await page.getByPlaceholder("Search saved items").fill("Browser golden paragraph");
    await page.getByText("1 matched").first().waitFor();
    await page.getByRole("button", { name: "Star" }).click();
    await page.evaluate(async (itemId) => {
      await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "read" })
      });
      await fetch(`/api/items/${itemId}/enrich`, { method: "POST" });
    }, createdSnapshot.id);
    await waitForApiItem((item) => item.id === createdSnapshot.id && item.enrichmentState === "ready");

    const library = (await page.evaluate(async () => {
      const response = await fetch("/api/items?q=Browser%20golden%20paragraph");
      return response.json();
    })) as {
      items: Array<{
        id: string;
        title: string;
        enrichmentState: string;
        status: string;
        favorite: boolean;
        readableText?: string;
        captureInput?: unknown;
      }>;
    };
    const item = library.items.find((candidate) => candidate.id === createdSnapshot.id);
    assert.ok(item, "Golden snapshot item should be returned by search");
    assert.equal(item.title, "Browser Golden Snapshot");
    assert.equal(item.enrichmentState, "ready");
    assert.equal(item.status, "read");
    assert.equal(item.favorite, true);
    assert.match(item.readableText ?? "", /web app can reload extension-style captures/);
    assert.equal("captureInput" in item, false);
  } finally {
    await browser.close();
  }

  console.log("browser golden journey passed");
} finally {
  await viteServer?.close();
  await closeServer(apiServer);
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

async function listen(app: { listen: (port: number, host: string, callback: () => void) => Server }, port: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function waitForApiItem(predicate: (item: { id: string; sourceType: string; enrichmentState: string }) => boolean): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${apiBase}/api/items`);
    const library = (await response.json()) as { items: Array<{ id: string; sourceType: string; enrichmentState: string }> };
    if (library.items.some((item) => predicate(item))) return;
    await wait(100);
  }

  throw new Error("Timed out waiting for API item state");
}
