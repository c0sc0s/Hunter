import crypto from "node:crypto";
import type { ConnectorSyncResponse, LibraryItem } from "../../shared/types";
import { buildCaptureEvent } from "../captureEvents";
import { getFreshFeishuAccessToken } from "../connectorAuth/feishuOAuth";
import { enrichContent } from "../enrich";
import { buildConnectorRecord } from "../connectors";
import { buildContentHash, contentRecognitionVersion } from "../recognitionMetadata";
import { createRecognitionTimer } from "../recognitionTiming";
import type { LibraryRepository } from "../repositories/types";
import { contentHtmlFromText } from "../sources/contentHtml";
import { decideContentQuality } from "../sources/contentQuality";
import type { ExtractedContent } from "../sources/types";
import { cleanText, faviconFor, normalizeUrl } from "../sources/url";
import { normalizeTags } from "../tags";

const provider = "feishu";
const rawContentUrlBase = "https://open.feishu.cn/open-apis/docx/v1/documents";
const wikiNodeUrl = "https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node";
const syncPageSize = 120;

type FeishuDocumentTarget = {
  documentId: string;
  title?: string;
  source: "docx_url" | "wiki_node";
};

type FeishuRawContentResponse = {
  code?: number;
  msg?: string;
  data?: {
    content?: string;
  };
};

type FeishuWikiNodeResponse = {
  code?: number;
  msg?: string;
  data?: {
    node?: {
      obj_token?: string;
      obj_type?: string;
      title?: string;
    };
  };
};

type SyncCounters = {
  imported: number;
  skipped: number;
  failed: number;
};

export async function syncFeishuConnector(repository: LibraryRepository): Promise<ConnectorSyncResponse> {
  const connector = (await repository.listConnectors()).find((candidate) => candidate.provider === provider);
  if (!connector || connector.connectionState !== "connected") {
    return {
      connector: connector ?? (await findRequiredConnectorView(repository)),
      error: "Feishu / Lark is not connected.",
      reason: "not_connected"
    };
  }

  const credential = await repository.getConnectorCredential(provider);
  if (!credential) {
    return {
      connector,
      error: "Feishu / Lark is connected but no encrypted credential was found.",
      reason: "missing_credentials"
    };
  }

  const accessToken = await getFreshFeishuAccessToken(repository, credential);
  const counters: SyncCounters = { imported: 0, skipped: 0, failed: 0 };
  const failures: string[] = [];

  for await (const item of listFeishuConnectorItems(repository)) {
    try {
      const target = await resolveFeishuDocumentTarget(item.url, accessToken);
      if (!target) {
        counters.skipped += 1;
        continue;
      }

      const imported = await importFeishuRawContentItem({ item, target, accessToken });
      const updated = await repository.replaceRecognitionResult(item.id, imported, { note: item.note, tags: item.tags });
      if (!updated) {
        counters.failed += 1;
        failures.push(`Item ${item.id} disappeared during Feishu sync`);
        continue;
      }

      await repository.recordCaptureEvent(buildCaptureEvent({ input: item.captureInput ?? { url: item.url }, item: updated }));
      counters.imported += 1;
    } catch (error) {
      counters.failed += 1;
      failures.push(error instanceof Error ? error.message : "Unknown Feishu import error");
      await repository.recordCaptureEvent(buildFailedConnectorEvent(item, error));
    }
  }

  const lastError = failures[0];
  const now = new Date().toISOString();
  await repository.upsertConnector(
    buildConnectorRecord(
      provider,
      {
        connectionState: "connected",
        accountLabel: connector.accountLabel,
        lastSyncAt: now,
        lastError
      },
      connector
    )
  );

  const refreshedConnector = (await repository.listConnectors()).find((candidate) => candidate.provider === provider) ?? connector;
  return {
    connector: refreshedConnector,
    ...counters,
    message: `Feishu sync imported ${counters.imported}, skipped ${counters.skipped}, failed ${counters.failed}.`,
    error: lastError,
    reason: counters.failed ? "sync_failed" : undefined
  };
}

export function extractDirectDocxDocumentId(url: string): string | undefined {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const docxIndex = segments.findIndex((segment) => segment === "docx");
  const token = docxIndex >= 0 ? segments[docxIndex + 1] : undefined;
  if (!token) return undefined;
  return /^[A-Za-z0-9]{20,64}$/.test(token) ? token : undefined;
}

export function extractWikiNodeToken(url: string): string | undefined {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const wikiIndex = segments.findIndex((segment) => segment === "wiki");
  const token = wikiIndex >= 0 ? segments[wikiIndex + 1] : undefined;
  if (!token) return undefined;
  return /^[A-Za-z0-9]{8,128}$/.test(token) ? token : undefined;
}

async function resolveFeishuDocumentTarget(url: string, accessToken: string): Promise<FeishuDocumentTarget | undefined> {
  const directDocumentId = extractDirectDocxDocumentId(url);
  if (directDocumentId) {
    return { documentId: directDocumentId, source: "docx_url" };
  }

  const wikiToken = extractWikiNodeToken(url);
  if (!wikiToken) return undefined;

  const node = await fetchWikiNode(wikiToken, accessToken);
  if (node.objType !== "docx") return undefined;
  return {
    documentId: node.objToken,
    title: node.title,
    source: "wiki_node"
  };
}

async function importFeishuRawContentItem({
  item,
  target,
  accessToken
}: {
  item: LibraryItem;
  target: FeishuDocumentTarget;
  accessToken: string;
}): Promise<LibraryItem> {
  const timer = createRecognitionTimer();
  const extracted = await timer.measure("sourceAdapterMs", async () => {
    const rawText = await fetchRawContent(target.documentId, accessToken);
    return buildExtractedContent(item, target, rawText);
  });
  const enrichment = await timer.measure("contentSignalsMs", () => enrichContent(extracted));
  const now = new Date().toISOString();
  const recognitionTiming = timer.snapshot();

  const imported: LibraryItem = {
    id: item.id,
    url: extracted.url,
    canonicalUrl: extracted.canonicalUrl,
    title: extracted.title,
    sourceName: extracted.sourceName,
    sourceType: extracted.sourceType,
    status: item.status,
    favorite: item.favorite,
    tags: normalizeTags([...(item.tags ?? []), ...enrichment.tags]),
    note: item.note,
    summary: enrichment.summary,
    excerpt: extracted.excerpt,
    readableText: extracted.readableText,
    contentHtml: extracted.contentHtml,
    coverImage: extracted.coverImage,
    favicon: extracted.favicon,
    author: extracted.author,
    publishedAt: extracted.publishedAt,
    language: extracted.language,
    wordCount: extracted.wordCount,
    savedAt: item.savedAt,
    updatedAt: now,
    readingMinutes: enrichment.readingMinutes,
    confidence: extracted.confidence,
    enrichmentState: extracted.extractionState,
    enrichmentError: undefined,
    captureMethod: extracted.captureMethod,
    extractor: extracted.extractor,
    sourceAccess: extracted.sourceAccess,
    sourceMessage: extracted.sourceMessage,
    requiredConnector: undefined,
    recognitionVersion: contentRecognitionVersion,
    recognizedAt: now,
    recognitionDurationMs: recognitionTiming.totalMs,
    recognitionTiming,
    captureInput: item.captureInput
  };

  return {
    ...imported,
    contentHash: buildContentHash(imported)
  };
}

async function fetchRawContent(documentId: string, accessToken: string): Promise<string> {
  const response = await fetch(`${rawContentUrlBase}/${documentId}/raw_content?lang=0`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8"
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Feishu raw content request failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  }

  const payload = JSON.parse(text) as FeishuRawContentResponse;
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(`Feishu raw content request failed: ${payload.msg ?? `code ${payload.code}`}`);
  }

  const content = cleanText(payload.data?.content);
  if (!content) {
    throw new Error("Feishu raw content response did not include readable content");
  }
  return content;
}

async function fetchWikiNode(wikiToken: string, accessToken: string): Promise<{ objToken: string; objType: string; title?: string }> {
  const url = new URL(wikiNodeUrl);
  url.searchParams.set("token", wikiToken);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8"
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Feishu wiki node request failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  }

  const payload = JSON.parse(text) as FeishuWikiNodeResponse;
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(`Feishu wiki node request failed: ${payload.msg ?? `code ${payload.code}`}`);
  }

  const objToken = cleanText(payload.data?.node?.obj_token);
  const objType = cleanText(payload.data?.node?.obj_type);
  if (!objToken || !objType) {
    throw new Error("Feishu wiki node response did not include obj_token and obj_type");
  }

  return {
    objToken,
    objType,
    title: cleanText(payload.data?.node?.title) || undefined
  };
}

function buildExtractedContent(item: LibraryItem, target: FeishuDocumentTarget, rawText: string): ExtractedContent {
  const normalizedUrl = normalizeUrl(item.url);
  const quality = decideContentQuality([{ source: "connector", text: rawText }]);
  const readableText = quality.readableText || rawText;
  const title = target.title ?? inferTitle(readableText, item.title);
  const sourceLabel = target.source === "wiki_node" ? "resolved Feishu wiki document" : "Feishu document";

  return {
    url: normalizedUrl,
    canonicalUrl: normalizedUrl,
    title,
    sourceName: "Feishu",
    sourceType: "feishu",
    excerpt: readableText.slice(0, 420),
    readableText,
    contentHtml: contentHtmlFromText(readableText),
    favicon: item.favicon ?? faviconFor(normalizedUrl),
    wordCount: quality.wordCount,
    confidence: Math.max(quality.confidence, 0.78),
    extractionState: quality.extractionState === "ready" ? "ready" : "partial",
    captureMethod: "connector",
    extractor: "feishu_raw_content",
    sourceAccess: "requires_auth",
    sourceMessage: `Imported ${sourceLabel} ${target.documentId} through the authorized connector.`
  };
}

async function* listFeishuConnectorItems(repository: LibraryRepository): AsyncGenerator<LibraryItem> {
  let offset = 0;
  while (true) {
    const page = await repository.list({ sourceType: "feishu", limit: syncPageSize, offset });
    for (const item of page.items) {
      if (item.enrichmentState === "needs_connector" && item.requiredConnector === provider) {
        yield item;
      }
    }
    if (!page.page.hasMore) return;
    offset += page.items.length;
  }
}

function inferTitle(readableText: string, fallback: string): string {
  const firstLine = readableText
    .split("\n")
    .map((line) => cleanText(line))
    .find(Boolean);
  return firstLine || fallback;
}

function buildFailedConnectorEvent(item: LibraryItem, error: unknown) {
  return {
    id: crypto.randomUUID(),
    itemId: item.id,
    sourceUrl: item.url,
    canonicalUrl: item.canonicalUrl,
    sourceType: item.sourceType,
    captureMethod: "connector" as const,
    snapshotBytes: 0,
    resultState: "failed" as const,
    recognitionVersion: item.recognitionVersion,
    error: error instanceof Error ? error.message : "Unknown Feishu import error",
    createdAt: new Date().toISOString()
  };
}

async function findRequiredConnectorView(repository: LibraryRepository) {
  const connector = (await repository.listConnectors()).find((candidate) => candidate.provider === provider);
  if (!connector) {
    throw new Error("Feishu connector definition is missing");
  }
  return connector;
}
