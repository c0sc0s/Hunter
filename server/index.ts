import cors from "cors";
import express from "express";
import { z } from "zod";
import type {
  CaptureEventsResponse,
  ConnectorMutationResponse,
  ConnectorOAuthStartResponse,
  ConnectorProvider,
  ConnectorSyncResponse,
  ConnectorUpdateInput,
  CreateItemInput,
  LibraryItem,
  UpdateItemInput
} from "../shared/types";
import { buildCaptureEvent } from "./captureEvents";
import { toRecognitionInput, toRefreshInput } from "./captureInput";
import { completeFeishuOAuth, ConnectorConfigError, startFeishuOAuth } from "./connectorAuth/feishuOAuth";
import { OAuthStateError } from "./connectorAuth/oauthState";
import { buildConnectorRecord, buildDisconnectedConnectorRecord, getConnectorDefinition, isConnectorProvider } from "./connectors";
import { listSourceAdapters } from "./extract";
import { buildItem, buildQueuedItem } from "./itemBuilder";
import { libraryRepository } from "./repository";
import { drainRecognitionJobs, enqueueRecognition } from "./recognitionJobs";

export const app = express();
const port = Number(process.env.PORT ?? 4317);

const sourceTypeSchema = z.enum(["article", "post", "tweet", "feishu", "video", "pdf", "other"]);
const statusSchema = z.enum(["unread", "reading", "read", "archived"]);
const connectorStateSchema = z.enum(["not_connected", "connected", "error", "disabled"]);

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

const connectorUpdateSchema = z
  .object({
    connectionState: connectorStateSchema.optional(),
    accountLabel: z.string().trim().min(1).max(120).optional(),
    lastSyncAt: z.string().datetime().optional(),
    lastError: z.string().trim().min(1).max(300).optional()
  })
  .strict();

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
    const provider = parseConnectorProvider(request.params.provider, response);
    if (!provider) return;

    response.json(await getConnectorView(provider));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/connectors/:provider", async (request, response, next) => {
  try {
    const provider = parseConnectorProvider(request.params.provider, response);
    if (!provider) return;

    const input = connectorUpdateSchema.parse(request.body) satisfies ConnectorUpdateInput;
    const previous = await getConnectorView(provider);
    const record = buildConnectorRecord(provider, input, previous);
    await libraryRepository.upsertConnector(record);

    const body: ConnectorMutationResponse = { connector: await getConnectorView(provider) };
    response.json(body);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/connectors/:provider", async (request, response, next) => {
  try {
    const provider = parseConnectorProvider(request.params.provider, response);
    if (!provider) return;

    await libraryRepository.deleteConnectorCredential(provider);
    await libraryRepository.upsertConnector(buildDisconnectedConnectorRecord(provider));
    const body: ConnectorMutationResponse = { connector: await getConnectorView(provider) };
    response.json(body);
  } catch (error) {
    next(error);
  }
});

app.post("/api/connectors/:provider/oauth/start", async (request, response, next) => {
  try {
    const provider = parseConnectorProvider(request.params.provider, response);
    if (!provider) return;

    if (provider !== "feishu") {
      response.status(501).json({ error: `${getConnectorDefinition(provider).label} OAuth is not implemented yet.` });
      return;
    }

    const body: ConnectorOAuthStartResponse = startFeishuOAuth(requestOrigin(request));
    response.json(body);
  } catch (error) {
    if (error instanceof ConnectorConfigError) {
      response.status(409).json({ error: error.message, missing: error.missing });
      return;
    }
    if (error instanceof OAuthStateError) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.get("/api/connectors/:provider/oauth/callback", async (request, response, next) => {
  try {
    const provider = parseConnectorProvider(request.params.provider, response);
    if (!provider) return;

    if (provider !== "feishu") {
      response.status(501).json({ error: `${getConnectorDefinition(provider).label} OAuth is not implemented yet.` });
      return;
    }

    const code = z.string().min(1).parse(request.query.code);
    const state = z.string().min(1).parse(request.query.state);
    const body = await completeFeishuOAuth(code, state, libraryRepository);
    response.json(body);
  } catch (error) {
    if (error instanceof ConnectorConfigError) {
      response.status(409).json({ error: error.message, missing: error.missing });
      return;
    }
    if (error instanceof OAuthStateError) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.post("/api/connectors/:provider/sync", async (request, response, next) => {
  try {
    const provider = parseConnectorProvider(request.params.provider, response);
    if (!provider) return;

    const connector = await getConnectorView(provider);
    if (connector.connectionState !== "connected") {
      const body: ConnectorSyncResponse = {
        connector,
        error: `${connector.label} is not connected.`,
        reason: "not_connected"
      };
      response.status(409).json(body);
      return;
    }

    if (connector.availability !== "available") {
      const body: ConnectorSyncResponse = {
        connector,
        error: `${connector.label} sync is not available yet. ${connector.setupMessage}`,
        reason: "not_available"
      };
      response.status(501).json(body);
      return;
    }

    const definition = getConnectorDefinition(provider);
    const body: ConnectorSyncResponse = {
      connector,
      error: `${definition.label} sync handler is not implemented.`,
      reason: "not_implemented"
    };
    response.status(501).json(body);
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

function parseConnectorProvider(value: string, response: express.Response): ConnectorProvider | undefined {
  if (isConnectorProvider(value)) return value;
  response.status(404).json({ error: "Connector not found" });
  return undefined;
}

async function getConnectorView(provider: ConnectorProvider) {
  const connectors = await libraryRepository.listConnectors();
  const connector = connectors.find((candidate) => candidate.provider === provider);
  if (!connector) {
    throw new Error(`Connector definition missing for ${provider}`);
  }
  return connector;
}

function requestOrigin(request: express.Request): string {
  return `${request.protocol}://${request.get("host")}`;
}

void drainRecognitionJobs();
