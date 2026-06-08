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
const coverBlendTitle = "Visual Cover Blend Video";
const detailOverflowProbeUrl =
  "https://www.anthropic.com/engineering/building-effective-agents-harness-context-engineering-for-ai-agents-regression-probe";
const articleText = Array.from(
  { length: 9 },
  (_, index) =>
    `Visual contract paragraph ${index + 1} proves the desktop and mobile layouts keep readable captured content, metadata, and controls visible without horizontal overflow.${
      index === 0 ? ` Detail overflow probe: ${detailOverflowProbeUrl}.` : ""
    }`
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
  const visualCoverPng = createVisualCoverPng();
  app.get("/visual-cover.png", (_request, response) => {
    response.setHeader("Content-Type", "image/png");
    response.end(visualCoverPng);
  });
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
  await articleCard.click();
  await page.getByRole("heading", { name: "Description" }).waitFor();
  await detailPane.getByText("Visual contract paragraph 1").waitFor();
  await assertDefaultDetailPanelWidth(detailPane);
  assert.equal(
    await detailPane.locator("[data-cover-image]").count(),
    0,
    "no-cover seeded item detail should not render a cover image placeholder"
  );
  await assertCoverCardBlendLayer(page);
  await assertLibraryItemGridSizing(page);
  await assertNoCoverCardIsCompact(page, "desktop no-cover card");
  await assertItemCardHoverSurface(page);
  await page.waitForTimeout(400);

  await assertVisible(detailPane.getByRole("link", { name: "Open link" }), "desktop open link");
  await assertVisible(page.getByPlaceholder("Search saved items"), "desktop Search input");
  await assertNoHorizontalOverflow(page, "desktop");
  await assertDetailPaneNoInlineOverflow(page, "desktop detail");
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
  await assertDetailPaneNoInlineOverflow(page, "desktop detail");
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
  await page.getByRole("heading", { name: "Description" }).last().waitFor();
  await dialog.getByText("Visual contract paragraph 1").waitFor();
  assert.equal(await dialog.locator("[data-cover-image]").count(), 0, "mobile no-cover detail should not render a cover image placeholder");
  await assertVisible(dialog.getByRole("link", { name: "Open link" }), "mobile open link");
  await assertNoHorizontalOverflow(page, "mobile detail");
  await assertScreenshot(page, "mobile-detail.png", { minBytes: 35_000, width: 390, height: 844 });
}

async function seedLibrary(): Promise<void> {
  const coverImageUrl = `${apiBase}/visual-cover.png`;
  const coverBlendText = Array.from(
    { length: 6 },
    (_, index) =>
      `Visual cover blend paragraph ${index + 1} proves card imagery can use a blurred, masked continuation instead of a hard image-to-body cut while keeping metadata and actions readable.`
  ).join(" ");
  const coverItem = await postItem({
    url: "http://visual.example/videos/cover-blend",
    tags: ["cover", "blend"],
    note: "visual cover blend item",
    snapshot: {
      url: "http://visual.example/videos/cover-blend",
      canonicalUrl: "http://visual.example/videos/cover-blend",
      title: coverBlendTitle,
      siteName: "Visual Video",
      textContent: coverBlendText,
      excerpt: "A deterministic video-like item for Hunter cover blend coverage.",
      imageCandidates: [coverImageUrl],
      html: `<!doctype html><html><head><title>${coverBlendTitle}</title><meta property="og:title" content="${coverBlendTitle}" /><meta property="og:image" content="${coverImageUrl}" /><meta property="og:description" content="A deterministic video-like item for Hunter cover blend coverage." /></head><body><main><article><h1>${coverBlendTitle}</h1><p>${coverBlendText}</p></article></main></body></html>`
    }
  });
  await waitForApiItem((item) => item.id === coverItem.id && item.enrichmentState !== "processing" && item.coverImage === coverImageUrl);

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
      html: `<!doctype html><html><head><title>${articleTitle}</title><meta property="og:title" content="${articleTitle}" /><meta name="description" content="A deterministic article for Hunter visual contract coverage." /></head><body><main><article><h1>${articleTitle}</h1><p>${articleText}</p><blockquote>Description content should remain readable in the simplified detail panel.</blockquote></article></main></body></html>`
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

async function assertDetailPaneNoInlineOverflow(page: Page, label: string): Promise<void> {
  const overflowers = await page.evaluate(() => {
    const detailPane = document.querySelector('aside[aria-label="Item detail"]');
    if (!detailPane) {
      return [{ selector: "aside[aria-label='Item detail']", clientWidth: 0, scrollWidth: 0, text: "missing detail pane" }];
    }

    return Array.from(
      detailPane.querySelectorAll(
        "[data-slot='scroll-area'], [data-slot='scroll-area-viewport'], .hunter-detail-content, .hunter-detail-wrap, a[href]"
      )
    )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: element.getAttribute("class") || element.getAttribute("data-slot") || element.tagName.toLowerCase(),
          clientWidth: element.clientWidth,
          rectWidth: Math.round(rect.width),
          scrollWidth: element.scrollWidth,
          text: (element.textContent || "").trim().slice(0, 80)
        };
      })
      .filter((entry) => entry.scrollWidth > Math.ceil(entry.clientWidth || entry.rectWidth) + 2);
  });

  assert.deepEqual(overflowers, [], `${label} should wrap long title, URL, and overview text without inline overflow`);
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
  assert.ok(
    expandedBox && expandedBox.width >= 258 && expandedBox.width <= 270,
    `desktop sidebar should start at the compact expanded width: ${JSON.stringify(expandedBox)}`
  );

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
      (document.querySelector('aside[aria-label="Library navigation"]')?.getBoundingClientRect().width ?? 0) >= 258
  );
  const reexpandedBox = await sidebar.boundingBox();
  assert.ok(
    reexpandedBox && reexpandedBox.width >= 258 && reexpandedBox.width <= 270,
    `expand button should restore compact sidebar width: ${JSON.stringify(reexpandedBox)}`
  );
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

async function assertLibraryItemGridSizing(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Number(document.querySelector(".hunter-library-masonry")?.getAttribute("data-column-count") ?? "0") >= 2
  );
  const state = await page
    .locator(".hunter-library-masonry")
    .first()
    .evaluate((element) => {
      const masonryStyle = window.getComputedStyle(element);
      const columns = Array.from(element.querySelectorAll(".hunter-library-masonry-column"));
      const cards = Array.from(element.querySelectorAll("[data-library-item-card]"));
      return {
        cardHeights: cards.slice(0, 4).map((card) => card.getBoundingClientRect().height),
        cardWidths: cards.slice(0, 4).map((card) => card.getBoundingClientRect().width),
        columnCount: columns.length,
        display: masonryStyle.display
      };
    });

  assert.equal(state.display, "flex", "library items should use a measured masonry feed instead of fixed breakpoint columns");
  assert.ok(state.columnCount >= 2, `desktop library should fit multiple automatically-sized item columns: ${JSON.stringify(state)}`);
  for (const width of state.cardWidths) {
    assert.ok(width >= 276, `desktop item card should keep a readable minimum width: ${width}`);
    assert.ok(width <= 326, `desktop item card should not stretch into an oversized wide card: ${width}`);
  }
  assert.ok(
    Math.max(...state.cardHeights) - Math.min(...state.cardHeights) > 40,
    `masonry feed should preserve content-driven card heights: ${JSON.stringify(state.cardHeights)}`
  );
}

async function assertCoverCardBlendLayer(page: Page): Promise<void> {
  const coverCard = page.locator('[data-library-item-card][data-has-cover="true"]').first();
  await assertVisible(coverCard, "desktop cover blend card");
  const state = await coverCard.evaluate((element) => {
    const cover = element.querySelector(".hunter-item-card-cover");
    const image = element.querySelector(".hunter-item-card-cover .hunter-cover-image");
    const scrim = element.querySelector(".hunter-item-card-cover .hunter-cover-bottom-scrim");
    const bleed = element.querySelector(".hunter-item-card-cover-bleed");
    const fade = element.querySelector(".hunter-item-card-cover-fade");
    const coverStyle = cover ? window.getComputedStyle(cover) : null;
    const imageStyle = image ? window.getComputedStyle(image) : null;
    const bleedStyle = bleed ? window.getComputedStyle(bleed) : null;
    const fadeStyle = fade ? window.getComputedStyle(fade) : null;

    return {
      bleedFilter: bleedStyle?.filter ?? "",
      bleedMask: bleedStyle?.maskImage ?? "",
      bleedOpacity: Number(bleedStyle?.opacity ?? "0"),
      bleedPosition: bleedStyle?.position ?? "",
      bleedZIndex: bleedStyle?.zIndex ?? "",
      coverBoxShadow: coverStyle?.boxShadow ?? "",
      coverBorderBottomWidth: coverStyle?.borderBottomWidth ?? "",
      coverHeight: Number.parseFloat(coverStyle?.height ?? "0"),
      fadeBackground: fadeStyle?.backgroundImage ?? "",
      fadeDisplay: fadeStyle?.display ?? "",
      fadeHeight: fadeStyle?.height ?? "",
      imageMask: imageStyle?.maskImage ?? "",
      scrimPresent: Boolean(scrim)
    };
  });

  assert.equal(state.coverBorderBottomWidth, "0px", "cover card should not use a hard border-bottom image/body cut");
  assert.equal(state.coverBoxShadow, "none", "cover card should not draw a bottom separator shadow");
  assert.ok(
    state.coverHeight >= 208 && state.coverHeight <= 220,
    `cover media area should stay compact enough for list scanning: ${state.coverHeight}px`
  );
  assert.equal(state.imageMask, "none", "cover image should stay crisp while a full media scrim carries the text area");
  assert.equal(state.scrimPresent, false, "cover card should not keep a dead bottom scrim element");
  assert.equal(state.bleedPosition, "absolute", "cover card should use an absolute blurred image continuation layer");
  assert.equal(state.bleedZIndex, "1", "cover card blurred continuation should sit behind content instead of forming a visible block");
  assert.match(state.bleedFilter, /blur/, "cover card image continuation should be blurred");
  assert.ok(state.bleedOpacity > 0.1 && state.bleedOpacity < 0.5, `cover blend opacity should stay subtle: ${state.bleedOpacity}`);
  assert.match(state.bleedMask, /gradient/, "cover card image continuation should fade through a mask gradient");
  assert.notEqual(state.fadeDisplay, "none", "cover card should use a full-height media scrim rather than a narrow transition band");
  assert.match(
    state.fadeBackground,
    /radial-gradient|linear-gradient/,
    "cover card media scrim should combine image-like color and dark readability gradients"
  );
  assert.ok(Number.parseFloat(state.fadeHeight) > 200, `cover card media scrim should cover the hero area: ${state.fadeHeight}`);
}

async function assertItemCardHoverSurface(page: Page): Promise<void> {
  const card = page.locator('[data-library-item-card][data-selected="false"]').first();
  const stateModel = await card.evaluate((element) => {
    const originalSelected = element.getAttribute("data-selected");
    const originalCurrent = element.getAttribute("aria-current");
    const footer = element.querySelector(".hunter-item-card-footer");

    element.setAttribute("data-selected", "false");
    element.removeAttribute("aria-current");
    const idleStyle = window.getComputedStyle(element);
    const idleBeforeStyle = window.getComputedStyle(element, "::before");
    const idleOverlayStyle = window.getComputedStyle(element, "::after");
    const idleFooterStyle = footer ? window.getComputedStyle(footer) : null;
    const idle = {
      beforeContent: idleBeforeStyle.content,
      borderColor: idleStyle.borderColor,
      borderStyle: idleStyle.borderStyle,
      borderWidth: idleStyle.borderWidth,
      footerBackgroundColor: idleFooterStyle?.backgroundColor ?? "",
      footerBackgroundImage: idleFooterStyle?.backgroundImage ?? "",
      footerBorderTopWidth: idleFooterStyle?.borderTopWidth ?? "",
      footerBorderRadius: idleFooterStyle?.borderRadius ?? "",
      overlayContent: idleOverlayStyle.content
    };

    element.setAttribute("data-selected", "true");
    element.setAttribute("aria-current", "true");
    const selectedStyle = window.getComputedStyle(element);
    const selectedBeforeStyle = window.getComputedStyle(element, "::before");
    const selectedOverlayStyle = window.getComputedStyle(element, "::after");
    const selectedFooterStyle = footer ? window.getComputedStyle(footer) : null;
    const selected = {
      beforeContent: selectedBeforeStyle.content,
      borderColor: selectedStyle.borderColor,
      borderStyle: selectedStyle.borderStyle,
      borderWidth: selectedStyle.borderWidth,
      footerBackgroundColor: selectedFooterStyle?.backgroundColor ?? "",
      footerBackgroundImage: selectedFooterStyle?.backgroundImage ?? "",
      footerBorderTopWidth: selectedFooterStyle?.borderTopWidth ?? "",
      footerBorderRadius: selectedFooterStyle?.borderRadius ?? "",
      overlayContent: selectedOverlayStyle.content
    };

    if (originalSelected === null) {
      element.removeAttribute("data-selected");
    } else {
      element.setAttribute("data-selected", originalSelected);
    }
    if (originalCurrent === null) {
      element.removeAttribute("aria-current");
    } else {
      element.setAttribute("aria-current", originalCurrent);
    }

    return { idle, selected };
  });

  await card.hover();
  const state = await card.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const beforeStyle = window.getComputedStyle(element, "::before");
    const overlayStyle = window.getComputedStyle(element, "::after");
    const footer = element.querySelector(".hunter-item-card-footer");
    const footerStyle = footer ? window.getComputedStyle(footer) : null;

    return {
      beforeContent: beforeStyle.content,
      borderColor: style.borderColor,
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      boxShadow: style.boxShadow,
      footerBackgroundColor: footerStyle?.backgroundColor ?? "",
      footerBackgroundImage: footerStyle?.backgroundImage ?? "",
      footerBorderTopWidth: footerStyle?.borderTopWidth ?? "",
      footerBorderRadius: footerStyle?.borderRadius ?? "",
      overlayContent: overlayStyle.content,
      transform: style.transform
    };
  });

  assert.notEqual(
    stateModel.idle.borderColor,
    stateModel.selected.borderColor,
    "selected item card should use the real border as its state"
  );
  assert.equal(stateModel.idle.beforeContent, "none", "idle item card should not draw a decorative hover hairline");
  assert.equal(stateModel.selected.beforeContent, "none", "selected item card should not draw a decorative hover hairline");
  assert.equal(stateModel.idle.overlayContent, "none", "idle item card should not use a pseudo overlay border");
  assert.equal(stateModel.selected.overlayContent, "none", "selected item card should not use a pseudo overlay border");
  assert.equal(stateModel.idle.borderStyle, "solid", "idle item card should keep one explicit border style");
  assert.equal(stateModel.selected.borderStyle, "solid", "selected item card should keep one explicit border style");
  assert.equal(stateModel.idle.borderWidth, "1px", "idle item card should keep one explicit 1px border");
  assert.equal(stateModel.selected.borderWidth, "1px", "selected item card should keep one explicit 1px border");
  assert.equal(
    stateModel.selected.footerBackgroundColor,
    "rgba(0, 0, 0, 0)",
    "selected item card footer should not paint a separate bottom surface"
  );
  assert.equal(stateModel.selected.footerBackgroundImage, "none", "selected item card footer should not layer another bottom background");
  assert.equal(stateModel.idle.footerBorderTopWidth, "0px", "idle item card footer should not draw a section divider");
  assert.equal(stateModel.selected.footerBorderTopWidth, "0px", "selected item card footer should not draw a section divider");
  assert.equal(stateModel.selected.footerBorderRadius, "0px", "selected item card footer should let the outer card own the bottom radius");
  assert.notEqual(state.transform, "none", "item card hover should use a subtle transform");
  assert.match(state.boxShadow, /rgba?\(/, "item card hover shadow should be rendered");
  assert.equal(state.beforeContent, "none", "item card hover should not draw a decorative hairline");
  assert.equal(state.overlayContent, "none", "item card state borders should be owned by the real border, not a pseudo overlay");
  assert.notEqual(state.borderColor, "rgba(0, 0, 0, 0)", "item card hover border should remain present but subtle");
  assert.equal(state.borderStyle, "solid", "item card hover should keep one explicit border style");
  assert.equal(state.borderWidth, "1px", "item card hover should keep one explicit 1px border");
  assert.equal(state.footerBackgroundColor, "rgba(0, 0, 0, 0)", "item card footer should not paint a separate bottom surface");
  assert.equal(state.footerBackgroundImage, "none", "item card footer should not layer another background over rounded corners");
  assert.equal(state.footerBorderTopWidth, "0px", "item card hover footer should not draw a section divider");
  assert.equal(state.footerBorderRadius, "0px", "item card footer should let the outer card own the bottom radius");
  await page.mouse.move(12, 12);
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

function createVisualCoverPng(): Buffer {
  const width = 720;
  const height = 405;
  const png = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (width * y + x) << 2;
      const horizontal = x / width;
      const vertical = y / height;
      const glow = Math.max(0, 1 - Math.hypot(x - width * 0.74, y - height * 0.36) / 210);
      const stripe = Math.sin((x + y * 1.45) / 34) > 0.45 ? 1 : 0;

      png.data[offset] = Math.round(28 + horizontal * 62 + glow * 135 + stripe * 18);
      png.data[offset + 1] = Math.round(68 + vertical * 56 + glow * 42);
      png.data[offset + 2] = Math.round(132 + (1 - horizontal) * 64 + glow * 22 + stripe * 28);
      png.data[offset + 3] = 255;
    }
  }

  return PNG.sync.write(png);
}
