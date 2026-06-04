import assert from "node:assert/strict";
import { buildCaptureEvent, estimateSnapshotBytes } from "../captureEvents";
import type { LibraryItem } from "../../shared/types";

const snapshot = {
  url: "https://example.com/private",
  title: "Private Doc",
  textContent: "Visible private content captured by the extension."
};

const item = {
  id: "item-1",
  url: "https://example.com/private",
  canonicalUrl: "https://example.com/private",
  title: "Private Doc",
  sourceName: "Example",
  sourceType: "article",
  status: "unread",
  favorite: false,
  tags: [],
  summary: "Captured summary",
  excerpt: "Captured excerpt",
  savedAt: "2026-06-02T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
  readingMinutes: 1,
  confidence: 0.8,
  enrichmentState: "ready",
  recognitionVersion: 1,
  recognitionDurationMs: 25,
  contentHash: "hash"
} satisfies LibraryItem;

const input = {
  url: "https://example.com/private",
  snapshot
};

const event = buildCaptureEvent({
  input,
  item,
  now: "2026-06-02T01:00:00.000Z"
});

assert.equal(event.itemId, "item-1");
assert.equal(event.sourceUrl, input.url);
assert.equal(event.canonicalUrl, item.canonicalUrl);
assert.equal(event.snapshotBytes, Buffer.byteLength(JSON.stringify(snapshot), "utf8"));
assert.equal(event.resultState, "ready");
assert.equal(event.recognitionVersion, 1);
assert.equal(event.recognitionDurationMs, 25);
assert.equal(event.contentHash, "hash");
assert.equal(event.error, undefined);
assert.equal(event.createdAt, "2026-06-02T01:00:00.000Z");

assert.equal(estimateSnapshotBytes({ snapshot }), Buffer.byteLength(JSON.stringify(snapshot), "utf8"));

const failed = buildCaptureEvent({
  input: { url: "https://example.com/public", snapshot: { url: "https://example.com/public" } },
  item: {
    ...item,
    enrichmentState: "failed",
    enrichmentError: "Parser failed"
  },
  error: new Error("Network failed")
});

assert.equal(failed.resultState, "failed");
assert.equal(failed.error, "Network failed");

console.log("capture event fixtures passed");
