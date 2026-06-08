import type { CreateItemInput, ImageCandidate, LibraryItem, PageSnapshotContentCandidate } from "../shared/types";

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
  imageCandidateUrl: 2_000,
  imageCandidateText: 240,
  imageCandidateSource: 80,
  contentCandidates: 4,
  contentCandidateHtml: 80_000,
  contentCandidateText: 60_000,
  contentCandidateSelector: 300
};

export function toStoredCaptureInput(input: CreateItemInput): CreateItemInput {
  return {
    url: input.url,
    title: truncate(input.title, captureInputLimits.title),
    sourceType: input.sourceType,
    snapshot: {
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
        .map((candidate) => truncateImageCandidate(candidate))
        .filter((candidate): candidate is ImageCandidate => Boolean(candidate)),
      contentCandidates: input.snapshot.contentCandidates
        ?.slice(0, captureInputLimits.contentCandidates)
        .map((candidate) => truncateContentCandidate(candidate))
        .filter((candidate): candidate is PageSnapshotContentCandidate => Boolean(candidate)),
      publishedAt: truncate(input.snapshot.publishedAt, captureInputLimits.publishedAt)
    }
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
  if (!item.captureInput?.snapshot) {
    throw new Error(`Cannot refresh item ${item.id}: original browser snapshot is missing. Re-save with the extension.`);
  }

  return {
    ...item.captureInput,
    note: item.note,
    tags: item.tags
  };
}

function truncate(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  return value.length > limit ? value.slice(0, limit) : value;
}

function truncateImageCandidate(candidate: ImageCandidate): ImageCandidate | undefined {
  if (typeof candidate === "string") {
    return truncate(candidate, captureInputLimits.imageCandidateUrl);
  }

  const url = truncate(candidate.url, captureInputLimits.imageCandidateUrl);
  if (!url) return undefined;

  return {
    url,
    score: finiteNumber(candidate.score),
    source: truncate(candidate.source, captureInputLimits.imageCandidateSource),
    width: finiteNumber(candidate.width),
    height: finiteNumber(candidate.height),
    alt: truncate(candidate.alt, captureInputLimits.imageCandidateText),
    context: truncate(candidate.context, captureInputLimits.imageCandidateText),
    inContentRoot: candidate.inContentRoot || undefined,
    order: finiteNumber(candidate.order)
  };
}

function truncateContentCandidate(candidate: PageSnapshotContentCandidate): PageSnapshotContentCandidate | undefined {
  const text = truncate(candidate.text, captureInputLimits.contentCandidateText);
  const html = truncate(candidate.html, captureInputLimits.contentCandidateHtml);
  if (!text && !html) return undefined;

  return {
    kind: candidate.kind,
    text,
    html,
    selector: truncate(candidate.selector, captureInputLimits.contentCandidateSelector),
    score: finiteNumber(candidate.score)
  };
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
