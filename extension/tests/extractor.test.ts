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

const snapshot = (dom.window as unknown as { __huntterExtractPageSnapshot: () => ExtensionSnapshot }).__huntterExtractPageSnapshot();

assert.equal(snapshot.url, "https://example.com/articles/focused-capture?utm_source=noise");
assert.equal(snapshot.title, "Noisy page");
assert.equal(snapshot.canonicalUrl, "https://example.com/articles/focused-capture?utm_source=noise");
assert.match(snapshot.html, /<article>/);
assert.match(snapshot.html, /Browser snapshot capture should prefer/);
assert.doesNotMatch(snapshot.html, /Navigation item 399/);
assert.match(snapshot.textContent, /focused content root/);
assert.doesNotMatch(snapshot.textContent, /Navigation item 399/);
assert.equal(
  JSON.stringify(snapshot.imageCandidates.slice(0, 2)),
  JSON.stringify(["https://example.com/og-cover.jpg", "https://example.com/article-cover.jpg"])
);

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
const hugeSnapshot = (
  hugeDom.window as unknown as { __huntterExtractPageSnapshot: () => ExtensionSnapshot }
).__huntterExtractPageSnapshot();

assert.ok(hugeSnapshot.title && hugeSnapshot.title.length <= 500);
assert.ok(hugeSnapshot.html.length <= 180000);
assert.ok(hugeSnapshot.textContent && hugeSnapshot.textContent.length <= 120000);
assert.equal(hugeSnapshot.imageCandidates.length, 16);

console.log("extension extractor fixtures passed");

type ExtensionSnapshot = {
  url: string;
  canonicalUrl?: string;
  title?: string;
  html: string;
  textContent?: string;
  imageCandidates: string[];
};
