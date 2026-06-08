import { Readability } from "@mozilla/readability";
import { Defuddle } from "defuddle/node";
import { JSDOM } from "jsdom";
import type { PageSnapshot, PageSnapshotContentCandidate } from "../../shared/types";
import { contentHtmlFromSnapshot, contentHtmlFromText, sanitizeContentHtml } from "./contentHtml";
import type { SourceType } from "../../shared/types";
import { detectContentForm, type ContentForm } from "./contentForm";
import { decideContentQuality, hasReadySelectedText, shouldRunReadabilityFallback } from "./contentQuality";
import { selectCoverImage } from "./coverImage";
import { extractJsonLdMetadata } from "./jsonLd";
import type { SourceAdapter } from "./types";
import { absolutize, cleanText, detectSourceType, faviconFor, normalizeUrl } from "./url";

export const genericWebAdapter: SourceAdapter = {
  id: "generic-web",
  label: "Generic web page",
  canHandle: () => true,
  async extract({ url, snapshot }) {
    const normalizedUrl = normalizeUrl(url);
    const browserSnapshotCandidate = pickBrowserSnapshotCandidate(snapshot);
    const html = snapshot.html ?? browserSnapshotCandidate.html ?? "";
    const dom = new JSDOM(html, { url: normalizedUrl });
    const document = dom.window.document;
    const contentForm = detectContentForm(document);
    const metadata = extractMetadata(document, normalizedUrl, snapshot, contentForm.form);
    const snapshotText = browserSnapshotCandidate.text;
    const selectedText = cleanText(snapshot.selectedText);
    const parserHtml = browserSnapshotCandidate.html ?? html;
    const parserDocument = hasReadySelectedText(selectedText)
      ? undefined
      : stripStructuralNoise(new JSDOM(parserHtml, { url: normalizedUrl }).window.document.cloneNode(true) as Document);
    const defuddled = parserDocument ? await parseWithDefuddle(parserDocument, normalizedUrl) : undefined;
    const defuddledText = htmlToText(defuddled?.content, normalizedUrl);
    const article =
      parserDocument && shouldRunReadabilityFallback(selectedText, defuddledText)
        ? new Readability(parserDocument.cloneNode(true) as Document, { charThreshold: 320 }).parse()
        : undefined;
    const readabilityText = cleanText(asOptionalString(article?.textContent));
    const quality = decideContentQuality([
      { source: "selected_text", text: selectedText },
      { source: "defuddle", text: defuddledText },
      { source: "readability", text: readabilityText },
      { source: "browser_snapshot", text: snapshotText },
      { source: "metadata", text: metadata.description }
    ]);
    const title =
      firstText(metadata.title, defuddled?.title, article?.title, snapshot.title, metadata.documentTitle) ??
      new URL(normalizedUrl).hostname;
    const sourceName =
      firstText(snapshot.siteName, defuddled?.site, article?.siteName, metadata.siteName) ?? new URL(normalizedUrl).hostname;
    // For video/audio pages we prefer the structured uploader description
    // (VideoObject/AudioObject.description) over snapshot.excerpt: on hosts
    // like B站 that ship no meta description, snapshot.excerpt falls back to
    // raw body text — usually unrelated to the video itself.
    const excerpt = cleanText(
      selectedText ||
        metadata.formDescription ||
        snapshot.excerpt ||
        defuddled?.description ||
        article?.excerpt ||
        metadata.description ||
        quality.readableText
    ).slice(0, 420);
    const hasContent = Boolean(quality.readableText || excerpt);
    const coverImage = await selectCoverImage({
      url: normalizedUrl,
      html,
      snapshotCandidates: snapshot.imageCandidates,
      preferred: metadata.formThumbnailUrl
    });
    const urlSourceType = detectSourceType(normalizedUrl);
    const sourceType = resolveSourceType(urlSourceType, contentForm.form);

    return {
      url: normalizedUrl,
      canonicalUrl: normalizeUrl(snapshot.canonicalUrl ?? metadata.canonicalUrl ?? normalizedUrl),
      title,
      sourceName,
      sourceType,
      excerpt,
      readableText: quality.readableText,
      contentHtml: pickContentHtml({
        parserHtml: defuddled?.content ?? article?.content,
        snapshotHtml: browserSnapshotCandidate.html ?? (browserSnapshotCandidate.kind === "body" ? undefined : snapshot.html),
        extractor: quality.extractor,
        readableText: quality.readableText
      }),
      coverImage,
      favicon: snapshot.favicon ?? absolutize(defuddled?.favicon, normalizedUrl) ?? metadata.favicon ?? faviconFor(normalizedUrl),
      author: firstText(metadata.formAuthor, defuddled?.author, article?.byline, metadata.author),
      publishedAt: firstText(
        metadata.formUploadDate,
        snapshot.publishedAt,
        defuddled?.published,
        article?.publishedTime,
        metadata.publishedAt
      ),
      language: firstText(defuddled?.language, article?.lang),
      wordCount: quality.candidateSource === "defuddle" ? (defuddled?.wordCount ?? quality.wordCount) : quality.wordCount,
      confidence: quality.confidence,
      extractionState: quality.extractionState,
      extractor: quality.extractor,
      sourceMessage: resolveSourceMessage(quality.sourceMessage, hasContent)
    };
  }
};

type BrowserSnapshotCandidate = {
  kind: PageSnapshotContentCandidate["kind"] | "legacy";
  text: string;
  html?: string;
  selector?: string;
  score?: number;
  order: number;
};

function pickBrowserSnapshotCandidate(snapshot: PageSnapshot): BrowserSnapshotCandidate {
  const candidates: BrowserSnapshotCandidate[] = [
    {
      kind: "legacy" as const,
      text: cleanText(snapshot.textContent),
      html: snapshot.html,
      selector: "snapshot.textContent",
      order: 0
    },
    ...(snapshot.contentCandidates ?? []).map((candidate, index) => ({
      kind: candidate.kind,
      text: cleanText(candidate.text),
      html: candidate.html,
      selector: candidate.selector,
      score: candidate.score,
      order: index + 1
    }))
  ].filter((candidate) => candidate.text || candidate.html);

  const deduped = dedupeSnapshotCandidates(candidates);
  return (
    deduped.sort((a, b) => scoreBrowserSnapshotCandidate(b) - scoreBrowserSnapshotCandidate(a) || a.order - b.order)[0] ?? {
      kind: "legacy",
      text: "",
      html: snapshot.html,
      selector: "snapshot.textContent",
      order: 0
    }
  );
}

function dedupeSnapshotCandidates(candidates: BrowserSnapshotCandidate[]): BrowserSnapshotCandidate[] {
  const seen = new Set<string>();
  const result: BrowserSnapshotCandidate[] = [];
  for (const candidate of candidates) {
    const key = cleanText(candidate.text).slice(0, 500) || cleanText(htmlToText(candidate.html, "https://example.com")).slice(0, 500);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function scoreBrowserSnapshotCandidate(candidate: BrowserSnapshotCandidate): number {
  const text = cleanText(candidate.text);
  if (!text) return candidate.html ? 1 : 0;

  const lengthScore = Math.min(text.length, 1400);
  const structureScore = Math.min(Math.max(candidate.score ?? 0, 0), 1200) * 0.45;
  const sentenceScore = Math.min(text.match(/[.!?。！？]/g)?.length ?? 0, 8) * 45;
  const kindScore =
    candidate.kind === "content_root" ? 320 : candidate.kind === "focused_root" ? 220 : candidate.kind === "legacy" ? 120 : -420;
  const noisePenalty = lowSignalSnapshotText(text) ? 420 : 0;
  return lengthScore + structureScore + sentenceScore + kindScore - noisePenalty;
}

function lowSignalSnapshotText(text: string): boolean {
  const normalized = text.toLowerCase();
  if (/^(home|pricing|login|subscribe|sign in|for you|following|reply|repost|like)\b/.test(normalized)) return true;
  const words = normalized.match(/[a-z]{3,}/g) ?? [];
  if (words.length < 12) return false;
  const unique = new Set(words);
  return unique.size / words.length < 0.18;
}

function resolveSourceType(urlSourceType: SourceType, form: ContentForm): SourceType {
  // Only promote when URL routing fell into the generic "article" bucket so
  // host-specific routing (feishu/tweet/pdf/video) stays authoritative.
  if (urlSourceType !== "article") return urlSourceType;
  if (form === "video") return "video";
  return urlSourceType;
}

function resolveSourceMessage(qualityMessage: string | undefined, hasContent: boolean): string | undefined {
  if (qualityMessage) return qualityMessage;
  if (!hasContent) {
    return "Only shallow page metadata was captured. Open the page and save with the browser extension for a fuller capture.";
  }
  return undefined;
}

async function parseWithDefuddle(document: Document, url: string) {
  try {
    return await Defuddle(document.documentElement.outerHTML, url, {
      removeHiddenElements: true,
      removeContentPatterns: false,
      removeLowScoring: false,
      removeSmallImages: false,
      useAsync: false
    });
  } catch {
    return undefined;
  }
}

function extractMetadata(document: Document, url: string, snapshot: PageSnapshot | undefined, form: ContentForm) {
  const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content?.trim();
  const link = (selector: string) => document.querySelector<HTMLLinkElement>(selector)?.href?.trim();
  const jsonLd = extractJsonLdMetadata(document, form);
  // Form-shaped JSON-LD (VideoObject/AudioObject/etc.) declares the page's primary
  // resource; expose its author/uploadDate/description separately so the adapter
  // can prefer them over page-wide defaults like Defuddle's site-level
  // <meta name="author"> or a generic og:description that B站 / similar sites
  // either omit entirely or fill with a stale SEO snippet.
  const formAuthor = form === "video" || form === "audio" ? jsonLd.formAuthorName : undefined;
  const formUploadDate = form === "video" || form === "audio" ? jsonLd.formUploadDate : undefined;
  const formDescription = form === "video" || form === "audio" ? jsonLd.formDescription : undefined;

  return {
    title: meta('meta[property="og:title"]') ?? meta('meta[name="twitter:title"]') ?? jsonLd.title,
    documentTitle: document.title,
    description:
      formDescription ??
      meta('meta[property="og:description"]') ??
      meta('meta[name="twitter:description"]') ??
      meta('meta[name="description"]') ??
      jsonLd.description,
    siteName: meta('meta[property="og:site_name"]') ?? jsonLd.publisherName,
    canonicalUrl: absolutize(link('link[rel="canonical"]') ?? meta('meta[property="og:url"]'), url),
    favicon: snapshot?.favicon ?? absolutize(link('link[rel="icon"]') ?? link('link[rel="shortcut icon"]'), url),
    author: meta('meta[name="author"]') ?? jsonLd.authorName,
    publishedAt:
      meta('meta[property="article:published_time"]') ?? meta('meta[name="date"]') ?? jsonLd.datePublished ?? jsonLd.dateModified,
    formAuthor,
    formUploadDate,
    formThumbnailUrl: jsonLd.formThumbnailUrl,
    formDescription
  };
}

function stripStructuralNoise(document: Document): Document {
  const selectors = [
    "script",
    "style",
    "noscript",
    "template",
    "nav",
    "header",
    "footer",
    "aside",
    "form",
    "dialog",
    "[role='navigation']",
    "[role='banner']",
    "[aria-modal='true']",
    "[class*='cookie']",
    "[id*='cookie']",
    "[class*='subscribe']",
    "[id*='subscribe']"
  ];

  document.querySelectorAll(selectors.join(",")).forEach((element) => element.remove());
  return document;
}

function pickContentHtml(input: {
  parserHtml?: string | null;
  snapshotHtml?: string;
  extractor?: string;
  readableText: string;
}): string | undefined {
  if (input.extractor === "browser_selection") return contentHtmlFromText(input.readableText);
  if (input.extractor === "browser_snapshot") {
    return contentHtmlFromSnapshot(input.snapshotHtml, input.readableText);
  }

  return sanitizeContentHtml(input.parserHtml);
}
function htmlToText(html: string | null | undefined, url: string): string {
  if (!html) return "";
  const dom = new JSDOM(html, { url });
  return cleanText(dom.window.document.body.textContent ?? "");
}

function asOptionalString(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function firstText(...values: Array<string | null | undefined>): string | undefined {
  return values.map((value) => cleanText(asOptionalString(value))).find(Boolean);
}
