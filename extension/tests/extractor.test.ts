import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const extractorScript = await readFile("extension/src/extractor.js", "utf8");
const noisyNavigation = Array.from({ length: 400 }, (_, index) => `Navigation item ${index}`).join(" ");
const dom = new JSDOM(
  `<!doctype html>
  <html>
    <head>
      <title>Noisy page</title>
      <link rel="canonical" href="/articles/focused-capture?utm_source=noise" />
      <meta property="og:title" content="Focused Capture" />
      <meta property="og:description" content="A page with a huge shell and a useful article." />
      <meta property="og:image" content="/og-cover.jpg" />
      <link rel="icon" sizes="16x16" href="/favicon-16.png" />
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    </head>
    <body>
      <nav>${noisyNavigation}</nav>
      <article>
        <h1>Focused Capture</h1>
        <p>Browser snapshot capture should prefer the article body over noisy surrounding navigation.</p>
        <p>Keeping the focused content root gives the server parser better material for private and dynamic pages.</p>
        <img src="/article-cover.jpg" width="320" />
      </article>
      <aside>Related links and advertisements should not define the snapshot root.</aside>
    </body>
  </html>`,
  {
    url: "https://example.com/articles/focused-capture?utm_source=noise",
    runScripts: "outside-only",
    pretendToBeVisual: true
  }
);

dom.window.eval(extractorScript);

const snapshot = (dom.window as unknown as { __hunterExtractPageSnapshot: () => ExtensionSnapshot }).__hunterExtractPageSnapshot();

assert.equal(snapshot.url, "https://example.com/articles/focused-capture?utm_source=noise");
assert.equal(snapshot.title, "Noisy page");
assert.equal(snapshot.canonicalUrl, "https://example.com/articles/focused-capture?utm_source=noise");
assert.match(snapshot.html, /<article>/);
assert.match(snapshot.html, /Browser snapshot capture should prefer/);
assert.doesNotMatch(snapshot.html, /Navigation item 399/);
assert.match(snapshot.textContent, /focused content root/);
assert.doesNotMatch(snapshot.textContent, /Navigation item 399/);
assert.equal(snapshot.favicon, "https://example.com/apple-touch-icon.png");
assert.equal(
  JSON.stringify(candidateUrls(snapshot).slice(0, 2)),
  JSON.stringify(["https://example.com/og-cover.jpg", "https://example.com/article-cover.jpg"])
);
assert.equal(typeof snapshot.imageCandidates[0], "object");
assert.equal(typeof snapshot.imageCandidates[1], "object");
const secondImageCandidate = snapshot.imageCandidates[1];
assert.notEqual(typeof secondImageCandidate, "string");
assert.equal(typeof secondImageCandidate === "string" ? undefined : secondImageCandidate?.source, "content_image");
assert.equal(typeof secondImageCandidate === "string" ? undefined : secondImageCandidate?.inContentRoot, true);
assert.equal(snapshot.contentCandidates?.[0]?.kind, "focused_root");
assert.match(snapshot.contentCandidates?.[0]?.text ?? "", /focused content root/);
assert.ok(
  snapshot.contentCandidates?.some((candidate) => candidate.kind === "body"),
  "body text fallback candidate is preserved"
);

const xMediaDom = new JSDOM(
  `<!doctype html>
  <html>
    <head>
      <title>X media post</title>
      <meta property="og:image" content="https://abs.twimg.com/rweb/ssr/default/v2/og/image.png" />
    </head>
    <body>
      <main role="main">
        <article data-testid="tweet">
          <div data-testid="tweetText">
            Browser snapshot capture for an opened X post should keep the attached media even when X exposes a platform default Open Graph image.
          </div>
          <img alt="" src="https://pbs.twimg.com/profile_images/123/avatar_x96.jpg" width="40" height="40" />
          <img alt="👇" src="https://abs.twimg.com/emoji/v2/svg/1f447.svg" width="18" height="18" />
          <a href="/hunter/status/3333333333/photo/1">
            <div data-testid="tweetPhoto" style="background-image: url('https://pbs.twimg.com/media/HJ4WUQpaMAEcEkw?format=jpg&amp;name=medium')">
              <img alt="Image" src="https://pbs.twimg.com/media/HJ4WUQpaMAEcEkw?format=jpg&amp;name=medium" width="640" height="360" />
            </div>
          </a>
        </article>
      </main>
    </body>
  </html>`,
  { url: "https://x.com/idoubicc/status/2062152804014436508", runScripts: "outside-only", pretendToBeVisual: true }
);

xMediaDom.window.eval(extractorScript);
const xMediaSnapshot = (
  xMediaDom.window as unknown as { __hunterExtractPageSnapshot: () => ExtensionSnapshot }
).__hunterExtractPageSnapshot();

assert.equal(candidateUrls(xMediaSnapshot)[0], "https://pbs.twimg.com/media/HJ4WUQpaMAEcEkw?format=jpg&name=medium");
assert.ok(candidateUrls(xMediaSnapshot).includes("https://abs.twimg.com/rweb/ssr/default/v2/og/image.png"));

const responsiveImageDom = new JSDOM(
  `<!doctype html>
  <html>
    <head><title>Responsive article</title></head>
    <body>
      <article>
        <h1>Responsive article</h1>
        <p>Article image capture should understand responsive and lazy-loaded image attributes used by modern article pages.</p>
        <picture>
          <source srcset="/hero-480.jpg 480w, /hero-1280.jpg 1280w" />
          <img data-src="/lazy-hero.jpg" width="640" height="360" />
        </picture>
        <div style="background-image: url('/background-hero.webp')"></div>
      </article>
    </body>
  </html>`,
  { url: "https://example.com/responsive-article", runScripts: "outside-only", pretendToBeVisual: true }
);

responsiveImageDom.window.eval(extractorScript);
const responsiveSnapshot = (
  responsiveImageDom.window as unknown as { __hunterExtractPageSnapshot: () => ExtensionSnapshot }
).__hunterExtractPageSnapshot();

assert.ok(candidateUrls(responsiveSnapshot).includes("https://example.com/hero-1280.jpg"));
assert.ok(candidateUrls(responsiveSnapshot).includes("https://example.com/lazy-hero.jpg"));
assert.ok(candidateUrls(responsiveSnapshot).includes("https://example.com/background-hero.webp"));

const hugeImages = Array.from({ length: 40 }, (_, index) => `<img src="/image-${index}.jpg" width="320" />`).join("");
const hugeDom = new JSDOM(
  `<!doctype html>
  <html>
    <head><title>${"Large title ".repeat(100)}</title></head>
    <body>
      <article>
        <p>${"Long private article paragraph. ".repeat(12000)}</p>
        ${hugeImages}
      </article>
    </body>
  </html>`,
  {
    url: "https://example.com/private-large-doc",
    runScripts: "outside-only",
    pretendToBeVisual: true
  }
);

hugeDom.window.eval(extractorScript);
const hugeSnapshot = (hugeDom.window as unknown as { __hunterExtractPageSnapshot: () => ExtensionSnapshot }).__hunterExtractPageSnapshot();

assert.ok(hugeSnapshot.title && hugeSnapshot.title.length <= 500);
assert.ok(hugeSnapshot.html.length <= 180000);
assert.ok(hugeSnapshot.textContent && hugeSnapshot.textContent.length <= 120000);
assert.equal(hugeSnapshot.imageCandidates.length, 16);
assert.ok((hugeSnapshot.contentCandidates?.length ?? 0) <= 4);
assert.ok((hugeSnapshot.contentCandidates?.[0]?.text?.length ?? 0) <= 60000);

// JSON-LD can legitimately live in <body> (e.g. B站 / Bilibili injects
// VideoObject ld+json near the bottom of the body, well past the 180KB
// snapshot cap). The extractor must lift it into the serialized <head> so the
// recognition pipeline can read VideoObject metadata after truncation.
const bodyJsonLdDom = new JSDOM(
  `<!doctype html>
  <html>
    <head>
      <meta property="og:type" content="video" />
      <title>B站 style page</title>
    </head>
    <body>
      <main>
        <h1>Video page</h1>
        <p>${"Filler body text. ".repeat(8000)}</p>
      </main>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"VideoObject","name":"Demo","thumbnailUrl":["http://i0.hdslb.com/cover.jpg"],"uploadDate":"2026-06-03T00:00:00Z"}
      </script>
    </body>
  </html>`,
  { url: "https://www.bilibili.com/video/BV1demo/", runScripts: "outside-only", pretendToBeVisual: true }
);
bodyJsonLdDom.window.eval(extractorScript);
const bodyJsonLdSnapshot = (
  bodyJsonLdDom.window as unknown as { __hunterExtractPageSnapshot: () => ExtensionSnapshot }
).__hunterExtractPageSnapshot();

assert.ok(bodyJsonLdSnapshot.html.length <= 180000, "snapshot cap still respected");
assert.match(bodyJsonLdSnapshot.html, /application\/ld\+json/, "body JSON-LD must survive into the snapshot");
assert.match(bodyJsonLdSnapshot.html, /VideoObject/, "VideoObject node must survive into the snapshot");
assert.match(bodyJsonLdSnapshot.html, /thumbnailUrl/, "thumbnail URL must survive into the snapshot");
// Lifted JSON-LD must end up in <head> so it is reliably positioned BEFORE the
// large body that risks being truncated by the snapshot cap.
const headSlice = bodyJsonLdSnapshot.html.slice(0, bodyJsonLdSnapshot.html.indexOf("</head>"));
assert.match(headSlice, /application\/ld\+json/, "JSON-LD must be lifted into the serialized <head>");

console.log("extension extractor fixtures passed");

function candidateUrls(snapshot: ExtensionSnapshot): string[] {
  return snapshot.imageCandidates.map((candidate) => (typeof candidate === "string" ? candidate : candidate.url));
}

type ExtensionImageCandidate =
  | string
  | {
      url: string;
      score?: number;
      source?: string;
      width?: number;
      height?: number;
      alt?: string;
      context?: string;
      inContentRoot?: boolean;
      order?: number;
    };

type ExtensionSnapshot = {
  url: string;
  canonicalUrl?: string;
  title?: string;
  favicon?: string;
  html: string;
  textContent?: string;
  imageCandidates: ExtensionImageCandidate[];
  contentCandidates?: Array<{
    kind: string;
    text?: string;
    html?: string;
    selector?: string;
    score?: number;
  }>;
};
