import type { CreateItemInput, LibraryItem } from "../shared/types";

export const captureInputLimits = {
  title: 500,
  snapshotHtml: 180_000,
  snapshotText: 120_000,
  selectedText: 40_000,
  excerpt: 4_000,
  siteName: 300,
  favicon: 2_000,
  publishedAt: 200,
  imageCandidates: 16,
  imageCandidateUrl: 2_000
};

export function toStoredCaptureInput(input: CreateItemInput): CreateItemInput {
  return {
    url: input.url,
    title: truncate(input.title, captureInputLimits.title),
    sourceType: input.sourceType,
    snapshot: input.snapshot
      ? {
          title: truncate(input.snapshot.title, captureInputLimits.title),
          url: input.snapshot.url,
          canonicalUrl: input.snapshot.canonicalUrl,
          html: truncate(input.snapshot.html, captureInputLimits.snapshotHtml),
          textContent: truncate(input.snapshot.textContent, captureInputLimits.snapshotText),
          selectedText: truncate(input.snapshot.selectedText, captureInputLimits.selectedText),
          excerpt: truncate(input.snapshot.excerpt, captureInputLimits.excerpt),
          siteName: truncate(input.snapshot.siteName, captureInputLimits.siteName),
          favicon: truncate(input.snapshot.favicon, captureInputLimits.favicon),
          imageCandidates: input.snapshot.imageCandidates
            ?.slice(0, captureInputLimits.imageCandidates)
            .map((candidate) => truncate(candidate, captureInputLimits.imageCandidateUrl))
            .filter((candidate): candidate is string => Boolean(candidate)),
          publishedAt: truncate(input.snapshot.publishedAt, captureInputLimits.publishedAt)
        }
      : undefined
  };
}

export function toRecognitionInput(input: CreateItemInput): CreateItemInput {
  return {
    ...toStoredCaptureInput(input),
    note: input.note,
    tags: input.tags
  };
}

export function toRefreshInput(item: LibraryItem): CreateItemInput {
  return {
    ...(item.captureInput ?? {
      url: item.url,
      title: item.title,
      sourceType: item.sourceType
    }),
    note: item.note,
    tags: item.tags
  };
}

function truncate(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  return value.length > limit ? value.slice(0, limit) : value;
}
