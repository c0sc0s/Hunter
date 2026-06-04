import createMetascraper from "metascraper";
import metascraperImage from "metascraper-image";
import { upgradeCdnCoverResolution } from "../../shared/coverImageUrl";

const metascraper = createMetascraper([metascraperImage()]);

export type CoverImageInput = {
  url: string;
  html?: string;
  snapshotCandidates?: Array<string | null | undefined>;
  preferred?: string | null;
};

// `selectCoverImage` runs as a single funnel:
//   1. pick the first useful URL across `preferred → og-style html → snapshot
//      candidates` after filtering favicons, svgs, and tracking pixels and
//      mirroring the browser's mixed-content policy;
//   2. apply CDN-shape rewrites (currently B站 hdslb resize directives) once
//      at the boundary so callers never see two different cover URLs for the
//      same image.
// Keeping the rewrite outside `normalizeUsefulImageUrl` keeps that helper
// focused on a single intent (filter + protocol upgrade); the CDN
// optimization is a separate concern.
export async function selectCoverImage(input: CoverImageInput): Promise<string | undefined> {
  const pageProtocol = pageProtocolFromUrl(input.url);
  const selected = await pickFirstUsefulCoverUrl(input, pageProtocol);
  return selected ? upgradeCdnCoverResolution(selected) : undefined;
}

export function selectCoverImageFromCandidates(
  candidates: Array<string | null | undefined> | undefined,
  pageProtocol?: "http:" | "https:"
): string | undefined {
  const selected = pickFirstUsefulFromCandidates(candidates, pageProtocol);
  return selected ? upgradeCdnCoverResolution(selected) : undefined;
}

export function isUsefulCoverImageUrl(value: string | undefined | null): value is string {
  return Boolean(normalizeUsefulImageUrl(value));
}

async function pickFirstUsefulCoverUrl(input: CoverImageInput, pageProtocol: "http:" | "https:" | undefined): Promise<string | undefined> {
  const preferred = normalizeUsefulImageUrl(input.preferred, pageProtocol);
  if (preferred) return preferred;

  const fromHtml = await selectCoverImageFromHtml(input.url, input.html, pageProtocol);
  if (fromHtml) return fromHtml;

  return pickFirstUsefulFromCandidates(input.snapshotCandidates, pageProtocol);
}

function pickFirstUsefulFromCandidates(
  candidates: Array<string | null | undefined> | undefined,
  pageProtocol: "http:" | "https:" | undefined
): string | undefined {
  if (!candidates) return undefined;
  for (const candidate of candidates) {
    const useful = normalizeUsefulImageUrl(candidate, pageProtocol);
    if (useful) return useful;
  }
  return undefined;
}

async function selectCoverImageFromHtml(
  url: string,
  html: string | undefined,
  pageProtocol: "http:" | "https:" | undefined
): Promise<string | undefined> {
  if (!html) return undefined;
  try {
    const { image } = await metascraper({ url, html });
    return normalizeUsefulImageUrl(image, pageProtocol);
  } catch (error) {
    // Surface the failure so a broken metascraper plugin or pathological HTML
    // payload is visible in dev logs; production still degrades to the
    // snapshot-candidate fallback rather than crashing the recognition flow.
    console.warn("[coverImage] metascraper failed on %s: %s", url, errorMessage(error));
    return undefined;
  }
}

// Metascraper validates URLs and absolutizes them, but it still happily returns
// favicons, sprites, avatars, or tracking pixels when a site only exposes those.
// This filter is the final guard for both the metascraper result and any
// snapshot-only fallback URLs.
const weakImagePattern =
  /(?:^|[_.\-/%?=&])(avatar|badge|blank|favicon|icon|logo|placeholder|profile[_-]?image|sprite|transparent)(?:[_.\-/%?=&]|$)/i;
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
