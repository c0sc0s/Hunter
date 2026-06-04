import type { SourceAdapter } from "./types";
import { contentHtmlFromSnapshot, contentHtmlFromText } from "./contentHtml";
import { decideContentQuality } from "./contentQuality";
import { selectCoverImage } from "./coverImage";
import { cleanText, faviconFor, isFeishuHost, normalizeUrl } from "./url";

export const feishuAdapter: SourceAdapter = {
  id: "feishu",
  label: "Feishu",
  canHandle(url) {
    const host = safeHost(url);
    return host !== undefined && isFeishuHost(host);
  },
  async extract({ url, snapshot }) {
    const normalizedUrl = normalizeUrl(url);
    const title = cleanText(snapshot.title) || inferFeishuTitle(normalizedUrl);
    const selectedText = cleanText(snapshot.selectedText);
    const snapshotText = cleanText(snapshot.textContent);
    const quality = decideContentQuality([
      { source: "selected_text", text: selectedText },
      { source: "browser_snapshot", text: snapshotText },
      { source: "metadata", text: snapshot.excerpt }
    ]);
    const visibleText = quality.readableText;
    const coverImage = await selectCoverImage({
      url: normalizedUrl,
      html: snapshot.html,
      snapshotCandidates: snapshot.imageCandidates
    });

    return {
      url: normalizedUrl,
      canonicalUrl: normalizeUrl(snapshot.canonicalUrl ?? normalizedUrl),
      title,
      sourceName: snapshot.siteName || "Feishu",
      sourceType: "feishu",
      excerpt: visibleText.slice(0, 420),
      readableText: visibleText,
      contentHtml: visibleText
        ? quality.extractor === "browser_selection"
          ? contentHtmlFromText(visibleText)
          : contentHtmlFromSnapshot(snapshot.html, visibleText)
        : undefined,
      coverImage,
      favicon: snapshot.favicon ?? faviconFor(normalizedUrl),
      wordCount: quality.wordCount,
      confidence: quality.confidence,
      extractionState: quality.extractionState,
      extractor: quality.extractor,
      sourceMessage: quality.sourceMessage
    };
  }
};

function inferFeishuTitle(url: string): string {
  const path = new URL(url).pathname;
  if (path.includes("/docx/")) return "Feishu document";
  if (path.includes("/wiki/")) return "Feishu wiki page";
  if (path.includes("/docs/")) return "Feishu article";
  return "Feishu content";
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
