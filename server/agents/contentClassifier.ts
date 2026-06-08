import { JSDOM } from "jsdom";
import { z } from "zod";
import type { AgentClassification, AgentClassificationResult, AgentContentCategorySummary, LibraryItem } from "../../shared/types";
import { cleanText } from "../sources/url";
import { normalizeAgentContentCategory } from "./contentCategories";
import { generateLocalJson, resolveLocalLlmConfig, type LocalLlmConfig } from "./localLlm";

export const agentCategorySchema = z.enum([
  "technical",
  "product",
  "business",
  "research",
  "news",
  "opinion",
  "tutorial",
  "reference",
  "social",
  "media",
  "other"
]);

export const agentIntentSchema = z.enum(["read_later", "learn", "reference", "follow_up", "summarize", "watch", "share", "other"]);

export const agentClassificationSchema = z
  .object({
    primaryCategory: agentCategorySchema,
    contentCategory: z
      .object({
        existingCategoryId: z.string().min(1).max(80).nullable().optional(),
        label: z.string().min(1).max(48),
        description: z.string().min(1).max(180).optional()
      })
      .strip(),
    intent: agentIntentSchema,
    topics: z.array(z.string().min(1).max(48)).max(8),
    summary: z.string().min(1).max(800),
    keyPoints: z.array(z.string().min(1).max(220)).max(6),
    confidence: z.number().min(0).max(1),
    language: z.string().min(2).max(32).optional(),
    needsFollowUp: z.boolean()
  })
  .strip();

const maxContentChars = 8_000;
type AgentClassificationModelOutput = z.infer<typeof agentClassificationSchema>;

export async function classifyLibraryItem(
  item: LibraryItem,
  options: { config?: LocalLlmConfig; existingCategories?: AgentContentCategorySummary[] } = {}
): Promise<AgentClassificationResult> {
  const resolvedConfig = options.config ?? resolveLocalLlmConfig();
  const existingCategories = options.existingCategories ?? [];
  const { system, prompt } = buildClassificationPrompt(item, existingCategories);
  const classification = await generateLocalJson(
    {
      system,
      prompt,
      schema: agentClassificationSchema
    },
    resolvedConfig
  );

  return {
    provider: resolvedConfig.provider,
    model: resolvedConfig.model,
    generatedAt: new Date().toISOString(),
    contentHash: item.contentHash,
    classification: normalizeClassification(classification, existingCategories)
  };
}

export function buildClassificationPrompt(
  item: LibraryItem,
  existingCategories: AgentContentCategorySummary[] = []
): { system: string; prompt: string } {
  const content = buildClassificationText(item);
  const categoryList = formatExistingCategories(existingCategories);
  const system = [
    "You are Hunter's local content understanding agent.",
    "Use only the captured item fields provided by Hunter.",
    "Prefer an existing user-facing content category when it is a clear fit.",
    "Create a new concise content category only when none of the existing categories fit.",
    "Do not claim full source access, live web access, or hidden context.",
    "Return one compact JSON object only."
  ].join(" ");

  const prompt = `
Classify and understand this saved reading item.

Allowed primaryCategory values:
technical, product, business, research, news, opinion, tutorial, reference, social, media, other

Allowed intent values:
read_later, learn, reference, follow_up, summarize, watch, share, other

Return JSON with this exact shape:
{
  "primaryCategory": "technical",
  "contentCategory": {
    "existingCategoryId": null,
    "label": "AI Engineering",
    "description": "Local LLMs, model tooling, and applied AI systems"
  },
  "intent": "learn",
  "topics": ["topic"],
  "summary": "One concise summary based only on captured text.",
  "keyPoints": ["important point"],
  "confidence": 0.0,
  "language": "en",
  "needsFollowUp": false
}

For contentCategory:
- If an existing category clearly fits, set existingCategoryId to its id and reuse its label exactly.
- If none fit, set existingCategoryId to null and create a short, reusable noun phrase.
- Avoid overly broad labels like "Article", "Reading", "News", or "Other" unless the content is genuinely uncategorizable.

Set needsFollowUp=true and lower confidence when captured text is too thin, noisy, or incomplete.

Existing content categories:
${categoryList}

Item metadata:
title: ${item.title}
url: ${item.url}
sourceName: ${item.sourceName}
sourceType: ${item.sourceType}
extractionState: ${item.enrichmentState}
existingSummary: ${item.summary}
existingTags: ${item.tags.join(", ")}

Captured text:
${content || "(no captured text)"}
`.trim();

  return { system, prompt };
}

export function buildClassificationText(item: LibraryItem): string {
  const candidates = [
    item.readableText,
    item.excerpt,
    htmlToText(item.contentHtml),
    item.summary,
    item.note,
    item.captureInput?.snapshot.selectedText,
    item.captureInput?.snapshot.textContent,
    item.captureInput?.snapshot.excerpt,
    ...(item.captureInput?.snapshot.contentCandidates?.map((candidate) => candidate.text) ?? [])
  ];

  const text = cleanText(candidates.filter(Boolean).join("\n\n"));
  return text.slice(0, maxContentChars);
}

function htmlToText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return cleanText(new JSDOM(html).window.document.body.textContent ?? "");
}

function normalizeClassification(
  classification: AgentClassificationModelOutput,
  existingCategories: AgentContentCategorySummary[]
): AgentClassification {
  return {
    ...classification,
    contentCategory: normalizeAgentContentCategory(classification.contentCategory, existingCategories),
    topics: uniqueTrimmed(classification.topics).slice(0, 8),
    keyPoints: uniqueTrimmed(classification.keyPoints).slice(0, 6),
    summary: cleanText(classification.summary).slice(0, 800),
    language: classification.language ? cleanText(classification.language).slice(0, 32) : undefined
  };
}

function formatExistingCategories(categories: AgentContentCategorySummary[]): string {
  if (!categories.length) return "(none yet)";
  return categories
    .slice(0, 24)
    .map((category) => {
      const description = category.description ? ` — ${category.description}` : "";
      return `- ${category.id}: ${category.label}${description} (${category.count} saved)`;
    })
    .join("\n");
}

function uniqueTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = cleanText(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
