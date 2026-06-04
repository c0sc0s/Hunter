import assert from "node:assert/strict";
import { sanitizeExtractedContent, validateExtractedContent } from "../sources/extractedContentContract";
import type { ExtractedContent } from "../extract";

const valid = {
  url: "https://example.com/article",
  canonicalUrl: "https://example.com/article",
  title: "Valid Article",
  sourceName: "Example",
  sourceType: "article",
  excerpt: "A valid extracted content fixture.",
  readableText: "A valid extracted content fixture with enough body text.",
  contentHtml: "<article><p>A valid extracted content fixture with enough body text.</p></article>",
  confidence: 0.8,
  extractionState: "ready"
} satisfies ExtractedContent;

assert.deepEqual(validateExtractedContent(valid), []);

assert.match(
  validateExtractedContent({
    ...valid,
    title: "",
    confidence: 1.5,
    contentHtml: "<article><script>alert(1)</script></article>"
  }).join("; "),
  /title is required.*confidence.*script/s
);

assert.match(
  validateExtractedContent({
    ...valid,
    extractionState: "ready",
    readableText: "",
    contentHtml: undefined
  }).join("; "),
  /ready content must include readableText or contentHtml/
);

assert.match(
  validateExtractedContent({
    ...valid,
    extractionState: "partial",
    readableText: "",
    contentHtml: undefined,
    sourceMessage: ""
  }).join("; "),
  /partial content without body/
);

assert.match(
  validateExtractedContent({
    ...valid,
    extractionState: "failed"
  }).join("; "),
  /should throw instead of returning failed/
);

const sanitizedDataFavicon = sanitizeExtractedContent({
  ...valid,
  favicon: "data:image/png;base64,abc",
  coverImage: "blob:https://example.com/abc",
  publishedAt: "not-a-date",
  wordCount: -3
});

assert.equal(sanitizedDataFavicon.favicon, "https://www.google.com/s2/favicons?domain=example.com&sz=64");
assert.equal(sanitizedDataFavicon.coverImage, undefined);
assert.equal(sanitizedDataFavicon.publishedAt, undefined);
assert.equal(sanitizedDataFavicon.wordCount, undefined);
assert.deepEqual(validateExtractedContent(sanitizedDataFavicon), []);

const sanitizedKeepsValid = sanitizeExtractedContent({
  ...valid,
  favicon: "https://example.com/favicon.ico",
  coverImage: "https://example.com/cover.jpg",
  publishedAt: "2026-06-03T00:00:00.000Z",
  wordCount: 42
});

assert.equal(sanitizedKeepsValid.favicon, "https://example.com/favicon.ico");
assert.equal(sanitizedKeepsValid.coverImage, "https://example.com/cover.jpg");
assert.equal(sanitizedKeepsValid.publishedAt, "2026-06-03T00:00:00.000Z");
assert.equal(sanitizedKeepsValid.wordCount, 42);

console.log("extracted content contract fixtures passed");
