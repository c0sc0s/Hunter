import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import { collectCoverCandidatesInPage, upgradeCdnCoverResolution } from "../src/coverPreview.js";
import { upgradeCdnCoverResolution as sharedUpgradeCdnCoverResolution } from "../../shared/coverImageUrl";

// Behavior parity with shared/coverImageUrl.ts (used by both the server-side
// `selectCoverImage` and the web client `Cover` component). When the popup,
// the server, or the web client renders a B站 cover, all three paths must
// agree on the upgraded URL.
test("upgradeCdnCoverResolution rewrites B站 thumbnail directives to @1280w.webp", () => {
  assert.equal(
    upgradeCdnCoverResolution("https://i0.hdslb.com/bfs/archive/abc.jpg@189w_107h.webp"),
    "https://i0.hdslb.com/bfs/archive/abc.jpg@1280w.webp"
  );
  assert.equal(
    upgradeCdnCoverResolution("https://i1.hdslb.com/bfs/archive/abc.jpg@100w_100h_1c.png"),
    "https://i1.hdslb.com/bfs/archive/abc.jpg@1280w.webp"
  );
});

test("upgradeCdnCoverResolution leaves already-large variants alone", () => {
  assert.equal(
    upgradeCdnCoverResolution("https://i2.hdslb.com/bfs/archive/abc.jpg@1920w.webp"),
    "https://i2.hdslb.com/bfs/archive/abc.jpg@1920w.webp"
  );
});

test("upgradeCdnCoverResolution ignores URLs without an hdslb resize directive", () => {
  assert.equal(upgradeCdnCoverResolution("https://i0.hdslb.com/bfs/archive/abc.jpg"), "https://i0.hdslb.com/bfs/archive/abc.jpg");
  assert.equal(upgradeCdnCoverResolution("https://cdn.example.com/img.jpg@100w.webp"), "https://cdn.example.com/img.jpg@100w.webp");
  assert.equal(upgradeCdnCoverResolution("not-a-url"), "not-a-url");
});

// Hand-synced parity guard: the extension cannot import `shared/coverImageUrl.ts`
// at runtime, so any drift between the two copies is invisible to production
// until someone hits the divergent input. This fixture list covers every
// branch in both copies (host gate, missing directive, width-already-large,
// rewrite, non-URL input, http→https-irrelevant case). Add a fixture whenever
// either copy gains a new branch.
const parityFixtures = [
  "https://i0.hdslb.com/bfs/archive/abc.jpg@189w_107h.webp",
  "https://i1.hdslb.com/bfs/archive/abc.jpg@100w_100h_1c.png",
  "https://i2.hdslb.com/bfs/archive/abc.jpg@1280w.webp",
  "https://i2.hdslb.com/bfs/archive/abc.jpg@1920w.webp",
  "https://i0.hdslb.com/bfs/archive/abc.jpg@.webp",
  "https://i0.hdslb.com/bfs/archive/abc.jpg",
  "https://cdn.example.com/img.jpg@100w.webp",
  "https://example.com/cover.jpg",
  "http://i2.hdslb.com/bfs/archive/abc.jpg@189w_107h.webp",
  "not-a-url",
  ""
];

test("extension upgradeCdnCoverResolution stays in lock-step with shared/coverImageUrl.ts", () => {
  for (const fixture of parityFixtures) {
    assert.equal(
      upgradeCdnCoverResolution(fixture),
      sharedUpgradeCdnCoverResolution(fixture),
      `extension copy diverged from shared copy for input: ${JSON.stringify(fixture)}`
    );
  }
});

// `collectCoverCandidatesInPage` runs inside the captured tab via
// chrome.scripting.executeScript, so it relies entirely on `document` for
// signal. We exercise it against JSDOM-built fixtures that mirror what the
// extension would see when the popup opens against a real page.
function setupDocument(html: string) {
  const dom = new JSDOM(html, { url: "https://example.com/current-page" });
  const previous = (globalThis as { document?: Document }).document;
  (globalThis as { document: Document }).document = dom.window.document;
  return () => {
    if (previous) {
      (globalThis as { document: Document }).document = previous;
    } else {
      delete (globalThis as { document?: Document }).document;
    }
  };
}

function candidateUrls(candidates: Array<string | { url: string }>): string[] {
  return candidates.map((candidate) => (typeof candidate === "string" ? candidate : candidate.url));
}

test("collectCoverCandidatesInPage prefers og:image when present", () => {
  const restore = setupDocument('<html><head><meta property="og:image" content="https://example.com/og.jpg" /></head></html>');
  try {
    const candidates = collectCoverCandidatesInPage();
    assert.equal(candidateUrls(candidates)[0], "https://example.com/og.jpg");
    const first = candidates[0];
    assert.equal(typeof first === "string" ? undefined : first?.source, "metadata:og_image");
  } finally {
    restore();
  }
});

test("collectCoverCandidatesInPage surfaces VideoObject thumbnailUrl ahead of generic image", () => {
  const restore = setupDocument(`
    <html>
      <head>
        <meta property="og:image" content="https://i0.hdslb.com/bfs/archive/site-default.jpg" />
        <script type="application/ld+json">
          {
            "@type": "VideoObject",
            "name": "demo",
            "thumbnailUrl": "https://i0.hdslb.com/bfs/archive/video-cover.jpg@189w_107h.webp"
          }
        </script>
      </head>
    </html>
  `);
  try {
    const candidates = candidateUrls(collectCoverCandidatesInPage());
    assert.ok(candidates.includes("https://i0.hdslb.com/bfs/archive/video-cover.jpg@189w_107h.webp"));
    // og:image still shows up so callers have a deterministic fallback.
    assert.ok(candidates.includes("https://i0.hdslb.com/bfs/archive/site-default.jpg"));
  } finally {
    restore();
  }
});

test("collectCoverCandidatesInPage returns an empty array when nothing matches", () => {
  const restore = setupDocument("<html><head></head><body><p>just text</p></body></html>");
  try {
    assert.deepEqual(collectCoverCandidatesInPage(), []);
  } finally {
    restore();
  }
});

test("collectCoverCandidatesInPage surfaces article image candidates", () => {
  const restore = setupDocument(`
    <html>
      <body>
        <main>
          <article>
            <picture>
              <source srcset="/small.jpg 320w, /large.jpg 1280w" />
              <img data-src="/lazy.jpg" width="640" height="360" />
            </picture>
            <div style="background-image: url('/background.webp')"></div>
          </article>
        </main>
      </body>
    </html>
  `);
  try {
    const candidates = candidateUrls(collectCoverCandidatesInPage());
    assert.ok(candidates.includes("https://example.com/large.jpg"));
    assert.ok(candidates.includes("https://example.com/lazy.jpg"));
    assert.ok(candidates.includes("https://example.com/background.webp"));
  } finally {
    restore();
  }
});

test("collectCoverCandidatesInPage ranks X tweet media ahead of X default og image", () => {
  const restore = setupDocument(`
    <html>
      <head>
        <meta property="og:image" content="https://abs.twimg.com/rweb/ssr/default/v2/og/image.png" />
      </head>
      <body>
        <main>
          <article>
            <img alt="" src="https://pbs.twimg.com/profile_images/123/avatar_x96.jpg" width="40" height="40" />
            <a href="/idoubicc/status/2062152804014436508/photo/1">
              <div data-testid="tweetPhoto" style="background-image: url('https://pbs.twimg.com/media/HJ4WUQpaMAEcEkw?format=jpg&amp;name=medium')">
                <img alt="Image" src="https://pbs.twimg.com/media/HJ4WUQpaMAEcEkw?format=jpg&amp;name=medium" width="640" height="360" />
              </div>
            </a>
          </article>
        </main>
      </body>
    </html>
  `);
  try {
    const candidates = candidateUrls(collectCoverCandidatesInPage());
    assert.equal(candidates[0], "https://pbs.twimg.com/media/HJ4WUQpaMAEcEkw?format=jpg&name=medium");
  } finally {
    restore();
  }
});

test("collectCoverCandidatesInPage ignores X default og image so the popup can keep waiting for real media", () => {
  const restore = setupDocument(`
    <html>
      <head>
        <meta property="og:image" content="https://abs.twimg.com/rweb/ssr/default/v2/og/image.png" />
      </head>
      <body>
        <main>
          <article>
            <p>The post text rendered before the media.</p>
          </article>
        </main>
      </body>
    </html>
  `);
  try {
    assert.deepEqual(collectCoverCandidatesInPage(), []);
  } finally {
    restore();
  }
});

test("collectCoverCandidatesInPage scans body fallback when the first main root has no media yet", () => {
  const restore = setupDocument(`
    <html>
      <head>
        <meta property="og:image" content="https://abs.twimg.com/rweb/ssr/default/v2/og/image.png" />
      </head>
      <body>
        <main>
          <article>
            <p>The title and text rendered before the media card.</p>
          </article>
        </main>
        <div data-testid="tweetPhoto" style="background-image: url('https://pbs.twimg.com/media/G9vQWfBaMAA-demo?format=jpg&amp;name=large')"></div>
      </body>
    </html>
  `);
  try {
    const candidates = collectCoverCandidatesInPage();
    assert.equal(candidateUrls(candidates)[0], "https://pbs.twimg.com/media/G9vQWfBaMAA-demo?format=jpg&name=large");
    assert.equal(candidates[0]?.source, "page_background");
  } finally {
    restore();
  }
});

test("collectCoverCandidatesInPage survives malformed JSON-LD", () => {
  const restore = setupDocument(`
    <html>
      <head>
        <meta property="og:image" content="https://example.com/og.jpg" />
        <script type="application/ld+json">{this is not valid json</script>
      </head>
    </html>
  `);
  try {
    const candidates = candidateUrls(collectCoverCandidatesInPage());
    assert.equal(candidates[0], "https://example.com/og.jpg");
  } finally {
    restore();
  }
});
