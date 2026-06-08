import crypto from "node:crypto";
import type { CreateItemInput, LibraryItem } from "../shared/types";
import { toStoredCaptureInput } from "./captureInput";
import { buildContentSignals, maxSummaryLength } from "./contentSignals";
import { detectSourceType, extractContent, normalizeUrl } from "./extract";
import { buildContentHash, contentRecognitionVersion } from "./recognitionMetadata";
import { createRecognitionTimer } from "./recognitionTiming";
import { selectCoverImageFromCandidates } from "./sources/coverImage";
import { normalizeTags } from "./tags";

// Recognition errors propagate to the caller (the durable job runner) so they
// can be retried via failRecognitionJob + markRecognitionFailed. Callers should
// treat a thrown buildItem as a real recognition failure rather than synthesizing
// a snapshot-fallback item, which would hide the failure from retries.
export async function buildItem(
  input: CreateItemInput,
  id: string = crypto.randomUUID(),
  savedAt: string = new Date().toISOString()
): Promise<LibraryItem> {
  const recognitionTimer = createRecognitionTimer();
  const now = new Date().toISOString();

  const extracted = await recognitionTimer.measure("sourceAdapterMs", () => extractContent({ url: input.url, snapshot: input.snapshot }));
  const signals = await recognitionTimer.measure("contentSignalsMs", () => Promise.resolve(buildContentSignals(extracted)));
  const sourceType = input.sourceType ?? extracted.sourceType;

  const item: LibraryItem = {
    id,
    url: extracted.url,
    canonicalUrl: extracted.canonicalUrl,
    title: input.title ?? extracted.title,
    sourceName: extracted.sourceName,
    sourceType,
    status: "unread",
    favorite: false,
    tags: normalizeTags([...(input.tags ?? []), ...signals.tags]),
    note: input.note,
    summary: signals.summary,
    excerpt: extracted.excerpt,
    readableText: extracted.readableText,
    contentHtml: extracted.contentHtml,
    coverImage: extracted.coverImage,
    favicon: extracted.favicon,
    author: extracted.author,
    publishedAt: extracted.publishedAt,
    language: extracted.language,
    wordCount: extracted.wordCount,
    savedAt,
    updatedAt: now,
    readingMinutes: signals.readingMinutes,
    confidence: extracted.confidence,
    enrichmentState: extracted.extractionState,
    enrichmentError: undefined,
    extractor: extracted.extractor,
    sourceMessage: extracted.sourceMessage,
    recognitionVersion: contentRecognitionVersion,
    recognizedAt: now,
    captureInput: toStoredCaptureInput(input)
  };
  const recognitionTiming = recognitionTimer.snapshot();

  return {
    ...item,
    recognitionDurationMs: recognitionTiming.totalMs,
    recognitionTiming,
    contentHash: buildContentHash(item)
  };
}

export function buildQueuedItem(
  input: CreateItemInput,
  id: string = crypto.randomUUID(),
  savedAt: string = new Date().toISOString()
): LibraryItem {
  const normalizedUrl = normalizeUrl(input.url);
  const host = new URL(normalizedUrl).hostname.replace(/^www\./, "");
  const snapshotText =
    input.snapshot.selectedText ??
    input.snapshot.textContent ??
    input.snapshot.contentCandidates?.map((candidate) => candidate.text).find(Boolean) ??
    input.snapshot.excerpt ??
    "";
  const sourceType = input.sourceType ?? detectSourceType(normalizedUrl);
  const title = input.title ?? input.snapshot.title ?? host;
  const now = new Date().toISOString();

  const item: LibraryItem = {
    id,
    url: normalizedUrl,
    canonicalUrl: normalizeUrl(input.snapshot.canonicalUrl ?? normalizedUrl),
    title,
    sourceName: input.snapshot.siteName ?? host,
    sourceType,
    status: "unread",
    favorite: false,
    tags: normalizeTags(input.tags ?? []),
    note: input.note,
    summary: snapshotText ? snapshotText.slice(0, maxSummaryLength) : "Saved. Hunter is extracting content in the background.",
    excerpt: snapshotText.slice(0, maxSummaryLength),
    readableText: snapshotText,
    coverImage: selectCoverImageFromCandidates(input.snapshot.imageCandidates),
    favicon: input.snapshot.favicon,
    savedAt,
    updatedAt: now,
    readingMinutes: Math.max(1, Math.ceil(snapshotText.length / 1200)),
    confidence: snapshotText ? 0.35 : 0.1,
    enrichmentState: "processing",
    enrichmentError: undefined,
    sourceMessage: "Saved. Hunter is extracting content in the background.",
    recognitionVersion: contentRecognitionVersion,
    captureInput: toStoredCaptureInput(input)
  };

  return {
    ...item,
    contentHash: buildContentHash(item)
  };
}
