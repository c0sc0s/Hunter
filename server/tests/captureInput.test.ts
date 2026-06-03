import assert from "node:assert/strict";
import { captureInputLimits, toRecognitionInput, toRefreshInput, toStoredCaptureInput } from "../captureInput";
import type { CreateItemInput, LibraryItem } from "../../shared/types";

const oversizedInput = {
  url: "https://example.com/private-doc",
  title: "T".repeat(captureInputLimits.title + 20),
  tags: ["must-not-store"],
  note: "must not store",
  snapshot: {
    url: "https://example.com/private-doc",
    canonicalUrl: "https://example.com/private-doc?view=clean",
    title: "Snapshot title",
    html: `<main>${"html ".repeat(80_000)}</main>`,
    textContent: "text ".repeat(40_000),
    selectedText: "selected ".repeat(10_000),
    excerpt: "excerpt ".repeat(2_000),
    siteName: "Example Workspace",
    favicon: "https://example.com/favicon.ico",
    imageCandidates: Array.from({ length: 40 }, (_, index) => `https://example.com/image-${index}.jpg`),
    publishedAt: "2026-06-02T00:00:00.000Z"
  }
} satisfies CreateItemInput;

const stored = toStoredCaptureInput(oversizedInput);

assert.equal(stored.note, undefined);
assert.equal(stored.tags, undefined);
assert.equal(stored.title?.length, captureInputLimits.title);
assert.equal(stored.snapshot?.html?.length, captureInputLimits.snapshotHtml);
assert.equal(stored.snapshot?.textContent?.length, captureInputLimits.snapshotText);
assert.equal(stored.snapshot?.selectedText?.length, captureInputLimits.selectedText);
assert.equal(stored.snapshot?.excerpt?.length, captureInputLimits.excerpt);
assert.equal(stored.snapshot?.imageCandidates?.length, captureInputLimits.imageCandidates);
assert.equal(stored.snapshot?.canonicalUrl, "https://example.com/private-doc?view=clean");

const refreshInput = toRefreshInput({
  id: "item",
  url: "https://example.com/private-doc",
  canonicalUrl: "https://example.com/private-doc",
  title: "Stored item title",
  sourceName: "Example",
  sourceType: "article",
  status: "reading",
  favorite: true,
  tags: ["user-tag"],
  note: "user note",
  summary: "summary",
  excerpt: "excerpt",
  savedAt: "2026-06-02T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
  readingMinutes: 1,
  confidence: 0.8,
  enrichmentState: "ready",
  captureInput: stored
} satisfies LibraryItem);

assert.equal(refreshInput.url, "https://example.com/private-doc");
assert.equal(refreshInput.note, "user note");
assert.deepEqual(refreshInput.tags, ["user-tag"]);
assert.equal(refreshInput.snapshot?.html?.length, captureInputLimits.snapshotHtml);

const recognitionInput = toRecognitionInput(oversizedInput);
assert.equal(recognitionInput.note, "must not store");
assert.deepEqual(recognitionInput.tags, ["must-not-store"]);
assert.equal(recognitionInput.snapshot?.textContent?.length, captureInputLimits.snapshotText);

console.log("capture input fixtures passed");
