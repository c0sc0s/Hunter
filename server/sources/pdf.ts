import { extractText, getDocumentProxy, getMeta } from "unpdf";
import type { PageSnapshot } from "../../shared/types";
import { decideContentQuality } from "./contentQuality";
import type { ExtractedContent, SourceAdapter } from "./types";
import { cleanText, faviconFor, normalizeUrl } from "./url";

const fetchTimeoutMs = 15000;
const maxPdfBytes = 25 * 1024 * 1024;

export const pdfAdapter: SourceAdapter = {
  id: "pdf",
  label: "PDF document",
  canHandle: isPdfUrl,
  async extract({ url, snapshot }) {
    const normalizedUrl = normalizeUrl(url);

    try {
      const bytes = await fetchPdfBytes(normalizedUrl);
      const pdf = await getDocumentProxy(bytes);
      const [{ text, totalPages }, meta] = await Promise.all([extractText(pdf, { mergePages: true }), getMeta(pdf, { parseDates: true })]);
      return buildPdfContent({
        url: normalizedUrl,
        snapshot,
        text,
        totalPages,
        meta,
        captureMethod: "url_fetch",
        sourceAccess: "public"
      });
    } catch (error) {
      const snapshotText = cleanText(snapshot?.selectedText || snapshot?.textContent || snapshot?.excerpt);
      if (!snapshotText) throw error;

      return buildPdfContent({
        url: normalizedUrl,
        snapshot,
        text: snapshotText,
        totalPages: undefined,
        meta: undefined,
        captureMethod: "extension_snapshot",
        sourceAccess: "browser_snapshot",
        sourceMessage: "PDF text was captured from the browser because direct PDF extraction failed."
      });
    }
  }
};

type PdfContentInput = {
  url: string;
  snapshot?: PageSnapshot;
  text: string;
  totalPages: number | undefined;
  meta: PdfMeta | undefined;
  captureMethod: ExtractedContent["captureMethod"];
  sourceAccess: ExtractedContent["sourceAccess"];
  sourceMessage?: string;
};

type PdfMeta = Awaited<ReturnType<typeof getMeta>>;

function buildPdfContent(input: PdfContentInput): ExtractedContent {
  const quality = decideContentQuality([
    { source: "pdf_text", text: input.text },
    { source: "browser_snapshot", text: input.snapshot?.textContent },
    { source: "metadata", text: input.snapshot?.excerpt }
  ]);
  const title = cleanText(input.snapshot?.title || asString(input.meta?.info?.Title) || filenameTitle(input.url));
  const author = cleanText(asString(input.meta?.info?.Author));
  const publishedAt = normalizePdfDate(input.meta?.info?.CreationDate);

  return {
    url: input.url,
    canonicalUrl: input.url,
    title,
    sourceName: new URL(input.url).hostname.replace(/^www\./, ""),
    sourceType: "pdf",
    excerpt: cleanText(quality.readableText || title).slice(0, 420),
    readableText: quality.readableText,
    favicon: input.snapshot?.favicon ?? faviconFor(input.url),
    author: author || undefined,
    publishedAt,
    wordCount: quality.wordCount,
    confidence: quality.confidence,
    extractionState: quality.extractionState,
    captureMethod: input.captureMethod,
    extractor: quality.extractor,
    sourceAccess: input.sourceAccess,
    sourceMessage: input.sourceMessage ?? pdfSourceMessage(quality.extractionState, input.totalPages)
  };
}

function isPdfUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/pdf",
        "User-Agent": "Huntter/0.1 (+https://localhost)"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch PDF ${url}: HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxPdfBytes) {
      throw new Error(`PDF is too large to extract safely: ${contentLength} bytes`);
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxPdfBytes) {
      throw new Error(`PDF is too large to extract safely: ${buffer.byteLength} bytes`);
    }

    return new Uint8Array(buffer);
  } finally {
    clearTimeout(timeout);
  }
}

function filenameTitle(url: string): string {
  const path = new URL(url).pathname;
  const filename = decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "PDF document");
  return (
    filename
      .replace(/\.pdf$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || "PDF document"
  );
}

function pdfSourceMessage(state: ExtractedContent["extractionState"], totalPages: number | undefined): string | undefined {
  if (state === "ready") {
    return totalPages ? `Extracted text from ${totalPages} PDF page${totalPages === 1 ? "" : "s"}.` : "Extracted PDF text.";
  }

  return "Only limited PDF text was captured. Scanned or image-heavy PDFs may require OCR in a future adapter.";
}

function normalizePdfDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
