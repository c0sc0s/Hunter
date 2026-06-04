import { collectJsonLdTypes, matchJsonLdFormType, readJsonLdNodes } from "./jsonLd";

export type ContentForm = "video" | "audio" | "article" | "discussion" | "product" | "image" | "unknown";

export type ContentFormSignalSource = "og_type" | "twitter_card" | "json_ld" | "oembed_link" | "video_element";

export type ContentFormSignal = {
  source: ContentFormSignalSource;
  value: string;
};

export type ContentFormDetection = {
  form: ContentForm;
  confidence: number;
  signals: ContentFormSignal[];
  oembedDiscoveryUrl?: string;
};

const DECIDE_THRESHOLD = 0.5;

const SCORED_FORMS: Exclude<ContentForm, "unknown">[] = ["video", "audio", "article", "discussion", "product", "image"];

export function detectContentForm(document: Document): ContentFormDetection {
  const signals: ContentFormSignal[] = [];
  const scores = new Map<ContentForm, number>(SCORED_FORMS.map((form) => [form, 0]));

  recordOgType(document, signals, scores);
  recordTwitterCard(document, signals, scores);
  recordJsonLdTypes(document, signals, scores);
  const oembedDiscoveryUrl = recordOembedLink(document, signals);
  recordVideoElements(document, signals, scores);

  const ranked = [...scores.entries()].sort(([, a], [, b]) => b - a);
  const [topForm, topScore] = ranked[0] ?? ["unknown", 0];

  if (topScore < DECIDE_THRESHOLD) {
    return { form: "unknown", confidence: 0, signals, oembedDiscoveryUrl };
  }

  return {
    form: topForm,
    confidence: Math.min(1, topScore),
    signals,
    oembedDiscoveryUrl
  };
}

function recordOgType(document: Document, signals: ContentFormSignal[], scores: Map<ContentForm, number>): void {
  const value = metaContent(document, 'meta[property="og:type"]');
  if (!value) return;

  signals.push({ source: "og_type", value });

  if (value.startsWith("video")) {
    addScore(scores, "video", 0.7);
    return;
  }
  if (value.startsWith("music") || value.startsWith("audio")) {
    addScore(scores, "audio", 0.7);
    return;
  }
  if (value === "article") {
    addScore(scores, "article", 0.5);
    return;
  }
  if (value === "product") {
    addScore(scores, "product", 0.6);
    return;
  }
}

function recordTwitterCard(document: Document, signals: ContentFormSignal[], scores: Map<ContentForm, number>): void {
  const value = metaContent(document, 'meta[name="twitter:card"]');
  if (!value) return;

  signals.push({ source: "twitter_card", value });
  if (value === "player") addScore(scores, "video", 0.4);
}

const jsonLdScoreByForm: Partial<Record<ContentForm, number>> = {
  video: 0.8,
  audio: 0.7,
  article: 0.5,
  discussion: 0.6,
  product: 0.6,
  image: 0.4
};

function recordJsonLdTypes(document: Document, signals: ContentFormSignal[], scores: Map<ContentForm, number>): void {
  for (const node of readJsonLdNodes(document)) {
    for (const type of collectJsonLdTypes(node)) {
      signals.push({ source: "json_ld", value: type });
      const form = matchJsonLdFormType(type);
      if (!form) continue;
      const delta = jsonLdScoreByForm[form];
      if (delta) addScore(scores, form, delta);
    }
  }
}

function recordOembedLink(document: Document, signals: ContentFormSignal[]): string | undefined {
  const link = document.querySelector('link[type="application/json+oembed"]') ?? document.querySelector('link[type="text/xml+oembed"]');
  const href = link?.getAttribute("href")?.trim();
  if (!href) return undefined;
  signals.push({ source: "oembed_link", value: href });
  return href;
}

function recordVideoElements(document: Document, signals: ContentFormSignal[], scores: Map<ContentForm, number>): void {
  const count = document.querySelectorAll("video").length;
  if (count === 0) return;
  signals.push({ source: "video_element", value: String(count) });
  // Tiebreaker only: many articles embed <video>; require structured signals to confirm.
  addScore(scores, "video", 0.2);
}

function metaContent(document: Document, selector: string): string | undefined {
  const raw = document.querySelector<HTMLMetaElement>(selector)?.content?.trim().toLowerCase();
  return raw && raw.length > 0 ? raw : undefined;
}

function addScore(scores: Map<ContentForm, number>, form: ContentForm, delta: number): void {
  scores.set(form, (scores.get(form) ?? 0) + delta);
}
