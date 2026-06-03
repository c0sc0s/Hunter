import assert from "node:assert/strict";
import { isUsefulCoverImageUrl, pickCoverImage } from "../sources/coverImage";

assert.equal(
  pickCoverImage([
    { url: "https://example.com/logo.png", source: "snapshot_image" },
    { url: "https://example.com/article-inline.jpg", source: "article_image" },
    { url: "https://example.com/structured-cover.jpg", source: "structured_data" }
  ]),
  "https://example.com/structured-cover.jpg"
);

assert.equal(
  pickCoverImage([
    { url: "data:image/png;base64,abc", source: "open_graph" },
    { url: "https://example.com/favicon.ico", source: "open_graph" },
    { url: "https://example.com/sprite.svg", source: "article_image" },
    { url: "https://example.com/avatar-photo.jpg", source: "snapshot_image" }
  ]),
  undefined
);

assert.equal(
  pickCoverImage([
    { url: "https://example.com/logo.png", source: "open_graph" },
    { url: "https://cdn.example.com/media/post-photo.jpg", source: "snapshot_image" }
  ]),
  "https://cdn.example.com/media/post-photo.jpg"
);

assert.equal(
  pickCoverImage([
    { url: "https://i.ytimg.com/vi/demo/hqdefault.jpg", source: "oembed" },
    { url: "https://example.com/article-cover.jpg", source: "article_image" }
  ]),
  "https://i.ytimg.com/vi/demo/hqdefault.jpg"
);

assert.equal(isUsefulCoverImageUrl("https://pbs.twimg.com/media/demo.jpg"), true);
assert.equal(isUsefulCoverImageUrl("https://example.com/profile_images/avatar.jpg"), false);

console.log("cover image fixtures passed");
