import crypto from "node:crypto";
import type { CreateItemInput, LibraryItem, SourceType } from "../shared/types";
import { toStoredCaptureInput } from "./captureInput";
import { enrichContent } from "./enrich";
import { detectSourceType, extractContent, normalizeUrl } from "./extract";
import { buildContentHash, contentRecognitionVersion } from "./recognitionMetadata";
import { createRecognitionTimer } from "./recognitionTiming";
import { selectCoverImageFromCandidates } from "./sources/coverImage";
import { normalizeTags } from "./tags";

export async function buildItem(
  input: CreateItemInput,
  id: string = crypto.randomUUID(),
  savedAt: string = new Date().toISOString()
): Promise<LibraryItem> {
  const recognitionTimer = createRecognitionTimer();
  const now = new Date().toISOString();

  try {
    const extracted = await recognitionTimer.measure("sourceAdapterMs", () => extractContent({ url: input.url, snapshot: input.snapshot }));
    const enrichment = await recognitionTimer.measure("contentSignalsMs", async () =>
      extracted.extractionState === "needs_connector"
        ? {
            summary: extracted.sourceMessage ?? `Connect ${extracted.sourceName} to import the full content.`,
            tags: [extracted.sourceType],
            readingMinutes: 1
          }
        : await enrichContent(extracted)
    );
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
      tags: normalizeTags([...(input.tags ?? []), ...enrichment.tags]),
      note: input.note,
      summary: enrichment.summary,
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
      readingMinutes: enrichment.readingMinutes,
      confidence: extracted.confidence,
      enrichmentState: extracted.extractionState,
      enrichmentError: undefined,
      captureMethod: extracted.captureMethod,
      extractor: extracted.extractor,
      sourceAccess: extracted.sourceAccess,
      sourceMessage: extracted.sourceMessage,
      requiredConnector: extracted.requiredConnector,
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
  } catch (error) {
    const normalizedUrl = normalizeUrl(input.url);
    const fallbackTitle = input.title ?? input.snapshot?.title ?? new URL(input.url).hostname;
    const text = input.snapshot?.selectedText ?? input.snapshot?.textContent ?? input.snapshot?.excerpt ?? "";
    const sourceType = input.sourceType ?? detectSourceType(normalizedUrl);

    const item: LibraryItem = {
      id,
      url: normalizedUrl,
      canonicalUrl: normalizedUrl,
      title: fallbackTitle,
      sourceName: input.snapshot?.siteName ?? new URL(input.url).hostname,
      sourceType: sourceType as SourceType,
      status: "unread",
      favorite: false,
      tags: normalizeTags(input.tags ?? []),
      note: input.note,
      summary: text ? text.slice(0, 420) : `Saved for later: ${fallbackTitle}`,
      excerpt: text.slice(0, 420),
      readableText: text,
      coverImage: selectCoverImageFromCandidates(input.snapshot?.imageCandidates),
      favicon: input.snapshot?.favicon,
      savedAt,
      updatedAt: now,
      readingMinutes: Math.max(1, Math.ceil(text.length / 1200)),
      confidence: 0.2,
      enrichmentState: "failed",
      enrichmentError: error instanceof Error ? error.message : "Unknown enrichment error",
      captureMethod: input.snapshot ? "extension_snapshot" : "url_fetch",
      sourceAccess: input.snapshot ? "browser_snapshot" : "public",
      sourceMessage: "Capture failed before a source adapter could produce content.",
      requiredConnector: undefined,
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
}

export function buildQueuedItem(
  input: CreateItemInput,
  id: string = crypto.randomUUID(),
  savedAt: string = new Date().toISOString()
): LibraryItem {
  const normalizedUrl = normalizeUrl(input.url);
  const host = new URL(normalizedUrl).hostname.replace(/^www\./, "");
  const snapshotText = input.snapshot?.selectedText ?? input.snapshot?.excerpt ?? input.snapshot?.textContent ?? "";
  const sourceType = input.sourceType ?? detectSourceType(normalizedUrl);
  const title = input.title ?? input.snapshot?.title ?? host;
  const now = new Date().toISOString();

  const item: LibraryItem = {
    id,
    url: normalizedUrl,
    canonicalUrl: normalizeUrl(input.snapshot?.canonicalUrl ?? normalizedUrl),
    title,
    sourceName: input.snapshot?.siteName ?? host,
    sourceType,
    status: "unread",
    favorite: false,
    tags: normalizeTags(input.tags ?? []),
    note: input.note,
    summary: snapshotText ? snapshotText.slice(0, 420) : "Saved. Huntter is extracting content in the background.",
    excerpt: snapshotText.slice(0, 420),
    readableText: snapshotText,
    coverImage: selectCoverImageFromCandidates(input.snapshot?.imageCandidates),
    favicon: input.snapshot?.favicon,
    savedAt,
    updatedAt: now,
    readingMinutes: Math.max(1, Math.ceil(snapshotText.length / 1200)),
    confidence: snapshotText ? 0.35 : 0.1,
    enrichmentState: "processing",
    enrichmentError: undefined,
    captureMethod: input.snapshot ? "extension_snapshot" : "url_fetch",
    sourceAccess: input.snapshot ? "browser_snapshot" : "public",
    sourceMessage: "Saved. Huntter is extracting content in the background.",
    recognitionVersion: contentRecognitionVersion,
    captureInput: toStoredCaptureInput(input)
  };

  return {
    ...item,
    contentHash: buildContentHash(item)
  };
}
