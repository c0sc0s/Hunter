import type {
  AgentClassificationResult,
  AgentContentCategorySummary,
  CaptureEvent,
  CreateItemInput,
  LibraryItem,
  LibraryQuery,
  LibraryResponse,
  UpdateItemInput
} from "../../shared/types";

export type RecognitionJobStatus = "queued" | "running" | "failed";

export type RecognitionJob = {
  id: string;
  itemId: string;
  input: CreateItemInput;
  savedAt: string;
  status: RecognitionJobStatus;
  attemptCount: number;
  runAfter: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type LibraryRepository = {
  list(query?: LibraryQuery): Promise<LibraryResponse>;
  findById(id: string): Promise<LibraryItem | undefined>;
  listAgentCategories(): Promise<AgentContentCategorySummary[]>;
  listAgentClassificationCandidates(limit: number): Promise<LibraryItem[]>;
  upsertQueued(item: LibraryItem, input: CreateItemInput): Promise<LibraryItem>;
  patch(id: string, input: UpdateItemInput): Promise<LibraryItem | undefined>;
  setAgentClassification(id: string, result: AgentClassificationResult): Promise<LibraryItem | undefined>;
  delete(id: string): Promise<boolean>;
  replaceRecognitionResult(
    id: string,
    enriched: LibraryItem,
    input: Pick<CreateItemInput, "note" | "tags">
  ): Promise<LibraryItem | undefined>;
  markRecognitionFailed(id: string, error: unknown): Promise<void>;
  enqueueRecognitionJob(job: RecognitionJob): Promise<RecognitionJob>;
  claimRecognitionJobs(limit: number): Promise<RecognitionJob[]>;
  completeRecognitionJob(id: string): Promise<void>;
  failRecognitionJob(id: string, error: unknown, runAfter: string): Promise<void>;
  recordCaptureEvent(event: CaptureEvent): Promise<CaptureEvent>;
  listCaptureEvents(limit?: number): Promise<CaptureEvent[]>;
};
