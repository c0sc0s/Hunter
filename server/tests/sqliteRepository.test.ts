import assert from "node:assert/strict";
import type { LibraryItem } from "../../shared/types";
import { SqliteRepository } from "../repositories/sqliteRepository";

const repo = new SqliteRepository(":memory:");
const now = new Date("2026-06-02T00:00:00.000Z").toISOString();

try {
  const queued = item({
    id: "item-1",
    url: "https://example.com/a",
    canonicalUrl: "https://example.com/a",
    tags: ["product"],
    enrichmentState: "processing",
    captureInput: {
      url: "https://example.com/a",
      snapshot: {
        url: "https://example.com/a",
        textContent: "Original browser snapshot for recognition refresh."
      }
    }
  });

  const created = await repo.upsertQueued(queued, {
    url: queued.url,
    tags: ["capture"],
    snapshot: { url: queued.url, textContent: "Original browser snapshot for recognition refresh." }
  });

  assert.equal(created.id, "item-1");
  assert.deepEqual(created.tags.sort(), ["product"].sort());
  assert.equal(created.captureInput?.snapshot?.textContent, "Original browser snapshot for recognition refresh.");

  await repo.recordCaptureEvent({
    id: "capture-event-queued",
    itemId: created.id,
    sourceUrl: created.url,
    canonicalUrl: created.canonicalUrl,
    sourceType: created.sourceType,
    snapshotBytes: 64,
    resultState: "processing",
    recognitionVersion: 1,
    contentHash: "hash-queued",
    createdAt: "2026-06-02T00:00:00.100Z"
  });

  const patched = await repo.patch(created.id, {
    status: "reading",
    favorite: true,
    tags: ["workflow"]
  });

  assert.equal(patched?.status, "reading");
  assert.equal(patched?.favorite, true);
  assert.deepEqual(patched?.tags, ["workflow"]);

  const duplicate = item({
    id: "item-2",
    url: "https://example.com/a?utm=duplicate",
    canonicalUrl: "https://example.com/a",
    title: "Queued duplicate",
    tags: ["duplicate"],
    enrichmentState: "processing",
    captureInput: {
      url: "https://example.com/a?utm=duplicate",
      snapshot: {
        url: "https://example.com/a?utm=duplicate",
        textContent: "Newer duplicate browser snapshot for future recognition refresh."
      }
    }
  });

  const merged = await repo.upsertQueued(duplicate, {
    url: duplicate.url,
    tags: ["new-tag"],
    note: "preserve this note",
    snapshot: { url: duplicate.url, textContent: "Newer duplicate browser snapshot for future recognition refresh." }
  });

  assert.equal(merged.id, "item-1");
  assert.equal(merged.status, "reading");
  assert.equal(merged.favorite, true);
  assert.equal(merged.note, "preserve this note");
  assert.ok(merged.tags.includes("workflow"));
  assert.ok(merged.tags.includes("new-tag"));
  assert.equal(merged.captureInput?.snapshot?.textContent, "Newer duplicate browser snapshot for future recognition refresh.");

  const enriched = item({
    ...merged,
    title: "Recognized title",
    summary: "Recognized summary",
    extractor: "defuddle",
    enrichmentState: "ready",
    recognitionVersion: 1,
    recognizedAt: now,
    recognitionDurationMs: 42,
    recognitionTiming: {
      totalMs: 42,
      sourceAdapterMs: 31,
      contentSignalsMs: 7,
      itemBuildMs: 4
    },
    tags: ["recognized", "auto-topic"],
    contentHash: "hash-recognized",
    captureInput: {
      url: "https://example.com/a",
      snapshot: { url: "https://example.com/a", textContent: "Newer duplicate browser snapshot for future recognition refresh." }
    }
  });

  const replaced = await repo.replaceRecognitionResult(merged.id, enriched, {
    tags: []
  });

  assert.equal(replaced?.title, "Recognized title");
  assert.equal(replaced?.status, "reading");
  assert.equal(replaced?.favorite, true);
  assert.equal(replaced?.extractor, "defuddle");
  assert.equal(replaced?.recognitionVersion, 1);
  assert.equal(replaced?.recognizedAt, now);
  assert.equal(replaced?.recognitionDurationMs, 42);
  assert.deepEqual(replaced?.recognitionTiming, {
    totalMs: 42,
    sourceAdapterMs: 31,
    contentSignalsMs: 7,
    itemBuildMs: 4
  });
  assert.equal(replaced?.contentHash, "hash-recognized");
  assert.ok(replaced?.tags.includes("recognized"));
  assert.ok(replaced?.tags.includes("auto-topic"));
  assert.ok(replaced?.tags.includes("workflow"));
  assert.equal(replaced?.captureInput?.snapshot?.textContent, "Newer duplicate browser snapshot for future recognition refresh.");
  assert.equal((await repo.listCaptureEvents(10)).find((event) => event.id === "capture-event-queued")?.itemId, "item-1");

  const second = item({
    id: "item-3",
    url: "https://example.com/b",
    canonicalUrl: "https://example.com/b",
    title: "Archive title",
    summary: "A separate archived note about climate markets.",
    status: "archived",
    favorite: false,
    tags: ["markets"]
  });

  await repo.upsertQueued(second, {
    url: second.url,
    tags: second.tags,
    snapshot: { url: second.url, textContent: "Archived snapshot." }
  });

  const list = await repo.list();
  assert.equal(list.stats.total, 2);
  assert.equal(list.stats.reading, 1);
  assert.equal(list.stats.favorite, 1);
  assert.equal(list.stats.sources.article, 2);

  const search = await repo.list({ q: "recognized", limit: 10 });
  assert.equal(search.page.total, 1);
  assert.equal(search.items[0]?.id, "item-1");

  const filtered = await repo.list({ filter: "archived", limit: 10 });
  assert.equal(filtered.page.total, 1);
  assert.equal(filtered.items[0]?.id, "item-3");

  const paged = await repo.list({ limit: 1, offset: 0 });
  assert.equal(paged.items.length, 1);
  assert.equal(paged.page.total, 2);
  assert.equal(paged.page.hasMore, true);

  const job = {
    id: "job-1",
    itemId: merged.id,
    input: {
      url: merged.url,
      tags: ["recognized"],
      snapshot: { url: merged.url, textContent: "snapshot for job" }
    },
    savedAt: merged.savedAt,
    status: "queued" as const,
    attemptCount: 0,
    runAfter: now,
    createdAt: now,
    updatedAt: now
  };

  await repo.enqueueRecognitionJob(job);
  const claimed = await repo.claimRecognitionJobs(10);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.id, "job-1");
  assert.equal(claimed[0]?.status, "running");
  assert.equal(claimed[0]?.attemptCount, 1);

  await repo.failRecognitionJob("job-1", new Error("temporary failure"), now);
  const retried = await repo.claimRecognitionJobs(10);
  assert.equal(retried.length, 1);
  assert.equal(retried[0]?.attemptCount, 2);

  await repo.completeRecognitionJob("job-1");
  assert.equal((await repo.claimRecognitionJobs(10)).length, 0);

  await repo.recordCaptureEvent({
    id: "capture-event-1",
    itemId: merged.id,
    sourceUrl: merged.url,
    canonicalUrl: merged.canonicalUrl,
    sourceType: merged.sourceType,
    snapshotBytes: 128,
    resultState: "ready",
    recognitionVersion: 1,
    recognitionDurationMs: 42,
    contentHash: "hash-recognized",
    createdAt: now
  });

  const captureEvents = await repo.listCaptureEvents(10);
  assert.equal(captureEvents.length, 2);
  const readyCaptureEvent = captureEvents.find((event) => event.id === "capture-event-1");
  assert.equal(readyCaptureEvent?.itemId, merged.id);
  assert.equal(readyCaptureEvent?.snapshotBytes, 128);
  assert.equal(readyCaptureEvent?.resultState, "ready");
  assert.equal(readyCaptureEvent?.recognitionDurationMs, 42);

  const deleted = await repo.delete(merged.id);
  assert.equal(deleted, true);
  assert.equal((await repo.list()).stats.total, 1);
  assert.equal((await repo.listCaptureEvents(10))[0]?.itemId, undefined);

  console.log("sqlite repository fixtures passed");
} finally {
  repo.close();
}

function item(overrides: Partial<LibraryItem>): LibraryItem {
  return {
    id: "item",
    url: "https://example.com/item",
    canonicalUrl: "https://example.com/item",
    title: "Queued title",
    sourceName: "Example",
    sourceType: "article",
    status: "unread",
    favorite: false,
    tags: [],
    summary: "Queued summary",
    excerpt: "Queued excerpt",
    readableText: "Queued readable text",
    savedAt: now,
    updatedAt: now,
    readingMinutes: 1,
    confidence: 0.2,
    enrichmentState: "processing",
    ...overrides
  };
}
