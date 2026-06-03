import cors from "cors";
import express from "express";
import { z } from "zod";
import type { CaptureEventsResponse, CreateItemInput, LibraryItem, UpdateItemInput } from "../shared/types";
import { buildCaptureEvent } from "./captureEvents";
import { toRecognitionInput, toRefreshInput } from "./captureInput";
import { isConnectorProvider } from "./connectors";
import { listSourceAdapters } from "./extract";
import { buildItem, buildQueuedItem } from "./itemBuilder";
import { libraryRepository } from "./repository";
import { drainRecognitionJobs, enqueueRecognition } from "./recognitionJobs";

export const app = express();
const port = Number(process.env.PORT ?? 4317);

const sourceTypeSchema = z.enum(["article", "post", "tweet", "feishu", "video", "pdf", "other"]);
const statusSchema = z.enum(["unread", "reading", "read", "archived"]);

const createItemSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  sourceType: sourceTypeSchema.optional(),
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
  snapshot: z
    .object({
      title: z.string().optional(),
      url: z.string().url(),
      canonicalUrl: z.string().url().optional(),
      html: z.string().optional(),
      textContent: z.string().optional(),
      selectedText: z.string().optional(),
      excerpt: z.string().optional(),
      siteName: z.string().optional(),
      favicon: z.string().optional(),
      imageCandidates: z.array(z.string()).optional(),
      publishedAt: z.string().optional()
    })
    .optional()
});

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
  limit: z.coerce.number().int().min(1).max(120).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const captureEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional()
});

app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "huntter-api" });
});

app.get("/api/sources", (_request, response) => {
  response.json({ sources: listSourceAdapters() });
});

app.get("/api/connectors", async (_request, response, next) => {
  try {
    response.json({ connectors: await libraryRepository.listConnectors() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/connectors/:provider", async (request, response, next) => {
  try {
    if (!isConnectorProvider(request.params.provider)) {
      response.status(404).json({ error: "Connector not found" });
      return;
    }

    const connectors = await libraryRepository.listConnectors();
    response.json(connectors.find((connector) => connector.provider === request.params.provider));
  } catch (error) {
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

    const enriched = await buildItem(input, item.id, item.savedAt);
    const updated = await libraryRepository.replaceRecognitionResult(item.id, enriched, input);
    if (!updated) {
      response.status(404).json({ error: "Item not found" });
      return;
    }

    await libraryRepository.recordCaptureEvent(buildCaptureEvent({ input, item: updated }));
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
  response.status(500).json({ error: error instanceof Error ? error.message : "Unknown server error" });
});

if (process.env.HUNTTER_DISABLE_LISTEN !== "true") {
  app.listen(port, "127.0.0.1", () => {
    console.log(`Huntter API listening on http://127.0.0.1:${port}`);
  });
}

async function createOrMergeQueuedItem(input: CreateItemInput): Promise<LibraryItem> {
  const recognitionInput = toRecognitionInput(input);
  const item = buildQueuedItem(recognitionInput);
  const queued = await libraryRepository.upsertQueued(item, recognitionInput);
  const queuedEvent = buildCaptureEvent({ input: recognitionInput, item: queued });
  await enqueueRecognition(recognitionInput, queued.id, queued.savedAt);
  await libraryRepository.recordCaptureEvent(queuedEvent);
  return queued;
}

function toPublicItem(item: LibraryItem): Omit<LibraryItem, "captureInput"> {
  const { captureInput: _captureInput, ...publicItem } = item;
  return publicItem;
}

void drainRecognitionJobs();
