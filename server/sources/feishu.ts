import type { SourceAdapter } from "./types";
import { contentHtmlFromSnapshot, contentHtmlFromText } from "./contentHtml";
import { decideContentQuality } from "./contentQuality";
import { pickCoverImage } from "./coverImage";
import { cleanText, faviconFor, isFeishuHost, normalizeUrl } from "./url";

export const feishuAdapter: SourceAdapter = {
  id: "feishu",
  label: "Feishu",
  canHandle(url) {
    return isFeishuHost(new URL(url).hostname.replace(/^www\./, ""));
  },
  async extract({ url, snapshot }) {
    const normalizedUrl = normalizeUrl(url);
    const title = cleanText(snapshot?.title) || inferFeishuTitle(normalizedUrl);
    const selectedText = cleanText(snapshot?.selectedText);
    const snapshotText = cleanText(snapshot?.textContent);
    const quality = decideContentQuality([
      { source: "selected_text", text: selectedText },
      { source: "browser_snapshot", text: snapshotText },
      { source: "metadata", text: snapshot?.excerpt }
    ]);
    const visibleText = quality.readableText;

    if (visibleText.length > 40) {
      return {
        url: normalizedUrl,
        canonicalUrl: normalizeUrl(snapshot?.canonicalUrl ?? normalizedUrl),
        title,
        sourceName: snapshot?.siteName || "Feishu",
        sourceType: "feishu",
        excerpt: visibleText.slice(0, 420),
        readableText: visibleText,
        contentHtml:
          quality.extractor === "browser_selection"
            ? contentHtmlFromText(visibleText)
            : contentHtmlFromSnapshot(snapshot?.html, visibleText),
        coverImage: pickCoverImage(snapshot?.imageCandidates?.map((candidate) => ({ url: candidate, source: "snapshot_image" }))),
        favicon: snapshot?.favicon ?? faviconFor(normalizedUrl),
        wordCount: quality.wordCount,
        confidence: quality.confidence,
        extractionState: quality.extractionState,
        captureMethod: "extension_snapshot",
        extractor: quality.extractor,
        sourceAccess: "browser_snapshot",
        sourceMessage:
          quality.extractionState === "ready"
            ? "Captured visible Feishu content from the browser. Connect Feishu later for exact block structure, permissions, attachments, and full document sync."
            : "Captured limited visible Feishu content from the browser. Connect Feishu later for exact block structure, permissions, attachments, and full document sync."
      };
    }

    return {
      url: normalizedUrl,
      canonicalUrl: normalizedUrl,
      title,
      sourceName: "Feishu",
      sourceType: "feishu",
      excerpt: "",
      readableText: "",
      favicon: faviconFor(normalizedUrl),
      confidence: 0.1,
      extractionState: "needs_connector",
      captureMethod: snapshot ? "extension_snapshot" : "url_fetch",
      sourceAccess: "connector_required",
      requiredConnector: "feishu",
      sourceMessage:
        "Feishu pages usually require the user's login and document permissions. Open the page and save with the extension, or connect a Feishu account for full content import."
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
