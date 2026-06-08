import { JSDOM } from "jsdom";
import type { PageSnapshot } from "../../shared/types";
import { contentHtmlFromSnapshot, contentHtmlFromText } from "./contentHtml";
import { decideContentQuality } from "./contentQuality";
import { isUsefulCoverImageUrl, selectCoverImage } from "./coverImage";
import type { ExtractedContent, SourceAdapter } from "./types";
import { cleanText, faviconFor, normalizeUrl } from "./url";

export const xAdapter: SourceAdapter = {
  id: "x",
  label: "X",
  canHandle(url) {
    return Boolean(getTweetStatusId(url));
  },
  async extract({ url, snapshot }) {
    const normalizedUrl = normalizeUrl(url);
    const selectedText = cleanText(snapshot.selectedText);
    const snapshotText = cleanText(extractTweetTextFromSnapshotHtml(snapshot.html) || snapshot.textContent);
    // Route everything through the shared quality gate so confidence,
    // extraction state, and word count rules stay in contentQuality.ts.
    const quality = decideContentQuality([
      { source: "selected_text", text: selectedText },
      { source: "tweet_snapshot", text: snapshotText },
      { source: "metadata", text: snapshot.excerpt }
    ]);

    return buildBrowserSnapshotTweet(normalizedUrl, snapshot, quality);
  }
};

async function buildBrowserSnapshotTweet(
  url: string,
  snapshot: PageSnapshot,
  quality: ReturnType<typeof decideContentQuality>
): Promise<ExtractedContent> {
  const normalizedText = quality.readableText;
  const snapshotFields = extractSnapshotFields(snapshot.html, url);
  const title = cleanText(snapshotFields.title || snapshot.title) || "X post";
  const hasBody = normalizedText.length > 0;

  return {
    url,
    canonicalUrl: normalizeUrl(snapshot.canonicalUrl ?? url),
    title,
    sourceName: snapshotFields.author || snapshot.siteName || "X",
    sourceType: "tweet",
    excerpt: normalizedText.slice(0, 420),
    readableText: normalizedText,
    contentHtml: hasBody
      ? quality.extractor === "browser_selection"
        ? contentHtmlFromText(normalizedText)
        : contentHtmlFromSnapshot(snapshot.html, normalizedText)
      : undefined,
    coverImage: await selectCoverImage({
      url,
      html: snapshot.html,
      snapshotCandidates: snapshot.imageCandidates,
      preferred: snapshotFields.image
    }),
    favicon: snapshot.favicon ?? faviconFor(url),
    author: snapshotFields.author,
    publishedAt: snapshot.publishedAt ?? snapshotFields.publishedAt,
    wordCount: quality.wordCount,
    confidence: quality.confidence,
    extractionState: quality.extractionState,
    extractor: quality.extractor,
    sourceMessage: hasBody
      ? quality.sourceMessage
      : "Only shallow page metadata was captured. Open the page and save with the browser extension for a fuller capture."
  };
}

function extractTweetTextFromSnapshotHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const fields = extractSnapshotFields(html, "https://x.com");
  return fields.text;
}

function extractSnapshotFields(html: string | undefined, url: string) {
  if (!html) return {};
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  const article = document.querySelector("article") ?? document.body;
  const title = cleanText(
    document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content ||
      document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]')?.content ||
      document.title
  );
  const author = cleanText(article?.querySelector("[data-testid='User-Name']")?.textContent || title.match(/^(.+?)\s+on X\b/)?.[1]);
  const image = firstUsefulImage([
    ...tweetMediaImages(article),
    document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content,
    document.querySelector<HTMLMetaElement>('meta[name="twitter:image"]')?.content,
    ...elementImageUrls(article)
  ]);
  const timeValue =
    article?.querySelector<HTMLTimeElement>("time")?.dateTime || article?.querySelector("time")?.getAttribute("datetime") || "";
  const tweetText = cleanText(
    article?.querySelector("[data-testid='tweetText']")?.textContent ||
      article?.querySelector("[lang]")?.textContent ||
      article?.textContent
  );

  return {
    title,
    author: author || undefined,
    image,
    publishedAt: parseDate(timeValue),
    text: tweetText || undefined
  };
}

function firstUsefulImage(values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const clean = cleanText(value ?? undefined);
    if (isUsefulCoverImageUrl(clean)) return clean;
  }
  return undefined;
}

function tweetMediaImages(article: Element | null | undefined): string[] {
  if (!article) return [];
  return [
    ...elementImageUrls(article.querySelector("[data-testid='tweetPhoto']")),
    ...elementImageUrls(article.querySelector("[aria-label='Image']")),
    ...Array.from(article.querySelectorAll<HTMLAnchorElement>("a[href*='/photo/']")).flatMap((element) => elementImageUrls(element)),
    ...elementImageUrls(article)
  ].filter(isTweetMediaUrl);
}

function elementImageUrls(root: Element | null | undefined): string[] {
  if (!root) return [];
  return [
    ...Array.from(root.querySelectorAll<HTMLImageElement>("img")).flatMap((image) => [
      image.currentSrc,
      image.src,
      image.getAttribute("data-src"),
      bestSrcsetUrl(image.srcset || image.getAttribute("srcset") || image.getAttribute("data-srcset"))
    ]),
    ...Array.from(root.querySelectorAll<HTMLElement>("[style*='background']")).flatMap((element) =>
      imageUrlsFromCss(element.getAttribute("style"))
    )
  ].filter((value): value is string => Boolean(value));
}

function isTweetMediaUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return /(^|\.)twimg\.com$/i.test(parsed.hostname) && parsed.pathname.includes("/media/");
  } catch {
    return false;
  }
}

function bestSrcsetUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((entry) => {
      const [url, descriptor = ""] = entry.trim().split(/\s+/, 2);
      const score = descriptor.endsWith("w")
        ? Number.parseInt(descriptor, 10)
        : descriptor.endsWith("x")
          ? Number.parseFloat(descriptor) * 1000
          : 0;
      return { url, score: Number.isFinite(score) ? score : 0 };
    })
    .filter((entry) => entry.url)
    .sort((a, b) => b.score - a.score)[0]?.url;
}

function imageUrlsFromCss(value: string | null): string[] {
  if (!value) return [];
  return Array.from(value.matchAll(/url\((['"]?)(.*?)\1\)/g), (match) => match[2]).filter(Boolean);
}

function getTweetStatusId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host !== "x.com" && host !== "twitter.com") return undefined;
  return parsed.pathname.match(/\/status\/(\d+)/)?.[1];
}

function parseDate(value: string): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}
