import createMetascraper from "metascraper";
import metascraperImage from "metascraper-image";

const metascraper = createMetascraper([metascraperImage()]);

export type CoverImageInput = {
  url: string;
  html?: string;
  snapshotCandidates?: Array<string | null | undefined>;
  preferred?: string | null;
};

export async function selectCoverImage(input: CoverImageInput): Promise<string | undefined> {
  const preferred = normalizeUsefulImageUrl(input.preferred);
  if (preferred) return preferred;

  const fromHtml = await selectCoverImageFromHtml(input.url, input.html);
  if (fromHtml) return fromHtml;

  return selectCoverImageFromCandidates(input.snapshotCandidates);
}

export function selectCoverImageFromCandidates(
  candidates: Array<string | null | undefined> | undefined
): string | undefined {
  if (!candidates) return undefined;
  for (const candidate of candidates) {
    const useful = normalizeUsefulImageUrl(candidate);
    if (useful) return useful;
  }
  return undefined;
}

export function isUsefulCoverImageUrl(value: string | undefined | null): value is string {
  return Boolean(normalizeUsefulImageUrl(value));
}

async function selectCoverImageFromHtml(url: string, html: string | undefined): Promise<string | undefined> {
  if (!html) return undefined;
  try {
    const { image } = await metascraper({ url, html });
    return normalizeUsefulImageUrl(image);
  } catch {
    return undefined;
  }
}

// Metascraper validates URLs and absolutizes them, but it still happily returns
// favicons, sprites, avatars, or tracking pixels when a site only exposes those.
// This filter is the final guard for both the metascraper result and any
// snapshot-only fallback URLs.
const weakImagePattern =
  /(?:^|[_.\-/%?=&])(avatar|badge|blank|favicon|icon|logo|placeholder|profile[_-]?image|sprite|transparent)(?:[_.\-/%?=&]|$)/i;

function normalizeUsefulImageUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  const path = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  if (weakImagePattern.test(path)) return undefined;
  if (path.endsWith(".svg") || path.includes(".svg?")) return undefined;
  if (path.includes("1x1") || path.includes("pixel")) return undefined;
  return parsed.toString();
}
