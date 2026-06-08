import createMetascraper from "metascraper";
import metascraperImage from "metascraper-image";
import { JSDOM } from "jsdom";
import { upgradeCdnCoverResolution } from "../../shared/coverImageUrl";
import type { ImageCandidate } from "../../shared/types";

const metascraper = createMetascraper([metascraperImage()]);

export type CoverImageInput = {
  url: string;
  html?: string;
  snapshotCandidates?: Array<ImageCandidate | null | undefined>;
  preferred?: string | null;
};

type InternalCoverCandidate = {
  url: string;
  score: number;
  order: number;
  source?: string;
  width?: number;
  height?: number;
  alt?: string;
  context?: string;
  inContentRoot?: boolean;
};

type CandidateDefaults = {
  score: number;
  source: string;
};

type StructuredImageCandidate = Exclude<ImageCandidate, string>;

// `selectCoverImage` runs all available snapshot-derived image signals through
// one scoring model. Metadata remains useful, but strong in-content images are
// allowed to beat site-level Open Graph images that often resolve to logos on
// enterprise/internal pages.
export async function selectCoverImage(input: CoverImageInput): Promise<string | undefined> {
  const pageProtocol = pageProtocolFromUrl(input.url);
  const candidates = await collectCoverCandidates(input, pageProtocol);
  const selected = pickBestUsefulCandidate(candidates);
  return selected ? upgradeCdnCoverResolution(selected) : undefined;
}

export function selectCoverImageFromCandidates(
  candidates: Array<ImageCandidate | null | undefined> | undefined,
  pageProtocol?: "http:" | "https:"
): string | undefined {
  const selected = pickBestUsefulCandidate(normalizeSnapshotCandidates(candidates, pageProtocol, 0));
  return selected ? upgradeCdnCoverResolution(selected) : undefined;
}

export function isUsefulCoverImageUrl(value: string | undefined | null): value is string {
  return Boolean(normalizeUsefulImageUrl(value));
}

async function collectCoverCandidates(
  input: CoverImageInput,
  pageProtocol: "http:" | "https:" | undefined
): Promise<InternalCoverCandidate[]> {
  const candidates: InternalCoverCandidate[] = [];
  let order = 0;

  const preferred = normalizeCoverCandidate(input.preferred, { score: 1_140, source: "preferred" }, pageProtocol, order++);
  if (preferred) candidates.push(preferred);

  const htmlCandidates = await collectHtmlCoverCandidates(input.url, input.html, pageProtocol, order);
  candidates.push(...htmlCandidates);
  order += htmlCandidates.length;

  candidates.push(...normalizeSnapshotCandidates(input.snapshotCandidates, pageProtocol, order));

  return dedupeCandidates(candidates);
}

function normalizeCoverCandidate(
  candidate: ImageCandidate | string | null | undefined,
  defaults: CandidateDefaults,
  pageProtocol: "http:" | "https:" | undefined,
  order: number
): InternalCoverCandidate | undefined {
  const sourceValue = typeof candidate === "string" ? candidate : candidate?.url;
  const url = normalizeUsefulImageUrl(sourceValue, pageProtocol);
  if (!url) return undefined;

  const structuredCandidate = typeof candidate === "object" && candidate !== null ? candidate : undefined;
  const source = structuredCandidate?.source ?? defaults.source;
  const width = positiveNumber(structuredCandidate?.width);
  const height = positiveNumber(structuredCandidate?.height);
  const alt = cleanText(structuredCandidate?.alt);
  const context = cleanText(structuredCandidate?.context);
  const inContentRoot = Boolean(structuredCandidate?.inContentRoot);
  const baseScore = finiteNumber(structuredCandidate?.score) ?? defaults.score;

  if (isTooSmallForCover(url, source, width, height)) return undefined;

  const score =
    baseScore +
    sourceScore(source) +
    dimensionScore(width, height, source) +
    contextScore(`${alt || ""} ${context || ""}`) +
    urlScore(url, source) +
    rootScore(inContentRoot);

  return {
    url,
    score,
    order: structuredCandidate ? Math.min(order, Math.max(0, Math.round(finiteNumber(structuredCandidate.order) ?? order))) : order,
    source,
    width,
    height,
    alt,
    context,
    inContentRoot
  };
}

function pickBestUsefulCandidate(candidates: InternalCoverCandidate[]): string | undefined {
  return candidates.filter((candidate) => candidate.score >= 220).sort((a, b) => b.score - a.score || a.order - b.order)[0]?.url;
}

function dedupeCandidates(candidates: InternalCoverCandidate[]): InternalCoverCandidate[] {
  const byUrl = new Map<string, InternalCoverCandidate>();
  for (const candidate of candidates) {
    const existing = byUrl.get(candidate.url);
    if (!existing || candidate.score > existing.score || (candidate.score === existing.score && candidate.order < existing.order)) {
      byUrl.set(candidate.url, candidate);
    }
  }
  return [...byUrl.values()];
}

function metaImageCandidate(document: Document, url: string, selector: string): StructuredImageCandidate | undefined {
  const value = document.querySelector<HTMLMetaElement>(selector)?.content?.trim();
  const absolute = absolutize(value, url);
  if (!absolute) return undefined;
  return {
    url: absolute,
    width: positiveNumber(document.querySelector<HTMLMetaElement>('meta[property="og:image:width"]')?.content),
    height: positiveNumber(document.querySelector<HTMLMetaElement>('meta[property="og:image:height"]')?.content)
  };
}

function jsonLdImageCandidates(document: Document, url: string): StructuredImageCandidate[] {
  const candidates: StructuredImageCandidate[] = [];
  for (const script of Array.from(document.querySelectorAll("script[type='application/ld+json']"))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent || "null");
    } catch {
      continue;
    }
    for (const node of flattenJsonLd(parsed)) {
      if (!node || typeof node !== "object") continue;
      const record = node as Record<string, unknown>;
      const type = jsonLdType(record).toLowerCase();
      const source = jsonLdSource(type);
      if (!source) continue;
      const image = firstJsonLdImageUrl(record.thumbnailUrl) ?? firstJsonLdImageUrl(record.image);
      const absolute = absolutize(image, url);
      if (!absolute) continue;
      candidates.push({
        url: absolute,
        score: /video|audio/.test(type) ? 1_040 : 930,
        source,
        context: type
      });
    }
  }
  return candidates;
}

function domImageCandidates(document: Document, url: string): StructuredImageCandidate[] {
  const contentRoot = document.querySelector("article, main, [role='main'], [itemprop='articleBody'], .article-content, .post-content");
  const candidates: StructuredImageCandidate[] = [];
  if (contentRoot) {
    candidates.push(...imageCandidatesFromRoot(contentRoot, url, 620, "html_content_image", true));
    candidates.push(...backgroundCandidatesFromRoot(contentRoot, url, 590, "html_content_background", true));
  }
  const body = document.body;
  if (body && body !== contentRoot) {
    candidates.push(...imageCandidatesFromRoot(body, url, 360, "html_page_image", false));
    candidates.push(...backgroundCandidatesFromRoot(body, url, 340, "html_page_background", false));
  }
  return candidates;
}

function imageCandidatesFromRoot(
  root: Element,
  url: string,
  baseScore: number,
  source: string,
  inContentRoot: boolean
): StructuredImageCandidate[] {
  return Array.from(root.querySelectorAll("img, picture source"))
    .slice(0, 120)
    .flatMap((element) => {
      const width =
        positiveNumber((element as HTMLImageElement).naturalWidth) ??
        positiveNumber((element as HTMLImageElement).width) ??
        positiveNumber(element.getAttribute("width"));
      const height =
        positiveNumber((element as HTMLImageElement).naturalHeight) ??
        positiveNumber((element as HTMLImageElement).height) ??
        positiveNumber(element.getAttribute("height"));
      const hasSrcset = Boolean(
        (element as HTMLImageElement).srcset || element.getAttribute("srcset") || element.getAttribute("data-srcset")
      );
      const rawValues = imageSourceValues(element);
      const looksLikeMedia = rawValues.some((value) => /(^|\.)twimg\.com\/media\//i.test(value));
      if (!looksLikeMedia && !hasSrcset && width !== undefined && height !== undefined && width < 120 && height < 120) return [];

      const context = elementContext(element);
      const score = baseScore + Math.min(220, Math.round(((width ?? 1) * (height ?? 1)) / 1800)) + contextScore(context);

      return rawValues.flatMap((value) => {
        const absolute = absolutize(value, url);
        return absolute
          ? [
              {
                url: absolute,
                score,
                source,
                width,
                height,
                alt: cleanText((element as HTMLImageElement).alt || element.getAttribute("aria-label")),
                context,
                inContentRoot
              }
            ]
          : [];
      });
    });
}

function backgroundCandidatesFromRoot(
  root: Element,
  url: string,
  baseScore: number,
  source: string,
  inContentRoot: boolean
): StructuredImageCandidate[] {
  return Array.from(root.querySelectorAll("[style*='background']"))
    .slice(0, 120)
    .flatMap((element) =>
      imageUrlsFromCss(element.getAttribute("style")).flatMap((value) => {
        const absolute = absolutize(value, url);
        return absolute
          ? [
              {
                url: absolute,
                score: baseScore + contextScore(elementContext(element)),
                source,
                context: elementContext(element),
                inContentRoot
              }
            ]
          : [];
      })
    );
}

function imageSourceValues(element: Element): string[] {
  const image = element as HTMLImageElement;
  return [
    image.currentSrc,
    image.src,
    element.getAttribute("src"),
    element.getAttribute("data-src"),
    element.getAttribute("data-original"),
    element.getAttribute("data-original-src"),
    element.getAttribute("data-lazy-src"),
    element.getAttribute("data-image-src"),
    element.getAttribute("data-full-src"),
    bestSrcsetUrl(image.srcset || element.getAttribute("srcset") || element.getAttribute("data-srcset"))
  ].filter((value): value is string => Boolean(value));
}

function flattenJsonLd(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap((entry) => flattenJsonLd(entry));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [record, ...flattenJsonLd(record["@graph"])];
}

function firstJsonLdImageUrl(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = firstJsonLdImageUrl(entry);
      if (url) return url;
    }
    return undefined;
  }
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.url === "string") return record.url;
    if (typeof record.contentUrl === "string") return record.contentUrl;
  }
  return undefined;
}

function jsonLdType(record: Record<string, unknown>): string {
  const type = record["@type"];
  return Array.isArray(type) ? type.join(" ") : String(type || "");
}

function jsonLdSource(type: string): string | undefined {
  if (/video/.test(type)) return "html_jsonld:video_thumbnail";
  if (/audio|episode|podcast/.test(type)) return "html_jsonld:audio_thumbnail";
  if (/article|news|blogposting|posting/.test(type)) return "html_jsonld:article_image";
  return undefined;
}

function bestSrcsetUrl(value: string | null | undefined): string | undefined {
  if (!value || !value.includes(",")) return undefined;
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

function elementContext(element: Element): string | undefined {
  return cleanText(
    `${(element as HTMLImageElement).alt || ""} ${element.getAttribute("aria-label") || ""} ${
      element.getAttribute("data-testid") || ""
    } ${element.className || ""} ${element.id || ""} ${
      element.closest("[data-testid='tweetPhoto'], a[href*='/photo/'], figure, article, main")?.getAttribute("data-testid") || ""
    }`
  );
}

function sourceScore(source: string | undefined): number {
  const value = (source || "").toLowerCase();
  if (value.includes("preferred")) return 260;
  if (value.includes("jsonld:video") || value.includes("jsonld:audio")) return 220;
  if (value.includes("jsonld:article")) return 120;
  if (value.includes("content_image") || value.includes("content_background")) return 260;
  if (value.includes("page_image") || value.includes("page_background")) return 80;
  if (value.includes("tweet") || value.includes("x_media")) return 260;
  if (value.includes("meta") || value.includes("metascraper")) return -160;
  return 0;
}

function rootScore(inContentRoot: boolean): number {
  return inContentRoot ? 180 : 0;
}

function dimensionScore(width: number | undefined, height: number | undefined, source: string | undefined): number {
  if (!width || !height) return 0;
  const area = width * height;
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  let score = Math.min(260, Math.round(area / 3_000));
  if (longEdge >= 640 && shortEdge >= 240) score += 140;
  if (longEdge >= 320 && shortEdge >= 160) score += 80;
  const ratio = longEdge / Math.max(shortEdge, 1);
  if (ratio >= 1.25 && ratio <= 2.6) score += 90;
  if (looksMetadataLike(source) && longEdge <= 420 && ratio < 1.34) score -= 300;
  return score;
}

function contextScore(value: string | undefined): number {
  const text = (value || "").toLowerCase();
  if (!text) return 0;
  let score = 0;
  if (/(tweetphoto|\/photo\/|cover|hero|figure|photo|image|media|poster|thumbnail)/i.test(text)) score += 160;
  if (/(article|main|content)/i.test(text)) score += 80;
  if (/(avatar|badge|favicon|icon|logo|profile|sprite|toolbar|nav|menu|author)/i.test(text)) score -= 520;
  return score;
}

function urlScore(url: string, source: string | undefined): number {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 0;
  }
  const path = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  let score = 0;
  if (/pbs\.twimg\.com\/media\//.test(path)) score += 520;
  if (/(^|[_.\-/%?=&])(cover|hero|media|photo|image|poster|thumbnail|upload|article)([_.\-/%?=&]|$)/.test(path)) score += 90;
  if (looksMetadataLike(source) && /(^|\/)(assets|asset|static|public|common|brand)(\/|$)/.test(path)) score -= 180;
  return score;
}

function isTooSmallForCover(url: string, source: string | undefined, width: number | undefined, height: number | undefined): boolean {
  if (!width || !height) return false;
  if (/pbs\.twimg\.com\/media\//i.test(url)) return false;
  if (looksMetadataLike(source)) return width < 96 && height < 96;
  return width < 120 && height < 120;
}

function looksMetadataLike(source: string | undefined): boolean {
  const value = (source || "").toLowerCase();
  return value.includes("meta") || value.includes("metascraper");
}

function absolutize(value: string | undefined, baseUrl: string): string | undefined {
  if (!value || value.startsWith("data:")) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function cleanText(value: string | undefined | null): string | undefined {
  const clean = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function normalizeSnapshotCandidates(
  candidates: Array<ImageCandidate | null | undefined> | undefined,
  pageProtocol: "http:" | "https:" | undefined,
  startOrder: number
): InternalCoverCandidate[] {
  if (!candidates) return [];
  return candidates
    .map((candidate, index) =>
      normalizeCoverCandidate(candidate, { score: 520 - index * 4, source: "snapshot_candidate" }, pageProtocol, startOrder + index)
    )
    .filter((candidate): candidate is InternalCoverCandidate => Boolean(candidate));
}

async function collectHtmlCoverCandidates(
  url: string,
  html: string | undefined,
  pageProtocol: "http:" | "https:" | undefined,
  startOrder: number
): Promise<InternalCoverCandidate[]> {
  if (!html) return [];
  const candidates: InternalCoverCandidate[] = [];
  let order = startOrder;

  try {
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;
    const push = (candidate: ImageCandidate | null | undefined, defaults: CandidateDefaults) => {
      const normalized = normalizeCoverCandidate(candidate, defaults, pageProtocol, order++);
      if (normalized) candidates.push(normalized);
    };

    push(metaImageCandidate(document, url, 'meta[property="og:image"]'), { score: 820, source: "html_meta:og_image" });
    push(metaImageCandidate(document, url, 'meta[property="og:image:url"]'), { score: 815, source: "html_meta:og_image_url" });
    push(metaImageCandidate(document, url, 'meta[property="og:image:secure_url"]'), {
      score: 815,
      source: "html_meta:og_image_secure_url"
    });
    push(metaImageCandidate(document, url, 'meta[name="twitter:image"]'), { score: 805, source: "html_meta:twitter_image" });
    push(metaImageCandidate(document, url, 'meta[name="twitter:image:src"]'), { score: 805, source: "html_meta:twitter_image_src" });

    for (const candidate of jsonLdImageCandidates(document, url)) {
      push(candidate, { score: candidate.score ?? 900, source: candidate.source ?? "html_jsonld:image" });
    }

    for (const candidate of domImageCandidates(document, url)) {
      push(candidate, { score: candidate.score ?? 620, source: candidate.source ?? "html_image" });
    }

    const { image } = await metascraper({ url, html });
    push(image, { score: 760, source: "html_metascraper:image" });
  } catch (error) {
    // Surface the failure so a broken metascraper plugin or pathological HTML
    // payload is visible in dev logs; production still degrades to the
    // snapshot-candidate fallback rather than crashing the recognition flow.
    console.warn("[coverImage] metascraper failed on %s: %s", url, errorMessage(error));
  }

  return dedupeCandidates(candidates);
}

// Metascraper validates URLs and absolutizes them, but it still happily returns
// favicons, sprites, avatars, or tracking pixels when a site only exposes those.
// This filter is the final guard for both the metascraper result and any
// snapshot-only fallback URLs.
const weakImagePattern =
  /(?:^|[_.\-/%?=&])(avatar|badge|blank|brandmark|favicon|icon|logo|placeholder|profile[_-]?image|sprite|transparent)(?:[_.\-/%?=&]|$)/i;
const knownWeakImagePatterns = [
  // X emits this site-default Open Graph image for many logged-in post pages.
  // It is a platform placeholder, not the post's attached media.
  /^abs\.twimg\.com\/rweb\/ssr\/default\/v\d+\/og\/image\.png(?:\?|$)/i
];

function normalizeUsefulImageUrl(value: string | null | undefined, pageProtocol?: "http:" | "https:"): string | undefined {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  const path = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  if (knownWeakImagePatterns.some((pattern) => pattern.test(path))) return undefined;
  if (weakImagePattern.test(path)) return undefined;
  if (path.endsWith(".svg") || path.includes(".svg?")) return undefined;
  if (path.includes("1x1") || path.includes("pixel")) return undefined;
  // Mirror browser mixed-content policy: when the page was captured over https,
  // upgrade http image URLs to https so the saved cover can actually render in
  // the https web client. Most modern CDNs (e.g. B站 i2.hdslb.com) serve the
  // same asset on both protocols; the worst case is identical to today (broken
  // image), but the common case becomes a working cover.
  if (pageProtocol === "https:" && parsed.protocol === "http:") {
    parsed.protocol = "https:";
  }
  return parsed.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pageProtocolFromUrl(url: string): "http:" | "https:" | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.protocol;
  } catch {
    // fall through
  }
  return undefined;
}
