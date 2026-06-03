import assert from "node:assert/strict";
import { enrichContent } from "../enrich";
import { extractContent } from "../extract";
import { buildItem } from "../itemBuilder";

const url = "https://example.com/deep-content";
const html = `<!doctype html>
<html>
  <head>
    <title>Noise should not win</title>
    <meta property="og:description" content="A practical article about saving, recognizing, and reviewing useful web content." />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebSite",
            "name": "Wrong Publisher Shell",
            "publisher": { "name": "Shell Publisher" }
          },
          {
            "@type": "NewsArticle",
            "headline": "Designing a Durable Reading Inbox",
            "description": "Structured data description for the real article.",
            "image": { "url": "/structured-cover.jpg" },
            "author": [{ "name": "Huntter Team" }],
            "datePublished": "2026-06-01T00:00:00Z",
            "publisher": { "name": "Huntter Lab" }
          }
        ]
      }
    </script>
  </head>
  <body>
    <nav>Home Pricing Login Subscribe</nav>
    <main>
      <article>
        <h1>Designing a Durable Reading Inbox</h1>
        <p>A commercial reading inbox has to capture the user's intent before it thinks about organization. URL metadata is useful, but it is not enough for private documents, dynamic pages, or noisy blogs.</p>
        <p onclick="alert(1)">The recognition system should keep provenance, choose a cover image, measure confidence, and preserve enough canonical content for future search and reprocessing.</p>
        <img src="/article-image.jpg" onerror="alert(1)" />
        <script>alert("bad")</script>
      </article>
    </main>
    <aside>Related posts and ads</aside>
  </body>
</html>`;

const extracted = await extractContent({
  url,
  snapshot: {
    url,
    html,
    textContent:
      "Home Pricing Login Subscribe Designing a Durable Reading Inbox A commercial reading inbox has to capture the user's intent before it thinks about organization. URL metadata is useful, but it is not enough for private documents, dynamic pages, or noisy blogs. The recognition system should keep provenance, choose a cover image, measure confidence, and preserve enough canonical content for future search and reprocessing. Related posts and ads",
    imageCandidates: ["https://example.com/sprite.svg"]
  }
});

const signals = await enrichContent(extracted);

assert.equal(extracted.title, "Designing a Durable Reading Inbox");
assert.equal(extracted.extractor, "defuddle");
assert.equal(extracted.extractionState, "ready");
assert.equal(extracted.coverImage, "https://example.com/structured-cover.jpg");
assert.equal(extracted.author, "Huntter Team");
assert.equal(extracted.publishedAt, "2026-06-01T00:00:00Z");
assert.equal(extracted.readableText.includes("Pricing Login"), false);
assert.equal(extracted.readableText.includes("Related posts"), false);
assert.ok(extracted.contentHtml);
assert.doesNotMatch(extracted.contentHtml, /<script|onclick|onerror/i);
assert.match(signals.summary, /commercial reading inbox/);
assert.ok(signals.tags.includes("article"));
assert.ok(signals.readingMinutes >= 1);

const item = await buildItem({ url, snapshot: { url, html } }, "item-recognition", "2026-06-02T00:00:00.000Z");
assert.equal(item.recognitionVersion, 1);
assert.match(item.recognizedAt ?? "", /^20/);
assert.equal(typeof item.recognitionDurationMs, "number");
assert.ok(item.recognitionTiming);
assert.equal(item.recognitionTiming.totalMs, item.recognitionDurationMs);
assert.equal(typeof item.recognitionTiming.sourceAdapterMs, "number");
assert.equal(typeof item.recognitionTiming.contentSignalsMs, "number");
assert.equal(typeof item.recognitionTiming.itemBuildMs, "number");
assert.match(item.contentHash ?? "", /^[a-f0-9]{64}$/);

const metadataOnly = await extractContent({
  url: "https://example.com/metadata-graph",
  snapshot: {
    url: "https://example.com/metadata-graph",
    html: `<!doctype html>
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              "name": "Shell Site"
            }
          </script>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "BlogPosting",
              "headline": "JSON-LD Headline Wins",
              "description": "JSON-LD description should feed shallow metadata.",
              "dateModified": "2026-06-02T12:00:00Z"
            }
          </script>
        </head>
        <body></body>
      </html>`
  }
});

assert.equal(metadataOnly.title, "JSON-LD Headline Wins");
assert.equal(metadataOnly.publishedAt, "2026-06-02T12:00:00Z");
assert.equal(metadataOnly.extractionState, "partial");

const selectedText =
  "Selected capture should keep exactly the user's intended passage as canonical content, even when a parser could see a different article shell.";
const selectedCapture = await extractContent({
  url: "https://example.com/selected-capture",
  snapshot: {
    url: "https://example.com/selected-capture",
    title: "Selected Capture",
    selectedText,
    html: `<!doctype html>
      <html>
        <body>
          <article>
            <h1>Parser Shell</h1>
            <p>This parser-visible article shell should not replace the user's selected passage.</p>
          </article>
        </body>
      </html>`
  }
});

assert.equal(selectedCapture.extractor, "browser_selection");
assert.equal(selectedCapture.extractionState, "ready");
assert.match(selectedCapture.contentHtml ?? "", /Selected capture should keep exactly/);
assert.doesNotMatch(selectedCapture.contentHtml ?? "", /Parser Shell/);

const privateSnapshotText = Array.from(
  { length: 12 },
  (_, index) =>
    `Private workspace paragraph ${index + 1} captures visible permissioned content from the browser extension when public URL fetches cannot see the document body.`
).join(" ");
const privateSnapshot = await extractContent({
  url: "https://example.com/private-workspace-doc",
  snapshot: {
    url: "https://example.com/private-workspace-doc",
    title: "Private Workspace Doc",
    textContent: privateSnapshotText,
    html: `<!doctype html>
      <html>
        <head><title>Private app shell</title></head>
        <body><div id="app"></div><script>alert("empty shell")</script></body>
      </html>`
  }
});

assert.equal(privateSnapshot.extractor, "browser_snapshot");
assert.equal(privateSnapshot.extractionState, "ready");
assert.equal(privateSnapshot.sourceAccess, "browser_snapshot");
assert.match(privateSnapshot.contentHtml ?? "", /Private workspace paragraph 1/);
assert.doesNotMatch(privateSnapshot.contentHtml ?? "", /<script/i);

console.log("recognition fixtures passed");
