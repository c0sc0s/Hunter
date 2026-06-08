import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import { detectSupportedResourceInPage } from "../src/contentSupport.js";

function withPage(html: string, url = "https://example.com/story") {
  const dom = new JSDOM(html, { url });
  const previousDocument = (globalThis as { document?: Document }).document;
  const previousLocation = (globalThis as { location?: Location }).location;
  const previousWindow = (globalThis as unknown as { window?: Window }).window;
  (globalThis as { document: Document }).document = dom.window.document;
  (globalThis as { location: Location }).location = dom.window.location;
  (globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;
  return () => {
    if (previousDocument) {
      (globalThis as { document: Document }).document = previousDocument;
    } else {
      delete (globalThis as { document?: Document }).document;
    }
    if (previousLocation) {
      (globalThis as { location: Location }).location = previousLocation;
    } else {
      delete (globalThis as { location?: Location }).location;
    }
    if (previousWindow) {
      (globalThis as unknown as { window: Window }).window = previousWindow;
    } else {
      delete (globalThis as unknown as { window?: Window }).window;
    }
  };
}

test("detectSupportedResourceInPage supports article-shaped metadata", () => {
  const restore = withPage(`
    <!doctype html>
    <html>
      <head>
        <meta property="og:type" content="article" />
        <script type="application/ld+json">
          { "@context": "https://schema.org", "@type": "NewsArticle", "headline": "Supported article" }
        </script>
      </head>
      <body></body>
    </html>
  `);
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, true);
    assert.equal(result.kind, "article");
  } finally {
    restore();
  }
});

test("detectSupportedResourceInPage supports article roots without metadata", () => {
  const restore = withPage(`
    <!doctype html>
    <html>
      <body>
        <main>
          <article>
            <h1>Focused article</h1>
            <p>${"Useful article paragraph with durable reading material. ".repeat(6)}</p>
            <p>${"Second paragraph proves this is not just site chrome. ".repeat(6)}</p>
          </article>
        </main>
      </body>
    </html>
  `);
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, true);
    assert.equal(result.kind, "article");
    assert.ok(result.signals.some((signal) => signal.source === "article_root"));
  } finally {
    restore();
  }
});

test("detectSupportedResourceInPage supports common article containers without article/main tags", () => {
  const restore = withPage(`
    <!doctype html>
    <html>
      <body>
        <div class="layout">
          <div class="prose">
            <h1>Field guide</h1>
            <p>${"Useful article paragraph inside a prose container. ".repeat(7)}</p>
            <p>${"Second paragraph proves this page has readable article content. ".repeat(7)}</p>
          </div>
          <aside>${"Sidebar link. ".repeat(80)}</aside>
        </div>
      </body>
    </html>
  `);
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, true);
    assert.equal(result.kind, "article");
    assert.ok(result.signals.some((signal) => signal.source === "article_root"));
  } finally {
    restore();
  }
});

test("detectSupportedResourceInPage supports substantial selected text", () => {
  const restore = withPage("<!doctype html><html><body><p>Short app shell.</p></body></html>");
  const previousSelection = (globalThis as unknown as { window: Window }).window.getSelection;
  (globalThis as unknown as { window: { getSelection: () => { toString: () => string } } }).window.getSelection = () => ({
    toString: () => "Selected article passage ".repeat(12)
  });
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, true);
    assert.equal(result.kind, "article");
    assert.ok(result.signals.some((signal) => signal.source === "selected_text"));
  } finally {
    (globalThis as unknown as { window: { getSelection: typeof previousSelection } }).window.getSelection = previousSelection;
    restore();
  }
});

test("detectSupportedResourceInPage gates X by source route before generic DOM scoring", () => {
  const feed = withPage(
    `
    <!doctype html>
    <html>
      <body>
        <main>
          <article>
            <h2>Feed item</h2>
            <p>${"A long feed card can look article-like but is not the focused resource. ".repeat(8)}</p>
            <p>${"Second paragraph exists only to prove the generic article scorer would be fooled. ".repeat(8)}</p>
          </article>
        </main>
      </body>
    </html>
  `,
    "https://x.com/home"
  );
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, false);
    assert.equal(result.reason, "unsupported_x_route");
  } finally {
    feed();
  }

  const status = withPage("<!doctype html><html><body><main></main></body></html>", "https://x.com/hunter/status/1234567890");
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, true);
    assert.equal(result.kind, "post");
    assert.ok(result.signals.some((signal) => signal.source === "x_status_url"));
  } finally {
    status();
  }

  const article = withPage("<!doctype html><html><body><main></main></body></html>", "https://x.com/i/article/9876543210");
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, true);
    assert.equal(result.kind, "article");
    assert.ok(result.signals.some((signal) => signal.source === "x_article_url"));
  } finally {
    article();
  }

  const userReportedStatus = withPage(
    "<!doctype html><html><body><main></main></body></html>",
    "https://x.com/MinLiBuilds/status/2062068646902689895"
  );
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, true);
    assert.equal(result.kind, "post");
  } finally {
    userReportedStatus();
  }
});

test("detectSupportedResourceInPage supports video-shaped pages", () => {
  const restore = withPage(
    `
    <!doctype html>
    <html>
      <head>
        <meta property="og:type" content="video.other" />
      </head>
      <body>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@graph": [
              { "@type": "WebSite", "name": "Bilibili" },
              { "@type": "VideoObject", "name": "Supported video" }
            ]
          }
        </script>
      </body>
    </html>
  `,
    "https://www.bilibili.com/video/BV1demo/"
  );
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, true);
    assert.equal(result.kind, "video");
    assert.ok(result.signals.some((signal) => signal.source === "json_ld" && signal.value === "VideoObject"));
  } finally {
    restore();
  }
});

test("detectSupportedResourceInPage only accepts concrete YouTube and Vimeo video URLs", () => {
  const youtubeHome = withPage("<!doctype html><html><body></body></html>", "https://www.youtube.com/");
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, false);
    assert.equal(result.kind, "unsupported");
  } finally {
    youtubeHome();
  }

  const youtubeWatch = withPage("<!doctype html><html><body></body></html>", "https://www.youtube.com/watch?v=demo");
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, true);
    assert.equal(result.kind, "video");
  } finally {
    youtubeWatch();
  }

  const userReportedYoutubeWatch = withPage("<!doctype html><html><body></body></html>", "https://www.youtube.com/watch?v=PLyCki2K0Lg");
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, true);
    assert.equal(result.kind, "video");
  } finally {
    userReportedYoutubeWatch();
  }

  const vimeoHome = withPage("<!doctype html><html><body></body></html>", "https://vimeo.com/");
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, false);
  } finally {
    vimeoHome();
  }

  const vimeoVideo = withPage("<!doctype html><html><body></body></html>", "https://vimeo.com/123456789");
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, true);
    assert.equal(result.kind, "video");
  } finally {
    vimeoVideo();
  }
});

test("detectSupportedResourceInPage keeps an article with an embedded video as article", () => {
  const restore = withPage(`
    <!doctype html>
    <html>
      <head><meta property="og:type" content="article" /></head>
      <body>
        <article>
          <h1>Camera field notes</h1>
          <p>${"The written review is the primary resource even with a demo video. ".repeat(5)}</p>
          <p>${"The embedded video should not turn the saved resource into a video item. ".repeat(5)}</p>
          <video src="demo.mp4"></video>
        </article>
      </body>
    </html>
  `);
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, true);
    assert.equal(result.kind, "article");
  } finally {
    restore();
  }
});

test("detectSupportedResourceInPage rejects unsupported product pages", () => {
  const restore = withPage(`
    <!doctype html>
    <html>
      <head>
        <script type="application/ld+json">
          { "@context": "https://schema.org", "@type": "Product", "name": "Desk Lamp" }
        </script>
      </head>
      <body><main><h1>Desk Lamp</h1><p>Buy this lamp today.</p></main></body>
    </html>
  `);
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, false);
    assert.equal(result.kind, "product");
    assert.equal(result.reason, "unsupported_resource_type");
  } finally {
    restore();
  }
});

test("detectSupportedResourceInPage lets structured product signal beat article-like product description", () => {
  const restore = withPage(`
    <!doctype html>
    <html>
      <head>
        <script type="application/ld+json">
          { "@context": "https://schema.org", "@type": "Product", "name": "Desk Lamp" }
        </script>
      </head>
      <body>
        <article>
          <h1>Desk Lamp</h1>
          <p>${"Long product copy with several paragraphs and specs. ".repeat(8)}</p>
          <p>${"This looks text-heavy but the primary resource is still a product. ".repeat(8)}</p>
        </article>
      </body>
    </html>
  `);
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, false);
    assert.equal(result.kind, "product");
  } finally {
    restore();
  }
});

test("detectSupportedResourceInPage rejects unknown pages and PDFs", () => {
  const unknownRestore = withPage("<!doctype html><html><body><p>Just a dashboard.</p></body></html>");
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, false);
    assert.equal(result.kind, "unsupported");
  } finally {
    unknownRestore();
  }

  const pdfRestore = withPage("<!doctype html><html><body>PDF viewer</body></html>", "https://example.com/file.pdf");
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, false);
    assert.equal(result.reason, "pdf_not_supported_by_extension_gate");
  } finally {
    pdfRestore();
  }
});

test("detectSupportedResourceInPage accepts server-aligned youtu.be video hints", () => {
  const restore = withPage("<!doctype html><html><body></body></html>", "https://youtu.be/demo");
  try {
    const result = detectSupportedResourceInPage();
    assert.equal(result.supported, true);
    assert.equal(result.kind, "video");
    assert.ok(result.signals.some((signal) => signal.source === "url_video_host"));
  } finally {
    restore();
  }
});
