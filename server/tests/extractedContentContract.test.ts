import assert from "node:assert/strict";
import { validateExtractedContent } from "../sources/extractedContentContract";
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
  extractionState: "ready",
  captureMethod: "url_fetch",
  sourceAccess: "public"
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
    extractionState: "needs_connector",
    readableText: "",
    contentHtml: undefined,
    sourceAccess: "public",
    requiredConnector: undefined,
    sourceMessage: ""
  }).join("; "),
  /connector_required.*requiredConnector.*sourceMessage/s
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

console.log("extracted content contract fixtures passed");
