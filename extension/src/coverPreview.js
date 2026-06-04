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
 *   - `upgradeCdnCoverResolution` mirrors `shared/coverImageUrl.ts`. popup.js
 *     loads at runtime as a browser ES module and cannot import the shared
 *     TypeScript module directly (no extension bundler step exists yet). The
 *     parity test in `extension/tests/coverPreview.test.ts` imports both
 *     copies and asserts identical output on every fixture, so the build
 *     fails fast if the two ever drift.
 *
 *     When this file or `shared/coverImageUrl.ts` changes, update both and
 *     extend the parity fixture list. Future cleanup: add an extension
 *     bundler (or flip `allowJs: true` and convert the shared module to JS)
 *     so this copy can disappear entirely.
 */

const BILIBILI_CDN_HOST_PATTERN = /(^|\.)hdslb\.com$/i;
const BILIBILI_RESIZE_DIRECTIVE_PATTERN = /@([^/]+)$/;
const BILIBILI_CANONICAL_RESIZE = "@1280w.webp";
const BILIBILI_RESIZE_WIDTH_PATTERN = /(\d+)w/;
const BILIBILI_CANONICAL_RESIZE_MIN_WIDTH = 1280;

export function upgradeCdnCoverResolution(input) {
  let parsed;
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

export function collectCoverCandidatesInPage() {
  const metaContent = (selector) => document.querySelector(selector)?.getAttribute("content") || null;
  const candidates = [];
  const push = (value, score) => {
    for (const candidate of expandImageSource(value)) {
      const absolute = absolutize(candidate);
      if (absolute) {
        candidates.push({ value: absolute, score: score + scoreUrl(absolute), order: candidates.length });
      }
    }
  };

  push(metaContent('meta[property="og:image"]'), 900);
  push(metaContent('meta[property="og:image:url"]'), 895);
  push(metaContent('meta[property="og:image:secure_url"]'), 895);
  push(metaContent('meta[name="twitter:image"]'), 880);
  push(metaContent('meta[name="twitter:image:src"]'), 880);

  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    let parsed;
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
      const type = String(node["@type"] || "").toLowerCase();
      // Prioritize structured video/audio/article cover signals — same
      // intent as the server-side JSON-LD form picker in jsonLd.ts.
      if (/video|audio|article|news|blogposting|episode/.test(type)) {
        push(firstJsonLdImageUrl(node.thumbnailUrl), 920);
        push(firstJsonLdImageUrl(node.image), 910);
      }
    }
  }

  for (const entry of pageImageEntries(document.querySelector("article, main, [role='main']") || document.body, 620)) {
    push(entry.value, entry.score);
  }

  return Array.from(
    candidates
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .reduce((seen, candidate) => {
        if (!seen.has(candidate.value)) seen.set(candidate.value, candidate);
        return seen;
      }, new Map())
      .values()
  ).map((candidate) => candidate.value);

  // Mirror of server/sources/jsonLd.ts#firstJsonLdImageUrl. JSON-LD image refs
  // can be a bare URL string, an array of strings, or an ImageObject
  // `{ url | contentUrl, ... }`. Walk the shape and return the first URL found.
  function firstJsonLdImageUrl(value) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const url = firstJsonLdImageUrl(entry);
        if (url) return url;
      }
      return null;
    }
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      if (typeof value.url === "string") return value.url;
      if (typeof value.contentUrl === "string") return value.contentUrl;
    }
    return null;
  }

  function pageImageEntries(root, baseScore) {
    if (!root) return [];
    const imageEntries = Array.from(root.querySelectorAll("img, picture source")).flatMap((element) => {
      const width = element.naturalWidth || element.width || Number(element.getAttribute("width")) || 0;
      const height = element.naturalHeight || element.height || Number(element.getAttribute("height")) || 0;
      const hasSrcset = Boolean(element.srcset || element.getAttribute("srcset") || element.getAttribute("data-srcset"));
      const looksLikeMedia = /(^|\.)twimg\.com\/media\//i.test(
        `${element.currentSrc || ""} ${element.src || ""} ${element.getAttribute("src") || ""} ${element.getAttribute("srcset") || ""}`
      );
      if (!looksLikeMedia && !hasSrcset && width < 120 && height < 120) return [];
      const score = baseScore + Math.min(220, Math.round((Math.max(width, 1) * Math.max(height, 1)) / 1800)) + elementBonus(element);
      return [
        element.currentSrc,
        element.src,
        element.getAttribute("src"),
        element.getAttribute("data-src"),
        element.getAttribute("data-original"),
        element.getAttribute("data-lazy-src"),
        element.getAttribute("data-image-src"),
        element.getAttribute("data-full-src"),
        bestSrcsetUrl(element.srcset || element.getAttribute("srcset") || element.getAttribute("data-srcset"))
      ]
        .filter(Boolean)
        .map((value) => ({ value, score }));
    });
    const backgroundEntries = Array.from(root.querySelectorAll("[style*='background']")).flatMap((element) =>
      imageUrlsFromCss(element.getAttribute("style")).map((value) => ({ value, score: baseScore - 30 + elementBonus(element) }))
    );
    return [...imageEntries, ...backgroundEntries];
  }

  function expandImageSource(value) {
    const srcset = bestSrcsetUrl(value);
    return srcset ? [srcset] : [value].filter(Boolean);
  }

  function absolutize(value) {
    if (!value || String(value).startsWith("data:")) return null;
    try {
      return new URL(value, document.location?.href || "https://example.com/").toString();
    } catch {
      return null;
    }
  }

  function bestSrcsetUrl(value) {
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

  function imageUrlsFromCss(value) {
    if (!value) return [];
    return Array.from(String(value).matchAll(/url\((['"]?)(.*?)\1\)/g), (match) => match[2]).filter(Boolean);
  }

  function elementBonus(element) {
    let bonus = 0;
    if (element.closest("[data-testid='tweetPhoto'], a[href*='/photo/']")) bonus += 420;
    if (element.closest("article, main")) bonus += 80;
    return bonus;
  }

  function scoreUrl(value) {
    let parsed;
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
