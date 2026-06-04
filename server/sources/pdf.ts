import type { PageSnapshot } from "../../shared/types";
import { decideContentQuality } from "./contentQuality";
import type { ExtractedContent, SourceAdapter } from "./types";
import { cleanText, faviconFor, normalizeUrl } from "./url";

export const pdfAdapter: SourceAdapter = {
  id: "pdf",
  label: "PDF document",
  canHandle: isPdfUrl,
  async extract({ url, snapshot }) {
    const normalizedUrl = normalizeUrl(url);
    const snapshotText = cleanText(snapshot.selectedText || snapshot.textContent || snapshot.excerpt);
    return buildPdfContent({
      url: normalizedUrl,
      snapshot,
      text: snapshotText
    });
  }
};

type PdfContentInput = {
  url: string;
  snapshot: PageSnapshot;
  text: string;
};

function buildPdfContent(input: PdfContentInput): ExtractedContent {
  const quality = decideContentQuality([
    { source: "pdf_text", text: input.text },
    { source: "browser_snapshot", text: input.snapshot.textContent },
    { source: "metadata", text: input.snapshot.excerpt }
  ]);
  const title = cleanText(input.snapshot.title || filenameTitle(input.url));

  return {
    url: input.url,
    canonicalUrl: input.url,
    title,
    sourceName: new URL(input.url).hostname.replace(/^www\./, ""),
    sourceType: "pdf",
    excerpt: cleanText(quality.readableText || title).slice(0, 420),
    readableText: quality.readableText,
    favicon: input.snapshot.favicon ?? faviconFor(input.url),
    wordCount: quality.wordCount,
    confidence: quality.confidence,
    extractionState: quality.extractionState,
    extractor: quality.extractor,
    sourceMessage: quality.sourceMessage
  };
}

function isPdfUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
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
