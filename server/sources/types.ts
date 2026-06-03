import type { CaptureMethod, ConnectorProvider, EnrichmentState, PageSnapshot, SourceAccess, SourceType } from "../../shared/types";

export type SourceExtractionInput = {
  url: string;
  snapshot?: PageSnapshot;
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
  captureMethod: CaptureMethod;
  extractor?: string;
  sourceAccess: SourceAccess;
  sourceMessage?: string;
  requiredConnector?: ConnectorProvider;
};

export type SourceAdapter = {
  id: string;
  label: string;
  canHandle(url: string): boolean;
  extract(input: SourceExtractionInput): Promise<ExtractedContent | undefined>;
};
