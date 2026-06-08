import type { EnrichmentState, PageSnapshot, SourceType } from "../../shared/types";

export type SourceExtractionInput = {
  url: string;
  snapshot: PageSnapshot;
};

export type ExtractedContent = {
  url: string;
  canonicalUrl: string;
  title: string;
  sourceName: string;
  sourceType: SourceType;
  excerpt: string;
  readableText: string;
  contentHtml?: string;
  coverImage?: string;
  favicon?: string;
  author?: string;
  publishedAt?: string;
  language?: string;
  wordCount?: number;
  confidence: number;
  extractionState: EnrichmentState;
  extractor?: string;
  sourceMessage?: string;
};

export type SourceAdapter = {
  id: string;
  label: string;
  canHandle(url: string): boolean;
  extract(input: SourceExtractionInput): Promise<ExtractedContent | undefined>;
};
