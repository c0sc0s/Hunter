export type SourceType = "article" | "post" | "tweet" | "feishu" | "video" | "pdf" | "other";

export type ConnectorProvider = "feishu" | "x";

export type ConnectorAvailability = "planned" | "available";

export type ConnectorConnectionState = "not_connected" | "connected" | "error" | "disabled";

export type ItemStatus = "unread" | "reading" | "read" | "archived";

export type LibraryFilter = "all" | ItemStatus | "favorite";

export type EnrichmentState = "processing" | "ready" | "partial" | "needs_connector" | "failed";

export type CaptureMethod = "url_fetch" | "extension_snapshot" | "source_adapter" | "connector";

export type SourceAccess = "public" | "browser_snapshot" | "requires_auth" | "connector_required";

export type RecognitionTiming = {
  totalMs: number;
  sourceAdapterMs: number;
  contentSignalsMs: number;
  itemBuildMs: number;
};

export type LibraryItem = {
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
  captureMethod?: CaptureMethod;
  extractor?: string;
  sourceAccess?: SourceAccess;
  sourceMessage?: string;
  requiredConnector?: ConnectorProvider;
  recognitionVersion?: number;
  recognizedAt?: string;
  recognitionDurationMs?: number;
  recognitionTiming?: RecognitionTiming;
  contentHash?: string;
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
  imageCandidates?: string[];
  publishedAt?: string;
};

export type CreateItemInput = {
  url: string;
  title?: string;
  sourceType?: SourceType;
  note?: string;
  tags?: string[];
  snapshot?: PageSnapshot;
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
};

export type LibraryQuery = {
  filter?: LibraryFilter;
  sourceType?: SourceType;
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
  items: LibraryItem[];
  stats: LibraryStats;
  page: LibraryPage;
};

export type CaptureEvent = {
  id: string;
  itemId?: string;
  sourceUrl: string;
  canonicalUrl?: string;
  sourceType?: SourceType;
  captureMethod: CaptureMethod;
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

export type ConnectorDefinition = {
  provider: ConnectorProvider;
  label: string;
  sourceTypes: SourceType[];
  authMode: "oauth";
  availability: ConnectorAvailability;
  capabilities: string[];
  setupMessage: string;
};

export type ConnectorRecord = {
  provider: ConnectorProvider;
  connectionState: ConnectorConnectionState;
  accountLabel?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  lastError?: string;
  updatedAt: string;
};

export type ConnectorView = ConnectorDefinition & {
  connectionState: ConnectorConnectionState;
  accountLabel?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  lastError?: string;
  updatedAt?: string;
};

export type ConnectorsResponse = {
  connectors: ConnectorView[];
};

export type ConnectorUpdateInput = Partial<Pick<ConnectorRecord, "connectionState" | "accountLabel" | "lastSyncAt" | "lastError">>;

export type ConnectorMutationResponse = {
  connector: ConnectorView;
};

export type ConnectorSyncResponse = {
  connector: ConnectorView;
  error: string;
  reason: "not_connected" | "not_available" | "not_implemented";
};
