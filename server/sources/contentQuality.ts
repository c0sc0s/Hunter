import type { EnrichmentState } from "../../shared/types";
import { cleanText } from "./url";

export type ContentCandidateSource =
  | "selected_text"
  | "defuddle"
  | "readability"
  | "pdf_text"
  | "browser_snapshot"
  | "tweet_snapshot"
  | "metadata";

export type ContentCandidate = {
  source: ContentCandidateSource;
  text: string | undefined;
};

export type ContentQualityDecision = {
  readableText: string;
  candidateSource: ContentCandidateSource;
  extractor: string;
  extractionState: EnrichmentState;
  confidence: number;
  wordCount: number;
  sourceMessage?: string;
};

const readyThresholds: Record<ContentCandidateSource, number> = {
  selected_text: 80,
  defuddle: 160,
  readability: 160,
  pdf_text: 160,
  browser_snapshot: 240,
  // Tweets are inherently short; a 280-character post can be a complete capture.
  tweet_snapshot: 80,
  metadata: Number.POSITIVE_INFINITY
};

const preferredOrder: ContentCandidateSource[] = [
  "selected_text",
  "defuddle",
  "readability",
  "pdf_text",
  "browser_snapshot",
  "tweet_snapshot",
  "metadata"
];

export function shouldRunReadabilityFallback(selectedText: string | undefined, defuddledText: string | undefined): boolean {
  if (hasReadySelectedText(selectedText)) return false;
  return cleanText(defuddledText).length < readyThresholds.defuddle;
}

export function hasReadySelectedText(selectedText: string | undefined): boolean {
  return cleanText(selectedText).length >= readyThresholds.selected_text;
}

export function decideContentQuality(candidates: ContentCandidate[]): ContentQualityDecision {
  const bySource = new Map(
    candidates.map((candidate) => [
      candidate.source,
      {
        source: candidate.source,
        text: cleanText(candidate.text)
      }
    ])
  );

  const readyCandidate = preferredOrder
    .map((source) => bySource.get(source))
    .find((candidate) => candidate && candidate.text.length >= readyThresholds[candidate.source]);
  const fallbackCandidate = readyCandidate ??
    [...bySource.values()].filter((candidate) => candidate.text).sort((a, b) => b.text.length - a.text.length)[0] ?? {
      source: "metadata" as const,
      text: ""
    };

  const extractionState: EnrichmentState = isReady(fallbackCandidate.source, fallbackCandidate.text) ? "ready" : "partial";
  const sourceMessage =
    fallbackCandidate.source === "metadata"
      ? "Only shallow page metadata was captured. Open the page and save with the browser extension for a fuller capture."
      : undefined;

  return {
    readableText: fallbackCandidate.text,
    candidateSource: fallbackCandidate.source,
    extractor: extractorFor(fallbackCandidate.source),
    extractionState,
    confidence: confidenceFor(fallbackCandidate.source, fallbackCandidate.text),
    wordCount: countContentWords(fallbackCandidate.text),
    sourceMessage
  };
}

export function countContentWords(text: string): number {
  const latinWords = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  const cjkChars = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return latinWords + Math.ceil(cjkChars / 2);
}

function isReady(source: ContentCandidateSource, text: string): boolean {
  return text.length >= readyThresholds[source];
}

function extractorFor(source: ContentCandidateSource): string {
  if (source === "selected_text") return "browser_selection";
  if (source === "pdf_text") return "unpdf";
  if (source === "browser_snapshot" || source === "tweet_snapshot") return "browser_snapshot";
  return source;
}

function confidenceFor(source: ContentCandidateSource, text: string): number {
  if (!text) return 0.2;
  if (text.length < 80) return 0.3;
  if (source === "selected_text") return 0.72;
  if (source === "defuddle") return 0.9;
  if (source === "readability") return 0.84;
  if (source === "pdf_text") return 0.78;
  if (source === "browser_snapshot") return 0.62;
  if (source === "tweet_snapshot") return 0.62;
  return 0.42;
}
