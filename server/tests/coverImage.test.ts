import assert from "node:assert/strict";
import { isUsefulCoverImageUrl, selectCoverImage, selectCoverImageFromCandidates } from "../sources/coverImage";

assert.equal(isUsefulCoverImageUrl("https://pbs.twimg.com/media/demo.jpg"), true);
assert.equal(isUsefulCoverImageUrl("https://example.com/profile_images/avatar.jpg"), false);
assert.equal(isUsefulCoverImageUrl("https://example.com/sprite.svg"), false);
assert.equal(isUsefulCoverImageUrl("https://example.com/favicon.ico"), false);
assert.equal(isUsefulCoverImageUrl("data:image/png;base64,abc"), false);
assert.equal(isUsefulCoverImageUrl(undefined), false);

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
assert.equal(
  selectCoverImageFromCandidates(["https://example.com/sprite.svg", "data:image/png;base64,xyz"]),
  undefined
);

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

console.log("cover image fixtures passed");
