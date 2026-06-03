import type { ExtractedContent, SourceAdapter } from "./types";
import { selectCoverImage } from "./coverImage";
import { cleanText, detectSourceType, faviconFor, normalizeUrl } from "./url";

export const videoAdapter: SourceAdapter = {
  id: "video",
  label: "Video",
  canHandle(url) {
    return isSupportedVideoUrl(url);
  },
  async extract({ url, snapshot }) {
    const normalizedUrl = normalizeUrl(url);
    const oembed = await fetchVideoOEmbed(normalizedUrl);
    if (oembed) {
      return buildVideoContent({
        url: normalizedUrl,
        title: oembed.title,
        author: oembed.author_name,
        provider: oembed.provider_name,
        coverImage: await selectCoverImage({
          url: normalizedUrl,
          html: snapshot?.html,
          snapshotCandidates: snapshot?.imageCandidates,
          preferred: oembed.thumbnail_url
        }),
        readableText: snapshot?.selectedText || snapshot?.excerpt || "",
        captureMethod: "source_adapter",
        sourceAccess: "public",
        sourceMessage: "Captured public video metadata. Transcripts and comments require a future source-specific adapter."
      });
    }

    const snapshotText = cleanText(snapshot?.selectedText || snapshot?.textContent || snapshot?.excerpt);
    return buildVideoContent({
      url: normalizedUrl,
      title: snapshot?.title,
      provider: snapshot?.siteName,
      coverImage: await selectCoverImage({
        url: normalizedUrl,
        html: snapshot?.html,
        snapshotCandidates: snapshot?.imageCandidates
      }),
      readableText: snapshotText,
      captureMethod: snapshot ? "extension_snapshot" : "url_fetch",
      sourceAccess: snapshot ? "browser_snapshot" : "public",
      sourceMessage: snapshotText
        ? "Captured visible video page text from the browser. Public video metadata could not be resolved."
        : "Only shallow video metadata was captured. Save from the opened page or add a future transcript adapter."
    });
  }
};

type VideoOEmbed = {
  title?: string;
  author_name?: string;
  provider_name?: string;
  thumbnail_url?: string;
};

type VideoContentInput = {
  url: string;
  title?: string;
  author?: string;
  provider?: string;
  coverImage?: string;
  readableText?: string;
  captureMethod: ExtractedContent["captureMethod"];
  sourceAccess: ExtractedContent["sourceAccess"];
  sourceMessage: string;
};

async function fetchVideoOEmbed(url: string): Promise<VideoOEmbed | undefined> {
  const endpoint = oembedEndpointFor(url);
  if (!endpoint) return undefined;

  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "Huntter/0.1 (+https://localhost)"
    }
  });

  if (!response.ok) return undefined;
  return (await response.json()) as VideoOEmbed;
}

function buildVideoContent(input: VideoContentInput): ExtractedContent {
  const sourceName = cleanText(input.provider) || videoProviderName(input.url);
  const title = cleanText(input.title) || `${sourceName} video`;
  const readableText = cleanText(input.readableText);

  return {
    url: input.url,
    canonicalUrl: input.url,
    title,
    sourceName,
    sourceType: "video",
    excerpt: readableText || title,
    readableText,
    coverImage: input.coverImage,
    favicon: faviconFor(input.url),
    author: cleanText(input.author) || undefined,
    confidence: input.title ? 0.58 : readableText ? 0.42 : 0.24,
    extractionState: "partial",
    captureMethod: input.captureMethod,
    extractor: "oembed",
    sourceAccess: input.sourceAccess,
    sourceMessage: input.sourceMessage
  };
}

function oembedEndpointFor(url: string): string | undefined {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");
  const endpoint =
    host === "youtube.com" || host === "youtu.be"
      ? new URL("https://www.youtube.com/oembed")
      : host === "vimeo.com"
        ? new URL("https://vimeo.com/api/oembed.json")
        : undefined;

  if (!endpoint) return undefined;
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("format", "json");
  return endpoint.toString();
}

function isSupportedVideoUrl(url: string): boolean {
  try {
    return detectSourceType(url) === "video" && Boolean(oembedEndpointFor(url));
  } catch {
    return false;
  }
}

function videoProviderName(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host === "youtube.com" || host === "youtu.be") return "YouTube";
  if (host === "vimeo.com") return "Vimeo";
  return host;
}
