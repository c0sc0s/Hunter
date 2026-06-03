import { Readability } from "@mozilla/readability";
import { Defuddle } from "defuddle/node";
import { JSDOM } from "jsdom";
import type { PageSnapshot } from "../../shared/types";
import { contentHtmlFromSnapshot, contentHtmlFromText, sanitizeContentHtml } from "./contentHtml";
import { decideContentQuality, hasReadySelectedText, shouldRunReadabilityFallback } from "./contentQuality";
import { pickCoverImage, type CoverImageCandidate } from "./coverImage";
import { fetchHtmlDocument } from "./htmlFetch";
import type { SourceAdapter } from "./types";
import { absolutize, cleanText, detectSourceType, faviconFor, normalizeUrl } from "./url";

export const genericWebAdapter: SourceAdapter = {
  id: "generic-web",
  label: "Generic web page",
  canHandle: () => true,
  async extract({ url, snapshot }) {
    const normalizedUrl = normalizeUrl(url);
    const html = snapshot?.html ?? (await fetchHtmlDocument(normalizedUrl));
    const dom = new JSDOM(html, { url: normalizedUrl });
    const document = dom.window.document;
    const metadata = extractMetadata(document, normalizedUrl, snapshot);
    const snapshotText = cleanText(snapshot?.textContent);
    const selectedText = cleanText(snapshot?.selectedText);
    const parserDocument = hasReadySelectedText(selectedText) ? undefined : stripStructuralNoise(document.cloneNode(true) as Document);
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
      firstText(metadata.title, defuddled?.title, article?.title, snapshot?.title, metadata.documentTitle) ??
      new URL(normalizedUrl).hostname;
    const sourceName =
      firstText(snapshot?.siteName, defuddled?.site, article?.siteName, metadata.siteName) ?? new URL(normalizedUrl).hostname;
    const imageCandidates: CoverImageCandidate[] = [
      ...(snapshot?.imageCandidates ?? []).map((candidate) => ({ url: candidate, source: "snapshot_image" as const })),
      { url: absolutize(defuddled?.image, normalizedUrl), source: "parser" },
      { url: metadata.ogImage, source: "open_graph" },
      { url: metadata.twitterImage, source: "twitter_card" },
      { url: metadata.jsonLdImage, source: "structured_data" },
      ...extractArticleImages(document, normalizedUrl).map((candidate) => ({ url: candidate, source: "article_image" as const }))
    ];
    const excerpt = cleanText(
      selectedText || snapshot?.excerpt || defuddled?.description || article?.excerpt || metadata.description || quality.readableText
    ).slice(0, 420);
    const hasContent = Boolean(quality.readableText || excerpt);

    return {
      url: normalizedUrl,
      canonicalUrl: normalizeUrl(snapshot?.canonicalUrl ?? metadata.canonicalUrl ?? normalizedUrl),
      title,
      sourceName,
      sourceType: detectSourceType(normalizedUrl),
      excerpt,
      readableText: quality.readableText,
      contentHtml: pickContentHtml({
        parserHtml: defuddled?.content ?? article?.content,
        snapshotHtml: snapshot?.html,
        extractor: quality.extractor,
        readableText: quality.readableText
      }),
      coverImage: pickCoverImage(imageCandidates),
      favicon: snapshot?.favicon ?? absolutize(defuddled?.favicon, normalizedUrl) ?? metadata.favicon ?? faviconFor(normalizedUrl),
      author: firstText(defuddled?.author, article?.byline, metadata.author),
      publishedAt: firstText(snapshot?.publishedAt, defuddled?.published, article?.publishedTime, metadata.publishedAt),
      language: firstText(defuddled?.language, article?.lang),
      wordCount: quality.candidateSource === "defuddle" ? (defuddled?.wordCount ?? quality.wordCount) : quality.wordCount,
      confidence: quality.confidence,
      extractionState: quality.extractionState,
      captureMethod: snapshot ? "extension_snapshot" : "url_fetch",
      extractor: quality.extractor,
      sourceAccess: snapshot ? "browser_snapshot" : "public",
      sourceMessage:
        quality.sourceMessage ??
        (hasContent
          ? undefined
          : "Only shallow page metadata was captured. Open the page and save with the browser extension for a fuller capture.")
    };
  }
};

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

function extractMetadata(document: Document, url: string, snapshot?: PageSnapshot) {
  const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content?.trim();
  const link = (selector: string) => document.querySelector<HTMLLinkElement>(selector)?.href?.trim();
  const jsonLd = parseJsonLd(document);

  return {
    title: meta('meta[property="og:title"]') ?? meta('meta[name="twitter:title"]') ?? jsonLd.title,
    documentTitle: document.title,
    description:
      meta('meta[property="og:description"]') ??
      meta('meta[name="twitter:description"]') ??
      meta('meta[name="description"]') ??
      jsonLd.description,
    siteName: meta('meta[property="og:site_name"]') ?? jsonLd.publisherName,
    ogImage: absolutize(meta('meta[property="og:image"]'), url),
    twitterImage: absolutize(meta('meta[name="twitter:image"]'), url),
    jsonLdImage: absolutize(jsonLd.image, url),
    canonicalUrl: absolutize(link('link[rel="canonical"]') ?? meta('meta[property="og:url"]'), url),
    favicon: snapshot?.favicon ?? absolutize(link('link[rel="icon"]') ?? link('link[rel="shortcut icon"]'), url),
    author: meta('meta[name="author"]') ?? jsonLd.authorName,
    publishedAt: meta('meta[property="article:published_time"]') ?? meta('meta[name="date"]') ?? jsonLd.datePublished ?? jsonLd.dateModified
  };
}

function parseJsonLd(document: Document) {
  const scripts = [...document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')];
  const parsedValues: unknown[] = [];

  for (const script of scripts) {
    try {
      parsedValues.push(JSON.parse(script.textContent ?? ""));
    } catch {
      continue;
    }
  }

  const node = pickJsonLdArticleNode(parsedValues);
  return {
    title: firstText(asText(node.headline), asText(node.name)),
    description: asText(node.description),
    authorName: firstJsonLdText(node.author, "name"),
    publisherName: firstJsonLdText(node.publisher, "name"),
    datePublished: asText(node.datePublished),
    dateModified: asText(node.dateModified),
    image: firstJsonLdImage(node.image)
  };
}

function firstJsonLdImage(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.map(firstJsonLdImage).find(Boolean);
  }

  if (typeof value === "object" && value) {
    const record = value as Record<string, unknown>;
    return asText(record.url ?? record.contentUrl);
  }

  return asText(value);
}

function pickJsonLdArticleNode(value: unknown): Record<string, unknown> {
  const nodes = flattenJsonLdNodes(value);
  const articleNode = nodes.find((node) => isArticleJsonLdNode(node));
  return articleNode ?? nodes[0] ?? {};
}

function flattenJsonLdNodes(value: unknown): Array<Record<string, unknown>> {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenJsonLdNodes);
  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const graph = flattenJsonLdNodes(record["@graph"]);
  return [record, ...graph];
}

function isArticleJsonLdNode(value: Record<string, unknown>): boolean {
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  return types.some((type) => typeof type === "string" && /^(Article|NewsArticle|BlogPosting|Report|TechArticle)$/i.test(type));
}

function firstJsonLdText(value: unknown, key: string): string | undefined {
  if (Array.isArray(value)) {
    return value.map((entry) => firstJsonLdText(entry, key)).find(Boolean);
  }

  if (typeof value === "object" && value) {
    return asText((value as Record<string, unknown>)[key]);
  }

  return asText(value);
}

function extractArticleImages(document: Document, url: string): string[] {
  return [...document.querySelectorAll<HTMLImageElement>("article img, main img, img")]
    .map((image) => image.currentSrc || image.src || image.getAttribute("data-src") || "")
    .map((src) => absolutize(src, url))
    .filter((src): src is string => Boolean(src));
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

function asText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalString(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function firstText(...values: Array<string | null | undefined>): string | undefined {
  return values.map((value) => cleanText(asOptionalString(value))).find(Boolean);
}
