import { mkdirSync } from "node:fs";
import cors from "cors";
import express from "express";
import { z } from "zod";
import type {
  AgentIncrementalClassificationResponse,
  AgentLlmProvider,
  CaptureEventsResponse,
  CreateItemInput,
  LibraryItem,
  PublicLibraryItem,
  UpdateItemInput
} from "../shared/types";
import { mergeAgentContentCategory } from "./agents/contentCategories";
import { classifyLibraryItem } from "./agents/contentClassifier";
import { getLocalLlmStatus, getResolvedLocalLlmSettings, LocalLlmError } from "./agents/localLlm";
import { readAgentLlmSettings, toPublicAgentLlmSettings, updateAgentLlmSettings } from "./agents/llmSettings";
import { buildCaptureEvent } from "./captureEvents";
import { toRecognitionInput, toRefreshInput } from "./captureInput";
import { resolveDataDir } from "./dataDir";
import { acquireDataDirLock, DataDirInUseError } from "./dataDirLock";
import { listSourceAdapters } from "./extract";
import { buildItem, buildQueuedItem } from "./itemBuilder";
import { bindAndAnnounce } from "./listen";
import { libraryRepository } from "./repository";
import { drainRecognitionJobs, enqueueRecognition } from "./recognitionJobs";

export const app = express();

const apiStartedAt = new Date().toISOString();
const apiOwner = process.env.HUNTER_API_OWNER?.trim() || "standalone";

const sourceTypeSchema = z.enum(["article", "post", "tweet", "feishu", "video", "pdf", "other"]);
const statusSchema = z.enum(["unread", "reading", "read", "archived"]);
const agentLlmProviderSchema = z.enum(["ollama", "deepseek", "openai-compatible"]) satisfies z.ZodType<AgentLlmProvider>;
const imageCandidateSchema = z.union([
  z.string(),
  z.object({
    url: z.string(),
    score: z.number().optional(),
    source: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    alt: z.string().optional(),
    context: z.string().optional(),
    inContentRoot: z.boolean().optional(),
    order: z.number().optional()
  })
]);

const contentCandidateSchema = z.object({
  kind: z.enum(["focused_root", "content_root", "body"]),
  text: z.string().optional(),
  html: z.string().optional(),
  selector: z.string().optional(),
  score: z.number().optional()
});

const snapshotSchema = z.object({
  title: z.string().optional(),
  url: z.string().url(),
  canonicalUrl: z.string().url().optional(),
  html: z.string().optional(),
  textContent: z.string().optional(),
  selectedText: z.string().optional(),
  excerpt: z.string().optional(),
  siteName: z.string().optional(),
  favicon: z.string().optional(),
  imageCandidates: z.array(imageCandidateSchema).optional(),
  contentCandidates: z.array(contentCandidateSchema).optional(),
  publishedAt: z.string().optional()
});

const createItemSchema = z
  .object({
    url: z.string().url(),
    title: z.string().optional(),
    sourceType: sourceTypeSchema.optional(),
    note: z.string().optional(),
    tags: z.array(z.string()).optional(),
    snapshot: snapshotSchema
  })
  // Normalize at the boundary so handlers consume already-truncated capture
  // input; downstream code does not need to know about size limits.
  .transform((input): CreateItemInput => toRecognitionInput(input));

const updateItemSchema = z.object({
  status: statusSchema.optional(),
  favorite: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  note: z.string().optional()
});

const listItemsQuerySchema = z.object({
  q: z.string().optional(),
  filter: z.enum(["all", "unread", "reading", "read", "archived", "favorite"]).optional(),
  sourceType: sourceTypeSchema.optional(),
  agentCategoryId: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(120).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const captureEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const agentLlmSettingsSchema = z.object({
  provider: agentLlmProviderSchema.optional(),
  baseUrl: z.string().trim().url().max(500).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  apiKey: z.string().trim().max(400).optional(),
  clearApiKey: z.boolean().optional()
});

const classifyMissingSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(12).optional()
  })
  .optional();

app.use(cors());
// Capture payloads are truncated to ~350KB by captureInputLimits; 1MB leaves
// generous headroom for transport overhead without exposing the API to large
// snapshots from non-extension clients.
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "hunter-api",
    owner: apiOwner,
    startedAt: apiStartedAt,
    pid: process.pid
  });
});

app.get("/api/sources", (_request, response) => {
  response.json({ sources: listSourceAdapters() });
});

app.get("/api/agent/local-llm", async (_request, response, next) => {
  try {
    response.json(await getLocalLlmStatus());
  } catch (error) {
    next(error);
  }
});

app.get("/api/agent/settings", async (_request, response, next) => {
  try {
    const settings = await readAgentLlmSettings();
    response.json(toPublicAgentLlmSettings(settings, getResolvedLocalLlmSettings()));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/agent/settings", async (request, response, next) => {
  try {
    const input = agentLlmSettingsSchema.parse(request.body);
    const settings = await updateAgentLlmSettings(input);
    response.json(toPublicAgentLlmSettings(settings, getResolvedLocalLlmSettings()));
  } catch (error) {
    next(error);
  }
});

app.post("/api/agent/items/:id/classify", async (request, response, next) => {
  try {
    const item = await libraryRepository.findById(request.params.id);
    if (!item) {
      response.status(404).json({ error: "Item not found" });
      return;
    }

    const classification = await classifyLibraryItem(item, { existingCategories: await libraryRepository.listAgentCategories() });
    const updated = await libraryRepository.setAgentClassification(item.id, classification);
    if (!updated) {
      response.status(404).json({ error: "Item not found" });
      return;
    }

    response.json(toPublicItem(updated));
  } catch (error) {
    if (sendLocalLlmError(error, response)) return;
    next(error);
  }
});

app.post("/api/agent/items/classify-missing", async (request, response, next) => {
  try {
    const input = classifyMissingSchema.parse(request.body);
    const limit = input?.limit ?? 6;
    const candidates = await libraryRepository.listAgentClassificationCandidates(limit);
    let categories = await libraryRepository.listAgentCategories();
    const items: PublicLibraryItem[] = [];

    for (const item of candidates) {
      const classification = await classifyLibraryItem(item, { existingCategories: categories });
      const updated = await libraryRepository.setAgentClassification(item.id, classification);
      if (!updated) continue;

      categories = mergeAgentContentCategory(categories, classification.classification.contentCategory);
      items.push(toPublicItem(updated));
    }

    const body: AgentIncrementalClassificationResponse = {
      attempted: candidates.length,
      classified: items.length,
      skipped: 0,
      items,
      categories
    };
    response.json(body);
  } catch (error) {
    if (sendLocalLlmError(error, response)) return;
    next(error);
  }
});

app.get("/api/capture-events", async (request, response, next) => {
  try {
    const query = captureEventsQuerySchema.parse(request.query);
    const body: CaptureEventsResponse = {
      events: await libraryRepository.listCaptureEvents(query.limit)
    };
    response.json(body);
  } catch (error) {
    next(error);
  }
});

app.get("/api/items", async (request, response, next) => {
  try {
    const query = listItemsQuerySchema.parse(request.query);
    const library = await libraryRepository.list(query);
    response.json({
      ...library,
      items: library.items.map(toPublicItem)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items", async (request, response, next) => {
  try {
    const input = createItemSchema.parse(request.body) satisfies CreateItemInput;
    const item = await createOrMergeQueuedItem(input);
    response.status(201).json(toPublicItem(item));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/items/:id", async (request, response, next) => {
  try {
    const input = updateItemSchema.parse(request.body) satisfies UpdateItemInput;
    const updated = await libraryRepository.patch(request.params.id, input);
    if (!updated) {
      response.status(404).json({ error: "Item not found" });
      return;
    }

    response.json(toPublicItem(updated));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/items/:id", async (request, response, next) => {
  try {
    const deleted = await libraryRepository.delete(request.params.id);
    if (!deleted) {
      response.status(404).json({ error: "Item not found" });
      return;
    }

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/enrich", async (request, response, next) => {
  try {
    const item = await libraryRepository.findById(request.params.id);
    if (!item) {
      response.status(404).json({ error: "Item not found" });
      return;
    }

    const input = toRefreshInput(item);

    let updated: LibraryItem | undefined;
    let recognitionError: unknown;
    try {
      const enriched = await buildItem(input, item.id, item.savedAt);
      updated = await libraryRepository.replaceRecognitionResult(item.id, enriched, input);
    } catch (error) {
      recognitionError = error;
      await libraryRepository.markRecognitionFailed(item.id, error);
      updated = await libraryRepository.findById(item.id);
    }

    if (!updated) {
      response.status(404).json({ error: "Item not found" });
      return;
    }

    await libraryRepository.recordCaptureEvent(buildCaptureEvent({ input, item: updated, error: recognitionError }));
    response.json(toPublicItem(updated));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: "Invalid request", issues: error.issues });
    return;
  }

  console.error(error);
  // Do not leak raw error messages to clients; log full context server-side and
  // return a stable error body.
  response.status(500).json({ error: "Internal server error" });
});

if (process.env.HUNTER_DISABLE_LISTEN !== "true") {
  // Acquire the data-directory lock BEFORE binding a port. If another sidecar
  // already owns the data dir (orphan from a previous run, or a duplicate
  // launch), fail fast instead of corrupting the store via concurrent writes.
  try {
    const dataDir = resolveDataDir();
    mkdirSync(dataDir, { recursive: true });
    acquireDataDirLock(dataDir);
  } catch (err) {
    if (err instanceof DataDirInUseError) {
      process.stderr.write(`HUNTER_DATA_DIR_LOCKED holder=${err.holderPid} path=${err.lockPath}\n`);
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }

  void bindAndAnnounce(app).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

async function createOrMergeQueuedItem(input: CreateItemInput): Promise<LibraryItem> {
  const item = buildQueuedItem(input);
  const queued = await libraryRepository.upsertQueued(item, input);
  const queuedEvent = buildCaptureEvent({ input, item: queued });
  await enqueueRecognition(input, queued.id, queued.savedAt);
  await libraryRepository.recordCaptureEvent(queuedEvent);
  return queued;
}

function toPublicItem(item: LibraryItem): PublicLibraryItem {
  const { captureInput: _captureInput, ...publicItem } = item;
  return publicItem;
}

function sendLocalLlmError(error: unknown, response: express.Response): boolean {
  if (!(error instanceof LocalLlmError)) return false;

  const invalidModelResponse = ["invalid_response", "invalid_json", "schema_mismatch"].includes(error.code);
  response.status(invalidModelResponse ? 502 : 503).json({
    error: invalidModelResponse ? "Local LLM returned an invalid response" : "Local LLM unavailable",
    code: error.code
  });
  return true;
}

void drainRecognitionJobs();
