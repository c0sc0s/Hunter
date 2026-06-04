import crypto from "node:crypto";
import type { SourceType } from "../shared/types";
import { cleanText } from "./sources/url";

export const contentRecognitionVersion = 1;

export type ContentHashInput = {
  canonicalUrl: string;
  title: string;
  sourceType: SourceType;
  excerpt: string;
  readableText?: string;
  contentHtml?: string;
  author?: string;
  publishedAt?: string;
  language?: string;
};

export function buildContentHash(input: ContentHashInput): string {
  const payload = {
    algorithmVersion: contentRecognitionVersion,
    canonicalUrl: input.canonicalUrl,
    title: cleanText(input.title),
    sourceType: input.sourceType,
    excerpt: cleanText(input.excerpt),
    readableText: cleanText(input.readableText),
    contentHtml: input.contentHtml ?? "",
    author: cleanText(input.author),
    publishedAt: input.publishedAt ?? "",
    language: input.language ?? ""
  };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
