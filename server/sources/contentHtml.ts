import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { cleanText } from "./url";

const purifyWindow = new JSDOM("").window;
const purifier = createDOMPurify(purifyWindow);

export function sanitizeContentHtml(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  const clean = purifier.sanitize(value, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style"],
    FORBID_ATTR: ["style"],
    SANITIZE_NAMED_PROPS: true
  });

  return clean.trim() || undefined;
}

export function contentHtmlFromSnapshot(snapshotHtml: string | undefined, readableText: string): string | undefined {
  const cleanSnapshotHtml = sanitizeContentHtml(snapshotHtml);
  if (hasSubstantialHtmlText(cleanSnapshotHtml, readableText)) return cleanSnapshotHtml;
  return contentHtmlFromText(readableText);
}

export function contentHtmlFromText(text: string): string | undefined {
  const clean = cleanText(text);
  if (!clean) return undefined;
  return `<p>${escapeHtml(clean)}</p>`;
}

function hasSubstantialHtmlText(html: string | undefined, referenceText: string): boolean {
  if (!html) return false;
  const htmlText = cleanText(new JSDOM(html).window.document.body.textContent);
  const expectedLength = Math.min(80, Math.max(20, cleanText(referenceText).length * 0.25));
  return htmlText.length >= expectedLength;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
