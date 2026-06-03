import assert from "node:assert/strict";
import { buildContentHash, contentRecognitionVersion } from "../recognitionMetadata";

const base = {
  canonicalUrl: "https://example.com/article",
  title: "Durable recognition",
  sourceType: "article" as const,
  excerpt: "Recognition metadata makes reprocessing measurable.",
  readableText: "Recognition metadata makes reprocessing measurable and lets parser changes be compared safely.",
  contentHtml: "<article><p>Recognition metadata makes reprocessing measurable.</p></article>",
  author: "Huntter",
  publishedAt: "2026-06-02T00:00:00.000Z",
  language: "en"
};

const same = buildContentHash(base);
const sameAgain = buildContentHash({ ...base });
const changedBody = buildContentHash({
  ...base,
  readableText: `${base.readableText} A new paragraph changes the canonical content.`
});

assert.equal(contentRecognitionVersion, 1);
assert.match(same, /^[a-f0-9]{64}$/);
assert.equal(same, sameAgain);
assert.notEqual(same, changedBody);

console.log("recognition metadata fixtures passed");
