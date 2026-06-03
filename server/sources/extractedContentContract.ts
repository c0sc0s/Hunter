import type { ExtractedContent, SourceAdapter } from "./types";
import { cleanText } from "./url";

const sourceTypes = new Set(["article", "post", "tweet", "feishu", "video", "pdf", "other"]);
const extractionStates = new Set(["processing", "ready", "partial", "needs_connector", "failed"]);
const captureMethods = new Set(["url_fetch", "extension_snapshot", "source_adapter", "connector"]);
const sourceAccessValues = new Set(["public", "browser_snapshot", "requires_auth", "connector_required"]);
const connectorProviders = new Set(["feishu", "x"]);

export function assertExtractedContentContract(adapter: Pick<SourceAdapter, "id">, content: ExtractedContent): void {
  const errors = validateExtractedContent(content);
  if (errors.length) {
    throw new Error(`Source adapter ${adapter.id} returned invalid content: ${errors.join("; ")}`);
  }
}

export function validateExtractedContent(content: ExtractedContent): string[] {
  const errors: string[] = [];

  requireUrl(errors, "url", content.url);
  requireUrl(errors, "canonicalUrl", content.canonicalUrl);
  requireText(errors, "title", content.title);
  requireText(errors, "sourceName", content.sourceName);
  requireEnum(errors, "sourceType", content.sourceType, sourceTypes);
  requireEnum(errors, "extractionState", content.extractionState, extractionStates);
  requireEnum(errors, "captureMethod", content.captureMethod, captureMethods);
  requireEnum(errors, "sourceAccess", content.sourceAccess, sourceAccessValues);
  requireConfidence(errors, content.confidence);
  requireOptionalUrl(errors, "coverImage", content.coverImage);
  requireOptionalUrl(errors, "favicon", content.favicon);
  requireOptionalDate(errors, "publishedAt", content.publishedAt);
  requireOptionalWholeNumber(errors, "wordCount", content.wordCount);
  requireSafeContentHtml(errors, content.contentHtml);
  requireStateContract(errors, content);

  return errors;
}

function requireStateContract(errors: string[], content: ExtractedContent): void {
  if (content.extractionState === "ready" && !hasCapturedBody(content)) {
    errors.push("ready content must include readableText or contentHtml");
  }

  if (content.extractionState === "partial" && !hasCapturedBody(content) && !cleanText(content.sourceMessage)) {
    errors.push("partial content without body must include sourceMessage");
  }

  if (content.extractionState === "needs_connector") {
    if (content.sourceAccess !== "connector_required") errors.push("needs_connector content must use connector_required sourceAccess");
    if (!content.requiredConnector || !connectorProviders.has(content.requiredConnector)) {
      errors.push("needs_connector content must include requiredConnector");
    }
    if (!cleanText(content.sourceMessage)) errors.push("needs_connector content must include sourceMessage");
  } else if (content.requiredConnector) {
    errors.push("requiredConnector is only valid for needs_connector content");
  }

  if (content.extractionState === "failed") {
    errors.push("source adapters should throw instead of returning failed content");
  }

  if (content.sourceAccess === "connector_required" && content.extractionState !== "needs_connector") {
    errors.push("connector_required sourceAccess is only valid for needs_connector content");
  }
}

function hasCapturedBody(content: ExtractedContent): boolean {
  return Boolean(cleanText(content.readableText) || cleanText(content.contentHtml));
}

function requireText(errors: string[], field: string, value: string): void {
  if (!cleanText(value)) errors.push(`${field} is required`);
}

function requireUrl(errors: string[], field: string, value: string): void {
  if (!isHttpUrl(value)) errors.push(`${field} must be an http(s) URL`);
}

function requireOptionalUrl(errors: string[], field: string, value: string | undefined): void {
  if (value && !isHttpUrl(value)) errors.push(`${field} must be an http(s) URL`);
}

function requireOptionalDate(errors: string[], field: string, value: string | undefined): void {
  if (value && Number.isNaN(Date.parse(value))) errors.push(`${field} must be parseable as a date`);
}

function requireOptionalWholeNumber(errors: string[], field: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) errors.push(`${field} must be a non-negative integer`);
}

function requireEnum(errors: string[], field: string, value: string, allowed: Set<string>): void {
  if (!allowed.has(value)) errors.push(`${field} is not supported`);
}

function requireConfidence(errors: string[], value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) errors.push("confidence must be between 0 and 1");
}

function requireSafeContentHtml(errors: string[], value: string | undefined): void {
  if (!value) return;
  if (/<script\b/i.test(value)) errors.push("contentHtml must not contain script tags");
  if (/\son[a-z]+\s*=/i.test(value)) errors.push("contentHtml must not contain event handler attributes");
  if (/javascript:/i.test(value)) errors.push("contentHtml must not contain javascript URLs");
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
