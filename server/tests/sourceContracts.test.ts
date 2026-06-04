import assert from "node:assert/strict";
import { extractContent } from "../extract";

const feishuUrl = "https://bytedance.larkoffice.com/wiki/SjaPwstMjiA2f4khXz1cX6vFnLg";

const feishuShortSnapshot = await extractContent({
  url: feishuUrl,
  snapshot: {
    url: feishuUrl,
    title: "Harness Engineering Notes",
    siteName: "Feishu",
    textContent: "Harness Engineering Notes explain why source adapters need honest states and visible evidence for private documents."
  }
});

assert.equal(feishuShortSnapshot.sourceType, "feishu");
assert.equal(feishuShortSnapshot.extractionState, "partial");
assert.equal(feishuShortSnapshot.extractor, "browser_snapshot");

const feishuLongSnapshot = await extractContent({
  url: feishuUrl,
  snapshot: {
    url: feishuUrl,
    title: "Feishu Private Product Review",
    siteName: "Feishu",
    html: `<!doctype html>
      <html>
        <body>
          <main>
            <h1>Feishu Private Product Review</h1>
            <p>Permissioned Feishu content captured through the browser extension should become usable canonical content when enough visible text is present.</p>
            <p onclick="alert(1)">The source adapter still records browser snapshot provenance, but it should not pretend that a native block import happened.</p>
            <script>alert("unsafe")</script>
          </main>
        </body>
      </html>`,
    textContent:
      "Feishu Private Product Review Permissioned Feishu content captured through the browser extension should become usable canonical content when enough visible text is present. The source adapter still records browser snapshot provenance, but it should not pretend that a native block import happened. This keeps private documents searchable and readable while leaving exact blocks, attachments, and permission sync to follow.",
    imageCandidates: ["https://example.com/feishu-cover.png"]
  }
});

assert.equal(feishuLongSnapshot.extractionState, "ready");
assert.equal(feishuLongSnapshot.extractor, "browser_snapshot");
assert.match(feishuLongSnapshot.contentHtml ?? "", /Feishu Private Product Review/);
assert.doesNotMatch(feishuLongSnapshot.contentHtml ?? "", /<script|onclick/i);
assert.equal(feishuLongSnapshot.coverImage, "https://example.com/feishu-cover.png");

// Regression: a snapshot favicon shipped as inline base64 must not crash recognition.
// Sanitize layer should drop it and fall back to the deterministic per-host favicon.
const feishuDataFavicon = await extractContent({
  url: feishuUrl,
  snapshot: {
    url: feishuUrl,
    title: "Feishu doc with inline favicon",
    siteName: "Feishu",
    favicon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
  }
});

assert.equal(feishuDataFavicon.favicon, "https://www.google.com/s2/favicons?domain=bytedance.larkoffice.com&sz=64");

const xUrl = "https://x.com/hunter/status/1234567890";
const xSelectedText = await extractContent({
  url: xUrl,
  snapshot: {
    url: xUrl,
    selectedText: "A useful source-first capture reminder for private content."
  }
});

assert.equal(xSelectedText.sourceType, "tweet");
assert.equal(xSelectedText.extractionState, "partial");
assert.equal(xSelectedText.extractor, "browser_selection");
assert.match(xSelectedText.contentHtml ?? "", /source-first capture reminder/);

const xSnapshot = await extractContent({
  url: "https://x.com/hunter/status/3333333333",
  snapshot: {
    url: "https://x.com/hunter/status/3333333333",
    title: "Hunter Lab on X",
    html: `<!doctype html>
      <html>
        <head>
          <meta property="og:image" content="https://abs.twimg.com/rweb/ssr/default/v2/og/image.png" />
        </head>
        <body>
          <article>
            <div data-testid="User-Name">Hunter Lab @hunter</div>
            <div data-testid="tweetText">Browser snapshot capture for an opened X post should keep the visible post text and sanitize the captured HTML so saved evidence stays trustworthy across reviews.</div>
            <time datetime="2026-06-02T08:30:00.000Z">Jun 2</time>
            <img alt="" src="https://pbs.twimg.com/profile_images/123/avatar_x96.jpg" />
            <img alt="👇" src="https://abs.twimg.com/emoji/v2/svg/1f447.svg" />
            <a href="/hunter/status/3333333333/photo/1">
              <div data-testid="tweetPhoto" style="background-image: url('https://pbs.twimg.com/media/demo.jpg?format=jpg&amp;name=medium')">
                <img alt="Image" src="https://pbs.twimg.com/media/demo.jpg?format=jpg&amp;name=medium" />
              </div>
            </a>
            <button onclick="alert(1)">Reply</button>
            <script>alert("unsafe")</script>
          </article>
        </body>
      </html>`,
    textContent:
      "Home For you Following Browser snapshot capture for an opened X post should keep the visible post text and sanitize the captured HTML so saved evidence stays trustworthy across reviews. Reply Repost Like",
    imageCandidates: [
      "https://abs.twimg.com/rweb/ssr/default/v2/og/image.png",
      "https://pbs.twimg.com/media/demo.jpg?format=jpg&name=medium"
    ]
  }
});

assert.equal(xSnapshot.extractionState, "ready");
assert.equal(xSnapshot.extractor, "browser_snapshot");
assert.match(xSnapshot.readableText, /visible post text/);
assert.match(xSnapshot.contentHtml ?? "", /visible post text/);
assert.doesNotMatch(xSnapshot.contentHtml ?? "", /<script|onclick/i);
assert.equal(xSnapshot.coverImage, "https://pbs.twimg.com/media/demo.jpg?format=jpg&name=medium");
assert.equal(xSnapshot.publishedAt, "2026-06-02T08:30:00.000Z");

const shallowUrl = "https://example.com/metadata-only";
const shallowMetadata = await extractContent({
  url: shallowUrl,
  snapshot: {
    url: shallowUrl,
    html: `<!doctype html>
      <html>
        <head>
          <title>Metadata only page</title>
          <meta name="description" content="A short metadata-only description that should not be treated as full content." />
        </head>
        <body></body>
      </html>`
  }
});

assert.equal(shallowMetadata.extractor, "metadata");
assert.equal(shallowMetadata.extractionState, "partial");
assert.equal(shallowMetadata.sourceType, "article");

const pdfUrl = "https://example.com/research-field-guide.pdf";
const pdfText = Array.from(
  { length: 8 },
  (_, index) => `Hunter PDF recognition line ${index + 1} captures durable source text for saved research papers.`
).join(" ");
const pdfSnapshot = await extractContent({
  url: pdfUrl,
  snapshot: {
    url: pdfUrl,
    title: "Research Field Guide",
    textContent: pdfText
  }
});

assert.equal(pdfSnapshot.sourceType, "pdf");
assert.equal(pdfSnapshot.extractionState, "ready");
assert.match(pdfSnapshot.title, /research field guide/i);
assert.match(pdfSnapshot.readableText, /durable source text/);

// YouTube ships a real og:description but leaves VideoObject.description empty
// (the description is rendered client-side). The generic-web pipeline must
// pick the og:description and surface it in the excerpt, and must also pull
// the high-resolution thumbnail from og:image.
const youtubeSnapshotText = Array.from(
  { length: 4 },
  (_, index) => `Snapshot transcript ${index + 1} captures the visible YouTube watch page text exposed through the browser extension.`
).join(" ");
const youtubeSnapshot = await extractContent({
  url: "https://www.youtube.com/watch?v=demo",
  snapshot: {
    url: "https://www.youtube.com/watch?v=demo",
    title: "Designing a Durable Reading Inbox",
    siteName: "YouTube",
    textContent: youtubeSnapshotText,
    html: `<!doctype html>
      <html>
        <head>
          <meta property="og:title" content="Designing a Durable Reading Inbox" />
          <meta property="og:description" content="A 22-minute walkthrough of building an honest, source-aware reading inbox without lying about what was captured." />
          <meta property="og:image" content="https://i.ytimg.com/vi/demo/maxresdefault.jpg" />
          <meta property="og:site_name" content="YouTube" />
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"VideoObject","name":"Designing a Durable Reading Inbox","description":"","thumbnailUrl":["https://i.ytimg.com/vi/demo/maxresdefault.jpg"],"uploadDate":"2026-05-12T00:00:00Z"}
          </script>
        </head>
        <body><main><h1>Designing a Durable Reading Inbox</h1></main></body>
      </html>`
  }
});

assert.equal(youtubeSnapshot.sourceType, "video");
assert.equal(youtubeSnapshot.title, "Designing a Durable Reading Inbox");
assert.equal(youtubeSnapshot.sourceName, "YouTube");
assert.match(
  youtubeSnapshot.excerpt,
  /22-minute walkthrough/,
  "YouTube excerpt must fall back to og:description when VideoObject.description is empty"
);
assert.equal(
  youtubeSnapshot.coverImage,
  "https://i.ytimg.com/vi/demo/maxresdefault.jpg",
  "YouTube cover must come from og:image / VideoObject.thumbnailUrl"
);
assert.equal(youtubeSnapshot.publishedAt, "2026-05-12T00:00:00Z");

// Vimeo's server-side HTML is famously thin (~13KB shell, no og:description,
// no JSON-LD). The pipeline must still emit a video-typed item that survives
// the extracted-content contract, even when only the title and site name are
// usable — extractionState honestly reflects the lack of body content.
const vimeoSnapshot = await extractContent({
  url: "https://vimeo.com/123456789",
  snapshot: {
    url: "https://vimeo.com/123456789",
    title: "Focused Capture Demo",
    siteName: "Vimeo"
  }
});

assert.equal(vimeoSnapshot.sourceType, "video");
assert.equal(vimeoSnapshot.title, "Focused Capture Demo");
assert.equal(vimeoSnapshot.sourceName, "Vimeo");
assert.notEqual(vimeoSnapshot.extractionState, "ready", "thin Vimeo snapshot must not claim ready state");

console.log("source contract fixtures passed");
