import type { ContentForm } from "./contentForm";

export type JsonLdNode = Record<string, unknown>;

export type JsonLdMetadata = {
  title?: string;
  description?: string;
  authorName?: string;
  publisherName?: string;
  datePublished?: string;
  dateModified?: string;
  formAuthorName?: string;
  formUploadDate?: string;
  formThumbnailUrl?: string;
  formDescription?: string;
};

export function readJsonLdNodes(document: Document): JsonLdNode[] {
  const scripts = [...document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')];
  const nodes: JsonLdNode[] = [];

  for (const script of scripts) {
    const text = script.textContent;
    if (!text) continue;
    try {
      nodes.push(...flattenJsonLdNodes(JSON.parse(text)));
    } catch {
      continue;
    }
  }

  return nodes;
}

export function flattenJsonLdNodes(value: unknown): JsonLdNode[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenJsonLdNodes);
  if (typeof value !== "object") return [];

  const record = value as JsonLdNode;
  const graph = flattenJsonLdNodes(record["@graph"]);
  return [record, ...graph];
}

export function collectJsonLdTypes(node: JsonLdNode): string[] {
  const type = node["@type"];
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((value): value is string => typeof value === "string");
  return [];
}

// Single registry for JSON-LD @type → ContentForm mapping. Both contentForm
// scoring and form-aware node selection consume this map so a new schema.org
// type only has to be added in one place.
export const jsonLdTypePatterns = {
  video: /^(videoobject|movie|tvepisode|episode|musicvideoobject)$/i,
  audio: /^(audioobject|podcastepisode|musicrecording|musicalbum|radioseries)$/i,
  article: /^(article|newsarticle|blogposting|techarticle|report|opinionnewsarticle)$/i,
  discussion: /^(discussionforumposting|qapage|socialmediaposting)$/i,
  product: /^product$/i,
  image: /^imageobject$/i
} as const satisfies Partial<Record<ContentForm, RegExp>>;

export function pickJsonLdNodeForForm(nodes: JsonLdNode[], form: ContentForm): JsonLdNode | undefined {
  const pattern = jsonLdTypePatterns[form as keyof typeof jsonLdTypePatterns];
  if (!pattern) return undefined;
  return nodes.find((node) => collectJsonLdTypes(node).some((type) => pattern.test(type)));
}

export function matchJsonLdFormType(type: string): ContentForm | undefined {
  for (const [form, pattern] of Object.entries(jsonLdTypePatterns) as Array<[ContentForm, RegExp]>) {
    if (pattern.test(type)) return form;
  }
  return undefined;
}

const articleJsonLdPattern = jsonLdTypePatterns.article;

export function isArticleJsonLdNode(node: JsonLdNode): boolean {
  return collectJsonLdTypes(node).some((type) => articleJsonLdPattern.test(type));
}

// Parses a subset of ISO 8601 duration values commonly seen in VideoObject/AudioObject metadata,
// e.g. "PT1H2M30S" or "PT45S". Returns seconds, or undefined when the value is missing/invalid.
export function parseIsoDurationSeconds(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value.trim());
  if (!match) return undefined;
  const [, h, m, s] = match;
  const hours = h ? Number(h) : 0;
  const minutes = m ? Number(m) : 0;
  const seconds = s ? Number(s) : 0;
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

// Extracts the metadata fields downstream adapters care about from the
// document's JSON-LD blocks. The picked node priority is:
//   1. a form-shaped node (VideoObject for `form="video"`, etc.) so the
//      page's primary resource wins over a sibling Article that only
//      describes the wrapper page;
//   2. the first Article-shaped node when no form-shape matches;
//   3. the first node found, so we still surface a title/description even
//      when nothing fits cleanly.
// `formAuthorName/formUploadDate/formThumbnailUrl` are populated *only* when
// a form-shaped node was picked, letting callers prefer them over page-wide
// defaults (e.g. <meta name="author"> from a site template).
export function extractJsonLdMetadata(document: Document, form: ContentForm): JsonLdMetadata {
  const nodes = readJsonLdNodes(document);
  const formNode = pickJsonLdNodeForForm(nodes, form);
  const fallbackNode = formNode ?? nodes.find(isArticleJsonLdNode) ?? nodes[0];
  if (!fallbackNode) return {};

  return {
    title: asText(fallbackNode.headline) ?? asText(fallbackNode.name),
    description: safeDecodeIfUriEncoded(asText(fallbackNode.description)),
    authorName: firstJsonLdText(fallbackNode.author, "name"),
    publisherName: firstJsonLdText(fallbackNode.publisher, "name"),
    datePublished: asText(fallbackNode.datePublished),
    dateModified: asText(fallbackNode.dateModified),
    ...extractFormNodeFields(formNode)
  };
}

// "form-shape" fields (uploader name, upload date, primary thumbnail, the
// uploader-authored description) all share the same precondition: they only
// make sense when a form-shaped JSON-LD node (VideoObject/AudioObject/...)
// was picked. Hoisting them into one function removes the four-way `formNode
// ? ... : undefined` repetition and makes it obvious that adding another
// form-only field belongs here.
function extractFormNodeFields(formNode: JsonLdNode | undefined): Partial<JsonLdMetadata> {
  if (!formNode) return {};
  return {
    formAuthorName: firstJsonLdText(formNode.author, "name"),
    formUploadDate: asText(formNode.uploadDate) ?? asText(formNode.datePublished) ?? asText(formNode.dateModified),
    formThumbnailUrl: firstJsonLdImageUrl(formNode.thumbnailUrl) ?? firstJsonLdImageUrl(formNode.image),
    formDescription: safeDecodeIfUriEncoded(asText(formNode.description))
  };
}

// Some publishers (notably B站 / Bilibili) ship JSON-LD text values that are
// percent-encoded ("2026%E5%B9%B46%E6%9C%88..." instead of "2026年6月..."),
// which leaves the description unreadable to humans and breaks search. We
// detect this with a conservative heuristic — strings that contain percent-
// hex pairs AND zero whitespace characters are almost certainly URL-encoded,
// because natural text always contains spaces while encoded text encodes
// spaces as %20. Decoding malformed sequences throws (e.g. a literal
// "50% off"), in which case we fall back to the original string silently.
function safeDecodeIfUriEncoded(value: string | undefined): string | undefined {
  if (!value) return value;
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
  if (/\s/.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// JSON-LD image references can be a bare URL string, an array of strings, or
// an ImageObject `{ url | contentUrl, ... }`. Walk the shape and return the
// first URL found, so callers can stay agnostic to the variant the page used.
export function firstJsonLdImageUrl(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.map(firstJsonLdImageUrl).find(Boolean);
  }
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return asText(record.url) ?? asText(record.contentUrl);
  }
  return undefined;
}

// JSON-LD person/organization references can be a bare name string, an array
// of person nodes, or `{ name: ..., url: ... }`. Resolve the first matching
// `key` (typically "name") regardless of shape.
export function firstJsonLdText(value: unknown, key: string): string | undefined {
  if (Array.isArray(value)) {
    return value.map((entry) => firstJsonLdText(entry, key)).find(Boolean);
  }
  if (typeof value === "object" && value) {
    return asText((value as Record<string, unknown>)[key]);
  }
  return asText(value);
}

// Treat empty strings as "missing" so downstream `??` fallback chains
// continue searching for a usable value. YouTube, for example, ships
// VideoObject.description as "" because their description is rendered
// client-side; without this collapse, the empty string would shadow the
// real og:description that genericWeb falls back to.
function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : undefined;
}
