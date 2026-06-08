export type SourceType = "article" | "post" | "tweet" | "feishu" | "video" | "pdf" | "other";

export type ItemStatus = "unread" | "reading" | "read" | "archived";

export type LibraryFilter = "all" | ItemStatus | "favorite";

export type EnrichmentState = "processing" | "ready" | "partial" | "failed";

export type RecognitionTiming = {
  totalMs: number;
  sourceAdapterMs: number;
  contentSignalsMs: number;
  itemBuildMs: number;
};

export type AgentCategory =
  | "technical"
  | "product"
  | "business"
  | "research"
  | "news"
  | "opinion"
  | "tutorial"
  | "reference"
  | "social"
  | "media"
  | "other";

export type AgentIntent = "read_later" | "learn" | "reference" | "follow_up" | "summarize" | "watch" | "share" | "other";

export type AgentContentCategory = {
  id: string;
  label: string;
  description?: string;
  source: "existing" | "new";
};

export type AgentContentCategorySummary = {
  id: string;
  label: string;
  description?: string;
  count: number;
};

export type AgentClassification = {
  primaryCategory: AgentCategory;
  contentCategory: AgentContentCategory;
  intent: AgentIntent;
  topics: string[];
  summary: string;
  keyPoints: string[];
  confidence: number;
  language?: string;
  needsFollowUp: boolean;
};

export type AgentLlmProvider = "ollama" | "deepseek" | "openai-compatible";

export type AgentClassificationResult = {
  provider: AgentLlmProvider;
  model: string;
  generatedAt: string;
  contentHash?: string;
  classification: AgentClassification;
};

export type AgentLlmSettings = {
  provider: AgentLlmProvider;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  updatedAt?: string;
};

export type UpdateAgentLlmSettingsInput = {
  provider?: AgentLlmProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  clearApiKey?: boolean;
};

export type ImageCandidate =
  | string
  | {
      url: string;
      score?: number;
      source?: string;
      width?: number;
      height?: number;
      alt?: string;
      context?: string;
      inContentRoot?: boolean;
      order?: number;
    };

export type PageSnapshotContentCandidate = {
  kind: "focused_root" | "content_root" | "body";
  text?: string;
  html?: string;
  selector?: string;
  score?: number;
};

// PublicLibraryItem is what the API returns and what the web client consumes.
// It deliberately omits storage-only fields so the HTTP boundary is enforced at
// compile time, not just by toPublicItem() at runtime.
export type PublicLibraryItem = {
  id: string;
  url: string;
  canonicalUrl: string;
  title: string;
  sourceName: string;
  sourceType: SourceType;
  status: ItemStatus;
  favorite: boolean;
  tags: string[];
  note?: string;
  summary: string;
  excerpt: string;
  readableText?: string;
  contentHtml?: string;
  coverImage?: string;
  favicon?: string;
  author?: string;
  publishedAt?: string;
  language?: string;
  wordCount?: number;
  savedAt: string;
  updatedAt: string;
  readingMinutes: number;
  confidence: number;
  enrichmentState: EnrichmentState;
  enrichmentError?: string;
  extractor?: string;
  sourceMessage?: string;
  recognitionVersion?: number;
  recognizedAt?: string;
  recognitionDurationMs?: number;
  recognitionTiming?: RecognitionTiming;
  contentHash?: string;
  agentClassification?: AgentClassificationResult;
};

// LibraryItem is the storage-facing shape. It extends PublicLibraryItem with
// the truncated captureInput blob used for refresh/reprocessing.
export type LibraryItem = PublicLibraryItem & {
  captureInput?: CreateItemInput;
};

export type PageSnapshot = {
  title?: string;
  url: string;
  canonicalUrl?: string;
  html?: string;
  textContent?: string;
  selectedText?: string;
  excerpt?: string;
  siteName?: string;
  favicon?: string;
  imageCandidates?: ImageCandidate[];
  contentCandidates?: PageSnapshotContentCandidate[];
  publishedAt?: string;
};

export type CreateItemInput = {
  url: string;
  title?: string;
  sourceType?: SourceType;
  note?: string;
  tags?: string[];
  snapshot: PageSnapshot;
};

export type UpdateItemInput = Partial<Pick<LibraryItem, "status" | "favorite" | "tags" | "note">>;

export type LibraryStats = {
  total: number;
  unread: number;
  reading: number;
  read: number;
  archived: number;
  favorite: number;
  sources: Record<SourceType, number>;
  agentCategories: AgentContentCategorySummary[];
};

export type LibraryQuery = {
  filter?: LibraryFilter;
  sourceType?: SourceType;
  agentCategoryId?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export type LibraryPage = {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
};

export type LibraryResponse = {
  items: PublicLibraryItem[];
  stats: LibraryStats;
  page: LibraryPage;
};

export type AgentIncrementalClassificationResponse = {
  attempted: number;
  classified: number;
  skipped: number;
  items: PublicLibraryItem[];
  categories: AgentContentCategorySummary[];
};

export type CaptureEvent = {
  id: string;
  itemId?: string;
  sourceUrl: string;
  canonicalUrl?: string;
  sourceType?: SourceType;
  snapshotBytes: number;
  resultState: EnrichmentState;
  recognitionVersion?: number;
  recognitionDurationMs?: number;
  contentHash?: string;
  error?: string;
  createdAt: string;
};

export type CaptureEventsResponse = {
  events: CaptureEvent[];
};
