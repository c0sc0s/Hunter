export type CoverImageCandidateSource =
  | "structured_data"
  | "open_graph"
  | "twitter_card"
  | "parser"
  | "article_image"
  | "snapshot_image"
  | "oembed"
  | "source_specific";

export type CoverImageCandidate = {
  url?: string | null;
  source: CoverImageCandidateSource;
};

const sourceScores: Record<CoverImageCandidateSource, number> = {
  oembed: 100,
  structured_data: 95,
  open_graph: 90,
  twitter_card: 86,
  source_specific: 82,
  parser: 78,
  article_image: 66,
  snapshot_image: 42
};

const weakImagePattern =
  /(?:^|[_.\-/%?=&])(avatar|badge|blank|favicon|icon|logo|placeholder|profile[_-]?image|sprite|transparent)(?:[_.\-/%?=&]|$)/i;
const strongContentPattern = /(?:^|[_.\-/%?=&])(article|banner|card|cover|hero|media|og|photo|post|thumbnail|thumb)(?:[_.\-/%?=&]|$)/i;

export function pickCoverImage(candidates: CoverImageCandidate[] | undefined): string | undefined {
  const seen = new Set<string>();
  return (candidates ?? [])
    .map((candidate, index) => scoreCandidate(candidate, index))
    .filter((candidate): candidate is ScoredCoverImageCandidate => Boolean(candidate))
    .filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.url;
}

export function isUsefulCoverImageUrl(value: string | undefined | null): value is string {
  return Boolean(scoreUrl(value));
}

function scoreCandidate(candidate: CoverImageCandidate, index: number): ScoredCoverImageCandidate | undefined {
  const urlScore = scoreUrl(candidate.url);
  if (!urlScore) return undefined;

  return {
    url: normalizeImageUrl(candidate.url),
    score: sourceScores[candidate.source] + urlScore,
    index
  };
}

function scoreUrl(value: string | undefined | null): number {
  const normalized = normalizeImageUrl(value);
  if (!normalized) return 0;
  const parsed = new URL(normalized);
  const path = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return 0;
  if (weakImagePattern.test(path)) return 0;
  if (path.endsWith(".svg") || path.includes(".svg?")) return 0;
  if (path.includes("1x1") || path.includes("pixel")) return 0;

  return strongContentPattern.test(path) ? 24 : 10;
}

function normalizeImageUrl(value: string | undefined | null): string {
  if (!value) return "";
  try {
    return new URL(value).toString();
  } catch {
    return "";
  }
}

type ScoredCoverImageCandidate = {
  url: string;
  score: number;
  index: number;
};
