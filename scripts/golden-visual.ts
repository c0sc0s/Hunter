import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import net from "node:net";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { chromium, type Locator, type Page } from "playwright";
import { PNG } from "pngjs";
import { createServer, type ViteDevServer } from "vite";
import type { LibraryItem, LibraryResponse } from "../shared/types";

const apiPort = await getFreePort();
const webPort = await getFreePort();
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;
const artifactDir = path.resolve("artifacts", "visual");
const baselineDir = path.resolve("tests", "visual-baselines", baselinePlatformKey());
const diffDir = path.join(artifactDir, "diffs");
const updateVisualBaselines = process.env.HUNTTER_UPDATE_VISUAL_BASELINES === "true" || process.argv.includes("--update-baselines");
const allowMissingBaseline = process.env.HUNTTER_VISUAL_ALLOW_MISSING_BASELINE === "true";
const maxDiffPixelRatio = Number(process.env.HUNTTER_VISUAL_MAX_DIFF_RATIO ?? "0");
const visualPixelThreshold = Number(process.env.HUNTTER_VISUAL_PIXEL_THRESHOLD ?? "0");
const articleTitle = "Visual Contract Article";
const articleText = Array.from(
  { length: 9 },
  (_, index) =>
    `Visual contract paragraph ${index + 1} proves the desktop and mobile layouts keep readable captured content, metadata, and controls visible without horizontal overflow.`
).join(" ");

process.env.HUNTTER_DISABLE_LISTEN = "true";
process.env.HUNTTER_REPOSITORY = "sqlite";
process.env.HUNTTER_SQLITE_PATH = ":memory:";
process.env.HUNTTER_SQLITE_IMPORT_JSON = "false";
process.env.HUNTTER_API_PROXY_TARGET = apiBase;

let apiServer: Server | undefined;
let viteServer: ViteDevServer | undefined;

try {
  await resetArtifacts();

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
  await waitForText(webBase, "Huntter");

  await seedLibrary();

  const browser = await chromium.launch({ headless: true });
  try {
    const desktop = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1440, height: 1000 } });
    await exerciseDesktop(desktop);

    const mobile = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 390, height: 844 }, isMobile: true });
    await exerciseMobile(mobile);
  } finally {
    await browser.close();
  }

  console.log("visual golden journey passed");
} finally {
  await viteServer?.close();
  await closeServer(apiServer);
}

async function exerciseDesktop(page: Page): Promise<void> {
  await page.goto(webBase);
  await page.getByRole("heading", { name: "Huntter" }).waitFor();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await page.getByText(articleTitle).first().waitFor();
  await page.getByText(articleTitle).first().click();
  await page.getByText("capture events").waitFor();
  await page.getByText("extension_snapshot", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Reload capture events" }).click();
  await page.getByText("Article / extension_snapshot").first().waitFor();
  await page.getByText("needs_connector").first().waitFor();
  await page.frameLocator(`iframe[title="${articleTitle} reader"]`).getByText("Visual contract paragraph 1").waitFor();

  await assertVisible(page.getByRole("button", { name: "Save", exact: true }), "desktop Save button");
  await assertVisible(page.getByRole("button", { name: "Reload", exact: true }), "desktop Reload button");
  await assertVisible(page.getByRole("button", { name: "Connect Feishu / Lark", exact: true }), "desktop Feishu connector connect");
  await assertVisible(page.getByRole("button", { name: "Connect X", exact: true }), "desktop X connector connect");
  await assertVisible(page.getByLabel("Search"), "desktop Search input");
  await assertNoHorizontalOverflow(page, "desktop");
  await assertScreenshot(page, "desktop-library.png", { minBytes: 60_000, width: 1440, height: 1000 });
}

async function exerciseMobile(page: Page): Promise<void> {
  await page.goto(webBase);
  await page.getByRole("heading", { name: "Huntter" }).waitFor();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await page.getByText(articleTitle).first().waitFor();
  await assertNoHorizontalOverflow(page, "mobile library");
  await assertScreenshot(page, "mobile-library.png", { minBytes: 35_000, width: 390, height: 844 });

  await page.getByText(articleTitle).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.getByRole("heading", { name: "Reader" }).last().waitFor();
  await waitForReaderText(dialog.locator(`iframe[title="${articleTitle} reader"]`), "Visual contract paragraph 1");
  await assertVisible(page.getByRole("tab", { name: "unread" }), "mobile unread tab");
  await assertNoHorizontalOverflow(page, "mobile detail");
  await assertScreenshot(page, "mobile-detail.png", { minBytes: 35_000, width: 390, height: 844 });
}

async function seedLibrary(): Promise<void> {
  const connectorItem = await postItem({
    url: "https://bytedance.larkoffice.com/docx/VisualConnectorOnly",
    tags: ["visual", "connector"],
    note: "visual contract connector-needed item"
  });
  await waitForApiItem((item) => item.id === connectorItem.id && item.enrichmentState === "needs_connector");

  const articleItem = await postItem({
    url: "https://visual.example/articles/contract",
    tags: ["visual", "reader"],
    note: "visual contract article item",
    snapshot: {
      url: "https://visual.example/articles/contract",
      canonicalUrl: "https://visual.example/articles/contract",
      title: articleTitle,
      siteName: "Visual Review",
      textContent: articleText,
      excerpt: "A deterministic article for Huntter visual contract coverage.",
      html: `<!doctype html><html><head><title>${articleTitle}</title><meta property="og:title" content="${articleTitle}" /><meta name="description" content="A deterministic article for Huntter visual contract coverage." /></head><body><main><article><h1>${articleTitle}</h1><p>${articleText}</p><blockquote>Reader content should remain readable in the sandboxed detail frame.</blockquote></article></main></body></html>`
    }
  });
  await waitForApiItem((item) => item.id === articleItem.id && item.enrichmentState === "ready");
}

async function postItem(payload: object): Promise<LibraryItem> {
  const response = await fetch(`${apiBase}/api/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(response.ok, true, `Seed item failed with HTTP ${response.status}`);
  return (await response.json()) as LibraryItem;
}

async function assertVisible(locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  assert.ok(box, `${label} should have a bounding box`);
  assert.ok(box.width > 8, `${label} should have visible width`);
  assert.ok(box.height > 8, `${label} should have visible height`);
  const visibleRatio = await locator.evaluate(async (element) => {
    return new Promise<number>((resolve) => {
      const observer = new IntersectionObserver((entries) => {
        resolve(entries[0]?.intersectionRatio ?? 0);
        observer.disconnect();
      });
      observer.observe(element);
    });
  });
  assert.ok(visibleRatio >= 0.95, `${label} should not be clipped`);
}

async function waitForReaderText(frameLocator: Locator, text: string): Promise<void> {
  const element = await frameLocator.elementHandle();
  assert.ok(element, "Reader iframe should exist");
  const frame = await element.contentFrame();
  assert.ok(frame, "Reader iframe should have a content frame");
  await frame.getByText(text).waitFor();
}

async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth
  }));

  assert.ok(
    overflow.scrollWidth <= overflow.clientWidth + 1 && overflow.bodyScrollWidth <= overflow.bodyClientWidth + 1,
    `${label} should not create page-level horizontal overflow: ${JSON.stringify(overflow)}`
  );
}

async function assertScreenshot(
  page: Page,
  fileName: string,
  expected: { minBytes: number; width: number; height: number }
): Promise<void> {
  await stabilizePageForVisualDiff(page);
  const buffer = await page.screenshot({
    path: path.join(artifactDir, fileName),
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    scale: "css"
  });
  const dimensions = pngDimensions(buffer);

  assert.equal(dimensions.width, expected.width);
  assert.equal(dimensions.height, expected.height);
  assert.ok(buffer.byteLength >= expected.minBytes, `${fileName} should contain enough visual information`);
  await assertVisualBaseline(fileName, buffer);
}

async function assertVisualBaseline(fileName: string, actualBuffer: Buffer): Promise<void> {
  await mkdir(baselineDir, { recursive: true });
  const baselinePath = path.join(baselineDir, fileName);

  if (updateVisualBaselines) {
    await writeFile(baselinePath, actualBuffer);
    return;
  }

  let baselineBuffer: Buffer;
  try {
    baselineBuffer = await readFile(baselinePath);
  } catch (error) {
    if (allowMissingBaseline) {
      console.warn(`visual baseline skipped for ${baselinePlatformKey()}: missing ${baselinePath}`);
      return;
    }

    throw new Error(
      `Missing visual baseline ${baselinePath}. Run \`pnpm golden:visual:update\` on ${baselinePlatformKey()} and commit the generated PNGs.`,
      { cause: error }
    );
  }

  const baseline = PNG.sync.read(baselineBuffer);
  const actual = PNG.sync.read(actualBuffer);

  assert.equal(actual.width, baseline.width, `${fileName} width should match baseline`);
  assert.equal(actual.height, baseline.height, `${fileName} height should match baseline`);

  const diff = new PNG({ width: actual.width, height: actual.height });
  const diffPixels = pixelmatch(baseline.data, actual.data, diff.data, actual.width, actual.height, {
    threshold: visualPixelThreshold
  });
  const maxDiffPixels = Math.floor(actual.width * actual.height * maxDiffPixelRatio);

  if (diffPixels > maxDiffPixels) {
    await mkdir(diffDir, { recursive: true });
    const diffPath = path.join(diffDir, fileName);
    await writeFile(diffPath, PNG.sync.write(diff));
    throw new Error(
      `${fileName} differs from ${baselinePath}: ${diffPixels} pixels changed, allowed ${maxDiffPixels}. Diff written to ${diffPath}.`
    );
  }
}

function pngDimensions(buffer: Buffer): { width: number; height: number } {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG", "Screenshot should be PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

async function resetArtifacts(): Promise<void> {
  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });
}

async function stabilizePageForVisualDiff(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  await page.mouse.move(1, 1);
  if (viewport) {
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
  }
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        caret-color: transparent !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }

      [data-visual-dynamic] {
        visibility: hidden !important;
      }
    `
  });
}

function baselinePlatformKey(): string {
  return `${process.platform}-${process.arch}`;
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

async function waitForApiItem(predicate: (item: LibraryItem) => boolean): Promise<LibraryItem> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${apiBase}/api/items`);
    const library = (await response.json()) as LibraryResponse;
    const item = library.items.find((candidate) => predicate(candidate));
    if (item) return item;
    await wait(100);
  }

  throw new Error("Timed out waiting for API item state");
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
