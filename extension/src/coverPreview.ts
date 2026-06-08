/**
 * Helpers for the Hunter popup's cover preview.
 *
 * Two responsibilities live here so popup.js can stay focused on wiring DOM
 * events and so this logic stays unit-testable without spinning up a Chrome
 * popup harness:
 *
 *   - `collectCoverCandidatesInPage` runs inside the captured tab (via
 *     `chrome.scripting.executeScript({ func })`). It must be a standalone
 *     function with no closures over module-scope symbols, because Chrome
 *     stringifies it before injecting.
 *
 *   - `upgradeCdnCoverResolution` mirrors `shared/coverImageUrl.ts`. The
 *     popup bundle keeps a local copy so injected/popup code stays independent
 *     of app/server module resolution. The parity test in
 *     `extension/tests/coverPreview.test.ts` imports both copies and asserts
 *     identical output on every fixture, so the build fails fast if the two
 *     ever drift.
 *
 *     When this file or `shared/coverImageUrl.ts` changes, update both and
 *     extend the parity fixture list. Future cleanup: add an extension
 *     shared helper.
 */

const BILIBILI_CDN_HOST_PATTERN = /(^|\.)hdslb\.com$/i;
const BILIBILI_RESIZE_DIRECTIVE_PATTERN = /@([^/]+)$/;
const BILIBILI_CANONICAL_RESIZE = "@1280w.webp";
const BILIBILI_RESIZE_WIDTH_PATTERN = /(\d+)w/;
const BILIBILI_CANONICAL_RESIZE_MIN_WIDTH = 1280;

export type CoverCandidate = {
  url: string;
  score: number;
  source: string;
  width?: number;
  height?: number;
  alt?: string;
  context?: string;
  inContentRoot: boolean;
  order: number;
};

type CoverCandidateDetails = {
  score: number;
  source: string;
  width?: number;
  height?: number;
  alt?: string;
  context?: string;
  inContentRoot?: boolean;
};

type PageImageEntry = CoverCandidateDetails & {
  value: string;
};

export function upgradeCdnCoverResolution(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return input;
  }
  if (!BILIBILI_CDN_HOST_PATTERN.test(parsed.hostname)) return input;
  const match = BILIBILI_RESIZE_DIRECTIVE_PATTERN.exec(parsed.pathname);
  if (!match) return input;
  const widthMatch = BILIBILI_RESIZE_WIDTH_PATTERN.exec(match[1]);
  if (widthMatch && Number(widthMatch[1]) >= BILIBILI_CANONICAL_RESIZE_MIN_WIDTH) return input;
  parsed.pathname = parsed.pathname.replace(BILIBILI_RESIZE_DIRECTIVE_PATTERN, BILIBILI_CANONICAL_RESIZE);
  return parsed.toString();
}

export function collectCoverCandidatesInPage(): CoverCandidate[] {
  const metaContent = (selector: string) => document.querySelector(selector)?.getAttribute("content") || null;
  const candidates: CoverCandidate[] = [];
  const push = (value: unknown, details: CoverCandidateDetails) => {
    for (const candidate of expandImageSource(value)) {
      const absolute = absolutize(candidate);
      if (absolute) {
        candidates.push({
          url: absolute,
          score: details.score + scoreUrl(absolute),
          source: details.source,
          width: details.width,
          height: details.height,
          alt: details.alt,
          context: details.context,
          inContentRoot: Boolean(details.inContentRoot),
          order: candidates.length
        });
      }
    }
  };

  push(metaContent('meta[property="og:image"]'), metadataDetails("metadata:og_image", 900));
  push(metaContent('meta[property="og:image:url"]'), metadataDetails("metadata:og_image_url", 895));
  push(metaContent('meta[property="og:image:secure_url"]'), metadataDetails("metadata:og_image_secure_url", 895));
  push(metaContent('meta[name="twitter:image"]'), metadataDetails("metadata:twitter_image", 880));
  push(metaContent('meta[name="twitter:image:src"]'), metadataDetails("metadata:twitter_image_src", 880));

  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent || "null");
    } catch {
      // A single malformed JSON-LD block must not poison sibling blocks;
      // skip and keep walking.
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const record = node as Record<string, unknown>;
      const type = String(record["@type"] || "").toLowerCase();
      // Prioritize structured video/audio/article cover signals — same
      // intent as the server-side JSON-LD form picker in jsonLd.ts.
      if (/video|audio|article|news|blogposting|episode/.test(type)) {
        push(firstJsonLdImageUrl(record.thumbnailUrl), { score: 920, source: `jsonld:${type}_thumbnail`, context: type });
        push(firstJsonLdImageUrl(record.image), { score: 910, source: `jsonld:${type}_image`, context: type });
      }
    }
  }

  const contentRoot = document.querySelector("article, main, [role='main']");
  for (const entry of pageImageEntries(contentRoot || document.body, 620, "content_image", "content_background", true)) {
    push(entry.value, entry);
  }
  if (document.body && document.body !== contentRoot) {
    for (const entry of pageImageEntries(document.body, 360, "page_image", "page_background", false)) {
      push(entry.value, entry);
    }
  }

  return Array.from(
    candidates
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .reduce((seen, candidate) => {
        if (!seen.has(candidate.url)) seen.set(candidate.url, candidate);
        return seen;
      }, new Map<string, CoverCandidate>())
      .values()
  ).filter((candidate) => candidate.score >= 220);

  function metadataDetails(source: string, score: number): CoverCandidateDetails {
    return {
      score,
      source,
      width: numericMeta('meta[property="og:image:width"]'),
      height: numericMeta('meta[property="og:image:height"]')
    };
  }

  function numericMeta(selector: string): number | undefined {
    const value = metaContent(selector);
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  // Mirror of server/sources/jsonLd.ts#firstJsonLdImageUrl. JSON-LD image refs
  // can be a bare URL string, an array of strings, or an ImageObject
  // `{ url | contentUrl, ... }`. Walk the shape and return the first URL found.
  function firstJsonLdImageUrl(value: unknown): string | null {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const url = firstJsonLdImageUrl(entry);
        if (url) return url;
      }
      return null;
    }
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const record = value as { url?: unknown; contentUrl?: unknown };
      if (typeof record.url === "string") return record.url;
      if (typeof record.contentUrl === "string") return record.contentUrl;
    }
    return null;
  }

  function pageImageEntries(
    root: Element | null,
    baseScore: number,
    imageSource: string,
    backgroundSource: string,
    inContentRoot: boolean
  ): PageImageEntry[] {
    if (!root) return [];
    const imageEntries = Array.from(root.querySelectorAll("img, picture source")).flatMap((element) => {
      const image = element as HTMLImageElement & HTMLSourceElement;
      const width = image.naturalWidth || image.width || Number(element.getAttribute("width")) || 0;
      const height = image.naturalHeight || image.height || Number(element.getAttribute("height")) || 0;
      const hasSrcset = Boolean(image.srcset || element.getAttribute("srcset") || element.getAttribute("data-srcset"));
      const looksLikeMedia = /(^|\.)twimg\.com\/media\//i.test(
        `${image.currentSrc || ""} ${image.src || ""} ${element.getAttribute("src") || ""} ${element.getAttribute("srcset") || ""}`
      );
      if (!looksLikeMedia && !hasSrcset && width < 120 && height < 120) return [];
      const score = baseScore + Math.min(220, Math.round((Math.max(width, 1) * Math.max(height, 1)) / 1800)) + elementBonus(element);
      const context = elementContext(element);
      return [
        image.currentSrc,
        image.src,
        element.getAttribute("src"),
        element.getAttribute("data-src"),
        element.getAttribute("data-original"),
        element.getAttribute("data-lazy-src"),
        element.getAttribute("data-image-src"),
        element.getAttribute("data-full-src"),
        bestSrcsetUrl(image.srcset || element.getAttribute("srcset") || element.getAttribute("data-srcset"))
      ]
        .filter((value): value is string => Boolean(value))
        .map((value) => ({
          value,
          score,
          source: imageSource,
          width,
          height,
          alt: cleanText(image.alt || element.getAttribute("aria-label")),
          context,
          inContentRoot
        }));
    });
    const backgroundEntries: PageImageEntry[] = Array.from(root.querySelectorAll("[style*='background']")).flatMap((element) =>
      imageUrlsFromCss(element.getAttribute("style")).map((value) => ({
        value,
        score: baseScore - 30 + elementBonus(element),
        source: backgroundSource,
        context: elementContext(element),
        inContentRoot
      }))
    );
    return [...imageEntries, ...backgroundEntries];
  }

  function expandImageSource(value: unknown): string[] {
    const srcset = bestSrcsetUrl(value);
    return srcset ? [srcset] : [value].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  }

  function absolutize(value: unknown): string | null {
    if (!value || String(value).startsWith("data:")) return null;
    try {
      return new URL(String(value), document.location?.href || "https://example.com/").toString();
    } catch {
      return null;
    }
  }

  function bestSrcsetUrl(value: unknown): string | null {
    if (!value || !String(value).includes(",")) return null;
    return String(value)
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
    return Array.from(String(value).matchAll(/url\((['"]?)(.*?)\1\)/g), (match) => match[2]).filter(Boolean);
  }

  function elementBonus(element: Element): number {
    let bonus = 0;
    if (element.closest("[data-testid='tweetPhoto'], a[href*='/photo/']")) bonus += 420;
    if (element.closest("article, main")) bonus += 80;
    if (/image|photo|cover|hero/i.test(elementContext(element) || "")) bonus += 240;
    return bonus;
  }

  function elementContext(element: Element): string {
    return cleanText(
      `${(element as HTMLImageElement).alt || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("data-testid") || ""} ${
        element.className || ""
      } ${element.id || ""} ${
        element.closest("[data-testid='tweetPhoto'], a[href*='/photo/'], figure, article, main")?.getAttribute("data-testid") || ""
      }`
    );
  }

  function cleanText(value: unknown): string {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreUrl(value: string): number {
    let parsed: URL;
    try {
      parsed = new URL(value, document.location?.href || "https://example.com/");
    } catch {
      return 0;
    }
    const path = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
    let score = 0;
    if (/pbs\.twimg\.com\/media\//.test(path)) score += 520;
    if (/abs\.twimg\.com\/rweb\/ssr\/default\/v\d+\/og\/image\.png/.test(path)) score -= 900;
    if (
      /(^|[_.\-/%?=&])(avatar|badge|blank|favicon|icon|logo|placeholder|profile[_-]?image|sprite|transparent)([_.\-/%?=&]|$)/.test(path)
    ) {
      score -= 650;
    }
    if (path.endsWith(".svg") || path.includes(".svg?") || path.includes("1x1") || path.includes("pixel")) score -= 650;
    return score;
  }
}
