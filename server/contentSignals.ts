import { JSDOM } from "jsdom";
import type { ExtractedContent } from "./extract";
import { cleanText } from "./sources/url";

export type ContentSignals = {
  summary: string;
  tags: string[];
  readingMinutes: number;
};

const readingWordsPerMinute = 220;
export const maxSummaryLength = 520;
const maxTags = 6;

const stopWords = new Set([
  "about",
  "after",
  "also",
  "before",
  "because",
  "click",
  "content",
  "continue",
  "cookie",
  "enough",
  "from",
  "have",
  "home",
  "example",
  "into",
  "less",
  "login",
  "more",
  "newsletter",
  "page",
  "post",
  "pricing",
  "privacy",
  "read",
  "research",
  "related",
  "share",
  "subscribe",
  "that",
  "their",
  "there",
  "this",
  "what",
  "when",
  "where",
  "which",
  "while",
  "will",
  "with",
  "should",
  "through",
  "your",
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "has",
  "was"
]);

const lowSignalDomainParts = new Set(["app", "blog", "cdn", "com", "dev", "docs", "html", "io", "net", "news", "org", "www"]);

export function buildContentSignals(content: ExtractedContent): ContentSignals {
  const segments = extractSignalSegments(content);
  const text =
    cleanText(segments.map((segment) => segment.text).join(" ")) || cleanText(content.readableText || content.excerpt || content.title);
  const wordCount = content.wordCount ?? countSignalWords(text);

  return {
    summary: pickMediaSummary(content) ?? buildSummary(segments, text, content.title),
    tags: buildTags(content, segments, text),
    readingMinutes: Math.max(1, Math.ceil(wordCount / readingWordsPerMinute))
  };
}

// For video items the page body is wrapper chrome (recommendations,
// comments, sidebar) — the uploader's description IS the editorial summary,
// so it must beat anything buildSummary would distill from contentHtml.
// The adapter already collapsed structured `VideoObject.description`,
// og:description, twitter:description, and snapshot.excerpt down to
// `content.excerpt`, so trusting that single field keeps this rule
// host-agnostic and avoids duplicating fallback chains here. Audio pages
// follow the same product rule but are still typed as "article" in
// SourceType today; promote them here when SourceType gains "audio".
function pickMediaSummary(content: ExtractedContent): string | undefined {
  if (content.sourceType !== "video") return undefined;
  const excerpt = cleanText(content.excerpt);
  return excerpt ? excerpt.slice(0, maxSummaryLength) : undefined;
}

function extractSignalSegments(content: ExtractedContent): SignalSegment[] {
  const htmlSegments = extractHtmlSegments(content.contentHtml);
  if (htmlSegments.length) return htmlSegments;

  return splitPlainText(content.readableText || content.excerpt || content.title).map((text, index) => ({
    text,
    kind: index === 0 ? "lead" : "paragraph"
  }));
}

function extractHtmlSegments(html: string | undefined): SignalSegment[] {
  if (!html) return [];
  const document = new JSDOM(html).window.document;
  const elements = [...document.querySelectorAll("h1,h2,h3,p,li,blockquote")];

  return elements
    .map((element) => ({
      text: cleanText(element.textContent ?? ""),
      kind: segmentKind(element.tagName.toLowerCase())
    }))
    .filter((segment) => segment.text.length >= 24 && !isLowSignalText(segment.text));
}

function splitPlainText(text: string): string[] {
  return (text || "")
    .split(/\n{2,}|(?<=[.!?。！？])\s+(?=[A-Z\u4e00-\u9fff])/)
    .map((segment) => cleanText(segment))
    .filter((segment) => segment.length >= 24 && !isLowSignalText(segment));
}

function buildSummary(segments: SignalSegment[], text: string, title: string): string {
  if (!text) return `Saved for later: ${title}`;

  const lead = segments.find((segment) => segment.kind === "paragraph" || segment.kind === "lead")?.text ?? text;
  const sentences = splitSentences(lead);
  const summary = cleanText(sentences.slice(0, 3).join(" "));
  return (summary || text).slice(0, maxSummaryLength);
}

function splitSentences(text: string): string[] {
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [text];
  return sentences.map((sentence) => cleanText(sentence)).filter((sentence) => sentence.length >= 16);
}

function buildTags(content: ExtractedContent, segments: SignalSegment[], text: string): string[] {
  const scores = new Map<string, number>();
  addScore(scores, content.sourceType, 4);

  for (const part of domainParts(content.url)) {
    addScore(scores, part, 2);
  }

  scoreText(scores, content.title, 4);
  for (const segment of segments) {
    scoreText(scores, segment.text, segment.kind === "heading" ? 3 : 1);
  }
  scoreText(scores, text, 0.5);

  return [...scores.entries()]
    .filter(([tag]) => isUsefulTag(tag))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTags)
    .map(([tag]) => tag);
}

function scoreText(scores: Map<string, number>, value: string | undefined, weight: number): void {
  const corpus = cleanText(value).toLowerCase();
  if (!corpus) return;

  for (const word of corpus.match(/[a-z][a-z0-9-]{3,}/g) ?? []) {
    if (stopWords.has(word)) continue;
    addScore(scores, word, weight);
  }

  for (const phrase of corpus.match(/[\u4e00-\u9fff]{2,6}/g) ?? []) {
    if (isLowSignalCjkPhrase(phrase)) continue;
    addScore(scores, phrase, weight);
  }
}

function addScore(scores: Map<string, number>, tag: string | undefined, score: number): void {
  const normalized = normalizeTag(tag);
  if (!normalized) return;
  scores.set(normalized, (scores.get(normalized) ?? 0) + score);
}

function normalizeTag(value: string | undefined): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/^[@#]+/, "")
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isUsefulTag(tag: string): boolean {
  if (tag.length < 2 || tag.length > 32) return false;
  if (stopWords.has(tag) || lowSignalDomainParts.has(tag)) return false;
  if (/^\d+$/.test(tag)) return false;
  return true;
}

function domainParts(url: string): string[] {
  return new URL(url).hostname
    .replace(/^www\./, "")
    .split(".")
    .filter((part) => part.length > 3 && !lowSignalDomainParts.has(part));
}

function segmentKind(tagName: string): SignalSegment["kind"] {
  return /^h[1-3]$/.test(tagName) ? "heading" : "paragraph";
}

function countSignalWords(text: string): number {
  const latinWords = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  const cjkChars = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return latinWords + Math.ceil(cjkChars / 2);
}

function isLowSignalText(value: string): boolean {
  return /^(home|pricing|login|subscribe|related posts|advertisement|cookie|privacy)/i.test(value);
}

function isLowSignalCjkPhrase(value: string): boolean {
  return /^(更多|登录|注册|关注|评论|分享|收藏|打开|查看|阅读全文|点击|一个|这个|我们|他们|你们|可以|已经)$/.test(value);
}

type SignalSegment = {
  text: string;
  kind: "heading" | "lead" | "paragraph";
};
