import assert from "node:assert/strict";
import { isUsefulCoverImageUrl, selectCoverImage, selectCoverImageFromCandidates } from "../sources/coverImage";

assert.equal(isUsefulCoverImageUrl("https://pbs.twimg.com/media/demo.jpg"), true);
assert.equal(isUsefulCoverImageUrl("https://example.com/profile_images/avatar.jpg"), false);
assert.equal(isUsefulCoverImageUrl("https://example.com/sprite.svg"), false);
assert.equal(isUsefulCoverImageUrl("https://example.com/favicon.ico"), false);
assert.equal(isUsefulCoverImageUrl("data:image/png;base64,abc"), false);
assert.equal(isUsefulCoverImageUrl(undefined), false);
assert.equal(isUsefulCoverImageUrl("https://abs.twimg.com/rweb/ssr/default/v2/og/image.png"), false);

assert.equal(
  selectCoverImageFromCandidates([
    "https://example.com/logo.png",
    "https://example.com/avatar-photo.jpg",
    "https://cdn.example.com/media/post-photo.jpg",
    "https://example.com/article-cover.jpg"
  ]),
  "https://cdn.example.com/media/post-photo.jpg"
);

assert.equal(selectCoverImageFromCandidates([]), undefined);
assert.equal(selectCoverImageFromCandidates(undefined), undefined);
assert.equal(selectCoverImageFromCandidates(["https://example.com/sprite.svg", "data:image/png;base64,xyz"]), undefined);

const preferredWins = await selectCoverImage({
  url: "https://example.com/post",
  preferred: "https://cdn.example.com/preferred-cover.jpg",
  html: '<html><head><meta property="og:image" content="https://example.com/og.jpg" /></head></html>',
  snapshotCandidates: ["https://example.com/fallback.jpg"]
});
assert.equal(preferredWins, "https://cdn.example.com/preferred-cover.jpg");

const weakPreferredFallsThrough = await selectCoverImage({
  url: "https://example.com/post",
  preferred: "https://example.com/logo.png",
  html: '<html><head><meta property="og:image" content="https://example.com/og-cover.jpg" /></head></html>'
});
assert.equal(weakPreferredFallsThrough, "https://example.com/og-cover.jpg");

const ogFromHtml = await selectCoverImage({
  url: "https://example.com/post",
  html: `<html>
    <head>
      <meta property="og:image" content="https://example.com/og-cover.jpg" />
      <meta name="twitter:image" content="https://example.com/twitter-cover.jpg" />
    </head>
  </html>`
});
assert.equal(ogFromHtml, "https://example.com/og-cover.jpg");

const jsonLdFromHtml = await selectCoverImage({
  url: "https://example.com/post",
  html: `<html>
    <head>
      <script type="application/ld+json">
        {
          "@type": "NewsArticle",
          "headline": "Demo",
          "image": { "url": "/structured-cover.jpg" }
        }
      </script>
    </head>
  </html>`
});
assert.equal(jsonLdFromHtml, "https://example.com/structured-cover.jpg");

const articleImageFromHtml = await selectCoverImage({
  url: "https://example.com/post",
  html: `<html>
    <body>
      <article>
        <img src="/article-image.jpg" />
      </article>
    </body>
  </html>`
});
assert.equal(articleImageFromHtml, "https://example.com/article-image.jpg");

const weakHtmlFallsBackToCandidates = await selectCoverImage({
  url: "https://example.com/post",
  html: '<html><head><meta property="og:image" content="https://example.com/logo.png" /></head></html>',
  snapshotCandidates: ["https://cdn.example.com/media/snapshot-photo.jpg"]
});
assert.equal(weakHtmlFallsBackToCandidates, "https://cdn.example.com/media/snapshot-photo.jpg");

const contentImageBeatsGenericMetadata = await selectCoverImage({
  url: "https://internal.example.com/articles/agent-notes",
  html: '<html><head><meta property="og:image" content="https://cdn.example.com/static/share.png" /></head></html>',
  snapshotCandidates: [
    {
      url: "https://cdn.example.com/static/share.png",
      score: 900,
      source: "metadata:og_image",
      width: 300,
      height: 300
    },
    {
      url: "https://cdn.example.com/uploads/article-photo.jpg",
      score: 780,
      source: "content_image",
      width: 960,
      height: 540,
      alt: "Agent workflow diagram",
      context: "article figure image",
      inContentRoot: true
    }
  ]
});
assert.equal(contentImageBeatsGenericMetadata, "https://cdn.example.com/uploads/article-photo.jpg");

const xDefaultOgFallsBackToTweetMedia = await selectCoverImage({
  url: "https://x.com/idoubicc/status/2062152804014436508",
  html: '<html><head><meta property="og:image" content="https://abs.twimg.com/rweb/ssr/default/v2/og/image.png" /></head></html>',
  snapshotCandidates: [
    "https://abs.twimg.com/rweb/ssr/default/v2/og/image.png",
    "https://pbs.twimg.com/media/HJ4WUQpaMAEcEkw?format=jpg&name=medium"
  ]
});
assert.equal(xDefaultOgFallsBackToTweetMedia, "https://pbs.twimg.com/media/HJ4WUQpaMAEcEkw?format=jpg&name=medium");

const allWeakReturnsUndefined = await selectCoverImage({
  url: "https://example.com/post",
  html: '<html><head><meta property="og:image" content="https://example.com/favicon.ico" /></head></html>',
  snapshotCandidates: ["https://example.com/sprite.svg"]
});
assert.equal(allWeakReturnsUndefined, undefined);

const malformedHtmlDoesNotThrow = await selectCoverImage({
  url: "https://example.com/post",
  html: "<<not really html>>",
  snapshotCandidates: ["https://cdn.example.com/media/snapshot-photo.jpg"]
});
assert.equal(malformedHtmlDoesNotThrow, "https://cdn.example.com/media/snapshot-photo.jpg");

// Mixed-content guard: an https page (e.g. Hunter web client) cannot render
// http images. When the captured page is https, the preferred cover URL must
// be upgraded to https so the browser does not silently block it. Real-world
// trigger: B站 JSON-LD VideoObject.thumbnailUrl is emitted as http://.
// The hdslb resize-directive upgrade also kicks in for the same URL so the
// final cover is both https AND high enough resolution to look crisp on
// retina cards/detail panels.
const httpsPageUpgradesPreferredCover = await selectCoverImage({
  url: "https://www.bilibili.com/video/BV1xxx/",
  preferred: "http://i2.hdslb.com/bfs/archive/cover.jpg@189w_107h.jpg"
});
assert.equal(httpsPageUpgradesPreferredCover, "https://i2.hdslb.com/bfs/archive/cover.jpg@1280w.webp");

// http page must NOT be upgraded — we only mirror the browser's mixed-content
// policy, we do not force https on sites the user explicitly captured over http.
const httpPageKeepsHttpCover = await selectCoverImage({
  url: "http://legacy.example.com/post",
  preferred: "http://cdn.example.com/cover.jpg"
});
assert.equal(httpPageKeepsHttpCover, "http://cdn.example.com/cover.jpg");

// The upgrade must apply to every selection path, not just `preferred`.
const httpsPageUpgradesOgImage = await selectCoverImage({
  url: "https://www.bilibili.com/video/BV1yyy/",
  html: '<html><head><meta property="og:image" content="http://i2.hdslb.com/bfs/archive/og.jpg" /></head></html>'
});
assert.equal(httpsPageUpgradesOgImage, "https://i2.hdslb.com/bfs/archive/og.jpg");

const httpsPageUpgradesCandidate = await selectCoverImage({
  url: "https://www.bilibili.com/video/BV1zzz/",
  snapshotCandidates: ["http://i2.hdslb.com/bfs/archive/snapshot.jpg"]
});
assert.equal(httpsPageUpgradesCandidate, "https://i2.hdslb.com/bfs/archive/snapshot.jpg");

// B站 CDN resize directive upgrade: tiny thumbnails get rewritten to a
// crisp 1280w canonical size. Without this the JSON-LD VideoObject thumbnail
// (`@189w_107h.webp`) and og:image (`@100w_100h_1c.png`) both render blurry
// in Hunter's list cards and detail panel.
const hdslbThumbnailUpgraded = await selectCoverImage({
  url: "https://www.bilibili.com/video/BV1aaa/",
  preferred: "https://i0.hdslb.com/bfs/archive/abc.jpg@189w_107h.webp"
});
assert.equal(hdslbThumbnailUpgraded, "https://i0.hdslb.com/bfs/archive/abc.jpg@1280w.webp");

const hdslbOgImageUpgraded = await selectCoverImage({
  url: "https://www.bilibili.com/video/BV1bbb/",
  preferred: "https://i1.hdslb.com/bfs/archive/abc.jpg@100w_100h_1c.png"
});
assert.equal(hdslbOgImageUpgraded, "https://i1.hdslb.com/bfs/archive/abc.jpg@1280w.webp");

// Already-high-resolution sources are left alone so we never downgrade quality.
const hdslbHighResLeftAlone = await selectCoverImage({
  url: "https://www.bilibili.com/video/BV1ccc/",
  preferred: "https://i2.hdslb.com/bfs/archive/abc.jpg@1920w.webp"
});
assert.equal(hdslbHighResLeftAlone, "https://i2.hdslb.com/bfs/archive/abc.jpg@1920w.webp");

// hdslb URLs without any resize directive must not gain one — that would risk
// breaking other CDNs that share the suffix-as-path convention.
const hdslbOriginalLeftAlone = await selectCoverImage({
  url: "https://www.bilibili.com/video/BV1ddd/",
  preferred: "https://i0.hdslb.com/bfs/archive/abc.jpg"
});
assert.equal(hdslbOriginalLeftAlone, "https://i0.hdslb.com/bfs/archive/abc.jpg");

// Non-hdslb hosts must be untouched even if they happen to use an `@` segment.
const nonHdslbAtSuffixLeftAlone = await selectCoverImage({
  url: "https://example.com/post",
  preferred: "https://cdn.example.com/img.jpg@100w.webp"
});
assert.equal(nonHdslbAtSuffixLeftAlone, "https://cdn.example.com/img.jpg@100w.webp");

console.log("cover image fixtures passed");
