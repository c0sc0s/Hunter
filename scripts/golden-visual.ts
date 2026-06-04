import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import net from "node:net";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { chromium, type Locator, type Page } from "playwright";
import { PNG } from "pngjs";
import { createServer, type ViteDevServer } from "vite";
import type { LibraryResponse, PublicLibraryItem } from "../shared/types";

const apiPort = await getFreePort();
const webPort = await getFreePort();
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;
const artifactDir = path.resolve("artifacts", "visual");
const baselineDir = path.resolve("tests", "visual-baselines", baselinePlatformKey());
const diffDir = path.join(artifactDir, "diffs");
const updateVisualBaselines = process.env.HUNTER_UPDATE_VISUAL_BASELINES === "true" || process.argv.includes("--update-baselines");
const allowMissingBaseline = process.env.HUNTER_VISUAL_ALLOW_MISSING_BASELINE === "true";
const maxDiffPixelRatio = Number(process.env.HUNTER_VISUAL_MAX_DIFF_RATIO ?? "0.0001");
const visualPixelThreshold = Number(process.env.HUNTER_VISUAL_PIXEL_THRESHOLD ?? "0");
const articleTitle = "Visual Contract Article";
const articleText = Array.from(
  { length: 9 },
  (_, index) =>
    `Visual contract paragraph ${index + 1} proves the desktop and mobile layouts keep readable captured content, metadata, and controls visible without horizontal overflow.`
).join(" ");

process.env.HUNTER_DISABLE_LISTEN = "true";
process.env.HUNTER_REPOSITORY = "sqlite";
process.env.HUNTER_SQLITE_PATH = ":memory:";
process.env.HUNTER_SQLITE_IMPORT_JSON = "false";
process.env.HUNTER_API_PROXY_TARGET = apiBase;

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
  await waitForText(webBase, "Hunter");

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
  await page.addInitScript(() => {
    window.localStorage.removeItem("hunter-sidebar-collapsed");
    window.localStorage.removeItem("hunter-detail-panel-width");
  });
  await page.goto(webBase);
  await page.getByRole("heading", { name: "Library" }).waitFor();
  await assertInitialSkeletonPresence(page, "desktop initial skeleton");
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await page.getByText(articleTitle).first().waitFor();
  const articleCard = page.getByText(articleTitle).first();
  const detailPane = page.getByRole("complementary", { name: "Item detail" });
  await page.getByRole("heading", { name: "Overview" }).waitFor();
  await detailPane.getByText("Visual contract paragraph 1").waitFor();
  await assertDefaultDetailPanelWidth(detailPane);
  assert.equal(await page.locator("[data-cover-image]").count(), 0, "no-cover seeded item should not render a cover image placeholder");
  await assertNoCoverCardIsCompact(page, "desktop no-cover card");
  await page.waitForTimeout(400);

  await assertVisible(detailPane.getByRole("link", { name: "Open link" }), "desktop open link");
  await assertVisible(page.getByPlaceholder("Search saved items"), "desktop Search input");
  await assertNoHorizontalOverflow(page, "desktop");
  await assertNoPageVerticalOverflow(page, "desktop");
  await assertSidebarCollapse(page);

  await page.getByPlaceholder("Search saved items").fill("no visual matches");
  await detailPane.getByText("No items in this view").waitFor();
  assert.equal(
    await detailPane.getByRole("link", { name: "Open link" }).count(),
    0,
    "desktop empty detail state should not expose item actions"
  );

  await page.getByPlaceholder("Search saved items").fill("");
  await page.getByText(articleTitle).first().waitFor();
  await detailPane.getByText("Visual contract paragraph 1").waitFor();
  await articleCard.click();
  assert.equal(await page.getByRole("dialog").count(), 0, "desktop item selection should not open the mobile detail dialog");
  await page.waitForTimeout(400);

  await assertVisible(page.getByRole("button", { name: "Reload", exact: true }), "desktop Reload button");
  await assertVisible(detailPane.getByRole("link", { name: "Open link" }), "desktop open link");
  await assertNoHorizontalOverflow(page, "desktop");
  await assertNoPageVerticalOverflow(page, "desktop");
  await assertScreenshot(page, "desktop-library.png", { minBytes: 60_000, width: 1440, height: 1000 });
  await assertDetailPanelResize(page, detailPane);
}

async function exerciseMobile(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.removeItem("hunter-sidebar-collapsed");
    window.localStorage.removeItem("hunter-detail-panel-width");
  });
  await page.goto(webBase);
  await page.getByRole("heading", { name: "Library" }).waitFor();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await page.getByText(articleTitle).first().waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0, "mobile detail sheet should stay closed until item selection");
  await assertNoHorizontalOverflow(page, "mobile library");
  await assertScreenshot(page, "mobile-library.png", { minBytes: 35_000, width: 390, height: 844 });

  await page.getByText(articleTitle).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.getByRole("heading", { name: "Overview" }).last().waitFor();
  await dialog.getByText("Visual contract paragraph 1").waitFor();
  assert.equal(
    await page.locator("[data-cover-image]").count(),
    0,
    "mobile no-cover seeded item should not render a cover image placeholder"
  );
  await assertVisible(dialog.getByRole("link", { name: "Open link" }), "mobile open link");
  await assertNoHorizontalOverflow(page, "mobile detail");
  await assertScreenshot(page, "mobile-detail.png", { minBytes: 35_000, width: 390, height: 844 });
}

async function seedLibrary(): Promise<void> {
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
      excerpt: "A deterministic article for Hunter visual contract coverage.",
      html: `<!doctype html><html><head><title>${articleTitle}</title><meta property="og:title" content="${articleTitle}" /><meta name="description" content="A deterministic article for Hunter visual contract coverage." /></head><body><main><article><h1>${articleTitle}</h1><p>${articleText}</p><blockquote>Overview content should remain readable in the simplified detail panel.</blockquote></article></main></body></html>`
    }
  });
  await waitForApiItem((item) => item.id === articleItem.id && item.enrichmentState === "ready");
}

async function postItem(payload: object): Promise<PublicLibraryItem> {
  const response = await fetch(`${apiBase}/api/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(response.ok, true, `Seed item failed with HTTP ${response.status}`);
  return (await response.json()) as PublicLibraryItem;
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

async function assertNoPageVerticalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    bodyScrollHeight: document.body.scrollHeight,
    bodyClientHeight: document.body.clientHeight
  }));

  assert.ok(
    overflow.scrollHeight <= overflow.clientHeight + 1 && overflow.bodyScrollHeight <= overflow.bodyClientHeight + 1,
    `${label} should keep scrolling inside panes, not on the document: ${JSON.stringify(overflow)}`
  );
}

async function assertSidebarCollapse(page: Page): Promise<void> {
  const sidebar = page.locator('aside[aria-label="Library navigation"]');
  const expandedBox = await sidebar.boundingBox();
  assert.ok(expandedBox && expandedBox.width > 260, `desktop sidebar should start expanded: ${JSON.stringify(expandedBox)}`);

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-sidebar-collapsed="true"]') &&
      (document.querySelector('aside[aria-label="Library navigation"]')?.getBoundingClientRect().width ?? Number.POSITIVE_INFINITY) < 2
  );
  const collapsedBox = await sidebar.boundingBox();
  assert.ok(
    collapsedBox && collapsedBox.width < 2,
    `desktop sidebar should disappear instead of becoming an icon rail: ${JSON.stringify(collapsedBox)}`
  );
  assert.equal(
    await page.getByRole("button", { name: /Show source filters/ }).count(),
    0,
    "collapsed sidebar should not expose a mini menu"
  );
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-sidebar-collapsed="false"]') &&
      (document.querySelector('aside[aria-label="Library navigation"]')?.getBoundingClientRect().width ?? 0) > 260
  );
  const reexpandedBox = await sidebar.boundingBox();
  assert.ok(reexpandedBox && reexpandedBox.width > 260, `expand button should restore sidebar width: ${JSON.stringify(reexpandedBox)}`);
}

async function assertDefaultDetailPanelWidth(detailPane: Locator): Promise<void> {
  const box = await detailPane.boundingBox();
  assert.ok(box, "desktop detail panel should have a bounding box");
  assert.ok(box.width >= 356 && box.width <= 364, `desktop detail panel should default to 360px: ${box.width}`);
}

async function assertDetailPanelResize(page: Page, detailPane: Locator): Promise<void> {
  const resizer = page.locator("[data-detail-resizer]");
  await assertVisible(resizer, "desktop detail resize handle");
  const startBox = await detailPane.boundingBox();
  assert.ok(startBox, "desktop detail panel should be measurable before resizing");

  await dragDetailResizeHandle(page, resizer, -320);
  await page.waitForFunction(
    () => {
      const box = document.querySelector('aside[aria-label="Item detail"]')?.getBoundingClientRect();
      return box ? box.width >= 556 && box.width <= 560 : false;
    },
    undefined,
    { timeout: 2000 }
  );
  const maxBox = await detailPane.boundingBox();
  assert.ok(maxBox, "desktop detail panel should be measurable at max width");
  assert.ok(maxBox.width >= 556 && maxBox.width <= 560, `desktop detail panel should clamp near max width: ${maxBox.width}`);

  await dragDetailResizeHandle(page, resizer, 480);
  await page.waitForFunction(
    () => {
      const box = document.querySelector('aside[aria-label="Item detail"]')?.getBoundingClientRect();
      return box ? box.width >= 320 && box.width <= 324 : false;
    },
    undefined,
    { timeout: 2000 }
  );
  const minBox = await detailPane.boundingBox();
  assert.ok(minBox, "desktop detail panel should be measurable at min width");
  assert.ok(minBox.width >= 320 && minBox.width <= 324, `desktop detail panel should clamp near min width: ${minBox.width}`);
  await assertNoHorizontalOverflow(page, "desktop resized detail");
}

async function dragDetailResizeHandle(page: Page, resizer: Locator, deltaX: number): Promise<void> {
  const handleBox = await resizer.boundingBox();
  assert.ok(handleBox, "desktop detail resize handle should have a bounding box");
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await assertDetailResizeRuntimeState(page, "active");
  await page.mouse.move(startX + deltaX, startY, { steps: 12 });
  await page.mouse.up();
  await assertDetailResizeRuntimeState(page, "idle");
}

async function assertDetailResizeRuntimeState(page: Page, state: "active" | "idle"): Promise<void> {
  const runtimeState = await page.evaluate(() => {
    const layout = document.querySelector("[data-sidebar-collapsed]") as HTMLElement | null;
    const resizer = document.querySelector("[data-detail-resizer]");

    return {
      bodyCursor: document.body.style.cursor,
      bodyUserSelect: document.body.style.userSelect,
      detailResizing: layout?.getAttribute("data-detail-resizing") ?? null,
      resizerResizing: resizer?.getAttribute("data-resizing") ?? null,
      shieldVisible: Boolean(document.querySelector("[data-detail-resize-shield]")),
      transition: layout?.style.transition ?? "",
      willChange: layout?.style.willChange ?? ""
    };
  });

  if (state === "active") {
    assert.deepEqual(runtimeState, {
      bodyCursor: "col-resize",
      bodyUserSelect: "none",
      detailResizing: "true",
      resizerResizing: "true",
      shieldVisible: true,
      transition: "none",
      willChange: "grid-template-columns"
    });
    return;
  }

  assert.deepEqual(runtimeState, {
    bodyCursor: "",
    bodyUserSelect: "",
    detailResizing: null,
    resizerResizing: null,
    shieldVisible: false,
    transition: "",
    willChange: ""
  });
}

async function assertNoCoverCardIsCompact(page: Page, label: string): Promise<void> {
  const box = await page.locator('[data-library-item-card][data-has-cover="false"]').first().boundingBox();
  assert.ok(box, `${label} should render a card`);
  assert.ok(box.height < 230, `${label} should use natural masonry height instead of a fixed tall card: ${box.height}`);
}

async function assertInitialSkeletonPresence(page: Page, label: string): Promise<void> {
  const skeleton = page.locator("[data-loading-grid]");
  await skeleton.waitFor();
  const visibleAt = Date.now();
  await skeleton.waitFor({ state: "detached" });
  const elapsedMs = Date.now() - visibleAt;
  assert.ok(elapsedMs >= 320, `${label} should not flash for only a single frame: ${elapsedMs}ms`);
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

async function waitForApiItem(predicate: (item: PublicLibraryItem) => boolean): Promise<PublicLibraryItem> {
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
