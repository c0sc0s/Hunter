import { JSDOM } from "jsdom";
import { contentHtmlFromSnapshot, contentHtmlFromText } from "./contentHtml";
import { decideContentQuality } from "./contentQuality";
import { isUsefulCoverImageUrl, selectCoverImage } from "./coverImage";
import type { ExtractedContent, SourceAdapter } from "./types";
import { cleanText, faviconFor, normalizeUrl } from "./url";

const fetchTimeoutMs = 6000;

export const xAdapter: SourceAdapter = {
  id: "x",
  label: "X",
  canHandle(url) {
    return Boolean(getTweetStatusId(url));
  },
  async extract({ url, snapshot }) {
    const normalizedUrl = normalizeUrl(url);
    const selectedText = cleanText(snapshot?.selectedText);
    if (selectedText.length >= 20) return buildBrowserSnapshotTweet(normalizedUrl, snapshot, selectedText, "browser_selection");

    const oembed = await extractTweetOEmbed(normalizedUrl);
    if (oembed) return oembed;

    const snapshotText = cleanText(extractTweetTextFromSnapshotHtml(snapshot?.html) || snapshot?.textContent);
    const quality = decideContentQuality([
      { source: "browser_snapshot", text: snapshotText },
      { source: "metadata", text: snapshot?.excerpt }
    ]);

    if (quality.readableText.length >= 40)
      return buildBrowserSnapshotTweet(normalizedUrl, snapshot, quality.readableText, quality.extractor);

    return {
      url: normalizedUrl,
      canonicalUrl: normalizedUrl,
      title: "X post",
      sourceName: "X",
      sourceType: "tweet",
      excerpt: "",
      readableText: "",
      favicon: faviconFor(normalizedUrl),
      confidence: 0.2,
      extractionState: "needs_connector",
      captureMethod: snapshot ? "extension_snapshot" : "url_fetch",
      sourceAccess: "connector_required",
      requiredConnector: "x",
      sourceMessage: "This X post could not be resolved from public embed metadata. Save from the opened page or connect the X API."
    };
  }
};

async function buildBrowserSnapshotTweet(
  url: string,
  snapshot: Parameters<SourceAdapter["extract"]>[0]["snapshot"],
  text: string,
  extractor: string
): Promise<ExtractedContent> {
  const normalizedText = cleanText(text);
  const snapshotFields = extractSnapshotFields(snapshot?.html, url);
  const title = cleanText(snapshotFields.title || snapshot?.title) || "X post";

  return {
    url,
    canonicalUrl: normalizeUrl(snapshot?.canonicalUrl ?? url),
    title,
    sourceName: snapshotFields.author || snapshot?.siteName || "X",
    sourceType: "tweet",
    excerpt: normalizedText.slice(0, 420),
    readableText: normalizedText,
    contentHtml:
      extractor === "browser_selection" ? contentHtmlFromText(normalizedText) : contentHtmlFromSnapshot(snapshot?.html, normalizedText),
    coverImage: await selectCoverImage({
      url,
      html: snapshot?.html,
      snapshotCandidates: snapshot?.imageCandidates,
      preferred: snapshotFields.image
    }),
    favicon: snapshot?.favicon ?? faviconFor(url),
    author: snapshotFields.author,
    publishedAt: snapshot?.publishedAt ?? snapshotFields.publishedAt,
    wordCount: countTweetWords(normalizedText),
    confidence: extractor === "browser_selection" ? 0.72 : normalizedText.length >= 160 ? 0.62 : 0.42,
    extractionState: normalizedText.length >= 80 ? "ready" : "partial",
    captureMethod: "extension_snapshot",
    extractor,
    sourceAccess: "browser_snapshot",
    sourceMessage:
      extractor === "browser_selection"
        ? "Captured selected text from X. Connect the X API later for full bookmark/thread sync."
        : "Captured visible X content from the browser. Connect the X API later for full bookmark/thread sync, author fidelity, and thread expansion."
  };
}

async function extractTweetOEmbed(url: string): Promise<ExtractedContent | undefined> {
  const endpoint = new URL("https://publish.twitter.com/oembed");
  endpoint.searchParams.set("omit_script", "true");
  endpoint.searchParams.set("url", url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Huntter/0.1 (+https://localhost)"
      }
    });

    if (!response.ok) return undefined;

    const embed = (await response.json()) as {
      author_name?: string;
      author_url?: string;
      html?: string;
      provider_name?: string;
    };

    const dom = new JSDOM(embed.html ?? "", { url });
    const document = dom.window.document;
    const text = cleanText(document.querySelector("p")?.textContent ?? "");
    const author = cleanText(embed.author_name);
    const username = embed.author_url ? new URL(embed.author_url).pathname.replace("/", "") : "";
    const dateText = cleanText(document.querySelector("a[href*='/status/']")?.textContent ?? "");
    const publishedAt = parseDate(dateText);
    const titleSubject = author || (username ? `@${username}` : "X");

    return {
      url,
      canonicalUrl: url,
      title: `${titleSubject} on X`,
      sourceName: author || embed.provider_name || "X",
      sourceType: "tweet",
      excerpt: text.slice(0, 420),
      readableText: text,
      contentHtml: contentHtmlFromText(text),
      favicon: faviconFor(url),
      author: author || undefined,
      publishedAt,
      wordCount: countTweetWords(text),
      confidence: text ? 0.76 : 0.42,
      extractionState: text ? "ready" : "partial",
      captureMethod: "source_adapter",
      extractor: "oembed",
      sourceAccess: "public",
      sourceMessage: text ? undefined : "X embed metadata did not include post text."
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
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
  const image = cleanText(
    document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content ||
      document.querySelector<HTMLMetaElement>('meta[name="twitter:image"]')?.content ||
      article?.querySelector<HTMLImageElement>("img")?.currentSrc ||
      article?.querySelector<HTMLImageElement>("img")?.src
  );
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
    image: isUsefulCoverImageUrl(image) ? image : undefined,
    publishedAt: parseDate(timeValue),
    text: tweetText || undefined
  };
}

function countTweetWords(text: string): number {
  const latinWords = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  const cjkChars = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return latinWords + Math.ceil(cjkChars / 2);
}

function getTweetStatusId(url: string): string | undefined {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");
  if (host !== "x.com" && host !== "twitter.com") return undefined;
  return parsed.pathname.match(/\/status\/(\d+)/)?.[1];
}

function parseDate(value: string): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}
