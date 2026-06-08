import assert from "node:assert/strict";
import { buildContentSignals } from "../contentSignals";
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
            "author": [{ "name": "Hunter Team" }],
            "datePublished": "2026-06-01T00:00:00Z",
            "publisher": { "name": "Hunter Lab" }
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

const signals = buildContentSignals(extracted);

assert.equal(extracted.title, "Designing a Durable Reading Inbox");
assert.equal(extracted.extractor, "defuddle");
assert.equal(extracted.extractionState, "ready");
assert.equal(extracted.coverImage, "https://example.com/structured-cover.jpg");
assert.equal(extracted.author, "Hunter Team");
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
assert.match(privateSnapshot.contentHtml ?? "", /Private workspace paragraph 1/);
assert.doesNotMatch(privateSnapshot.contentHtml ?? "", /<script/i);

const alternateRootText = Array.from(
  { length: 5 },
  (_, index) =>
    `Alternate candidate paragraph ${index + 1} preserves the actual article body when a single focused-root snapshot captured a stale navigation panel instead.`
).join(" ");
const alternateRootSnapshot = await extractContent({
  url: "https://example.com/alternate-root",
  snapshot: {
    url: "https://example.com/alternate-root",
    title: "Alternate Root",
    textContent:
      "Home Pricing Login Subscribe Account Settings Navigation Panel Project shortcuts and notification filters repeated enough to look substantial.",
    html: `<!doctype html>
      <html>
        <head><title>Wrong focused root</title></head>
        <body><aside><p>Home Pricing Login Subscribe Account Settings Navigation Panel Project shortcuts and notification filters repeated enough to look substantial.</p></aside></body>
      </html>`,
    contentCandidates: [
      {
        kind: "focused_root",
        selector: "aside",
        score: 260,
        text: "Home Pricing Login Subscribe Account Settings Navigation Panel Project shortcuts and notification filters repeated enough to look substantial."
      },
      {
        kind: "content_root",
        selector: "article#real-story",
        score: 1400,
        text: alternateRootText,
        html: `<!doctype html>
          <html>
            <head><title>Alternate Root</title></head>
            <body>
              <article id="real-story">
                <h1>Alternate Root</h1>
                <p>${alternateRootText}</p>
              </article>
            </body>
          </html>`
      }
    ]
  }
});

assert.equal(alternateRootSnapshot.extractionState, "ready");
assert.match(alternateRootSnapshot.readableText, /Alternate candidate paragraph/);
assert.doesNotMatch(alternateRootSnapshot.readableText, /Navigation Panel/);
assert.match(alternateRootSnapshot.contentHtml ?? "", /real-story|Alternate candidate paragraph/);

const bilibiliShapedUrl = "https://www.bilibili.com/video/BV1hunter";
const bilibiliShaped = await extractContent({
  url: bilibiliShapedUrl,
  snapshot: {
    url: bilibiliShapedUrl,
    title: "源优先的内容识别 - 哔哩哔哩",
    siteName: "哔哩哔哩",
    html: `<!doctype html>
      <html lang="zh-CN">
        <head>
          <meta property="og:type" content="video.other" />
          <meta property="og:title" content="源优先的内容识别" />
          <meta property="og:image" content="https://i0.hdslb.com/bfs/archive/site-default-cover.jpg" />
          <meta property="og:site_name" content="哔哩哔哩" />
          <meta name="author" content="哔哩哔哩" />
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@graph": [
                { "@type": "WebSite", "name": "Site shell", "publisher": { "name": "Bilibili Inc." } },
                {
                  "@type": "VideoObject",
                  "name": "源优先的内容识别",
                  "description": "%E6%9D%A5%E8%87%AA%20Hunter%20Lab%20%E7%9A%84%E6%BA%90%E4%BC%98%E5%85%88%E5%86%85%E5%AE%B9%E8%AF%86%E5%88%AB%E8%AE%B2%E8%A7%A3%E3%80%82",
                  "thumbnailUrl": "https://i0.hdslb.com/bfs/archive/demo-cover.jpg",
                  "uploadDate": "2026-06-01T00:00:00Z",
                  "author": { "@type": "Person", "name": "Hunter Lab" }
                }
              ]
            }
          </script>
        </head>
        <body>
          <main>
            <h1>源优先的内容识别</h1>
            <p>这页的主体是视频，正文区只有作者发布的简介。</p>
          </main>
        </body>
      </html>`
  }
});

assert.equal(bilibiliShaped.sourceType, "video");
// VideoObject thumbnail must beat the generic og:image, because the structured node
// declares the page's primary resource and the og image was a site-default fallback.
assert.equal(bilibiliShaped.coverImage, "https://i0.hdslb.com/bfs/archive/demo-cover.jpg");
// VideoObject.author and uploadDate must surface as the uploader/published date, not
// the page-wide <meta name="author"> or any Article-shaped author/date.
assert.equal(bilibiliShaped.author, "Hunter Lab");
assert.equal(bilibiliShaped.publishedAt, "2026-06-01T00:00:00Z");
// B站 ships VideoObject.description as a percent-encoded string. The pipeline
// must decode it AND prefer it over snapshot body text in the excerpt, so the
// item card actually shows the uploader's description rather than a slice of
// recommendation rail HTML.
assert.equal(bilibiliShaped.excerpt, "来自 Hunter Lab 的源优先内容识别讲解。");

// Frontend wiring contract: ItemCard reads `summary` (NOT `excerpt`), so the
// uploader's description must flow into the summary signal too — otherwise
// buildContentSignals would distill it from the body HTML segments (page
// recommendations, comments, sidebar), defeating the whole structured
// extraction. This regression specifically guards the contentSignals →
// itemBuilder.summary → ItemCard render path for video/audio sources.
const bilibiliSignals = buildContentSignals(bilibiliShaped);
assert.equal(
  bilibiliSignals.summary,
  "来自 Hunter Lab 的源优先内容识别讲解。",
  "video summary must come from the uploader's description, not page chrome"
);

const articleWithEmbeddedVideoUrl = "https://example.com/blog/why-i-switched-cameras";
const articleWithEmbeddedVideo = await extractContent({
  url: articleWithEmbeddedVideoUrl,
  snapshot: {
    url: articleWithEmbeddedVideoUrl,
    title: "Why I Switched Cameras",
    siteName: "Example Blog",
    html: `<!doctype html>
      <html>
        <head>
          <meta property="og:type" content="article" />
          <script type="application/ld+json">
            { "@context": "https://schema.org", "@type": "BlogPosting", "headline": "Why I Switched Cameras" }
          </script>
        </head>
        <body>
          <article>
            <h1>Why I Switched Cameras</h1>
            <p>${"This long-form review explains the trade-offs across sensor size, lens system, and durable workflow integration. ".repeat(6)}</p>
            <video src="hands-on.mp4"></video>
          </article>
        </body>
      </html>`
  }
});

// An article that merely embeds <video> should NOT be promoted to video.
assert.equal(articleWithEmbeddedVideo.sourceType, "article");

console.log("recognition fixtures passed");
