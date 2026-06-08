import type { SourceType } from "../../shared/types";

export function detectSourceType(url: string): SourceType {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");
  const path = parsed.pathname.toLowerCase();

  if ((host === "x.com" || host === "twitter.com") && path.includes("/status/")) return "tweet";
  if (isFeishuHost(host)) return "feishu";
  if (host.endsWith("reddit.com")) return "post";
  if (host.includes("youtube.com") || host.includes("youtu.be") || host.includes("vimeo.com")) return "video";
  if (path.endsWith(".pdf")) return "pdf";
  return "article";
}

export function isFeishuHost(host: string): boolean {
  return (
    host === "feishu.cn" ||
    host.endsWith(".feishu.cn") ||
    host === "larksuite.com" ||
    host.endsWith(".larksuite.com") ||
    host === "larkoffice.com" ||
    host.endsWith(".larkoffice.com")
  );
}

export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  removeTrackingSearchParams(parsed.searchParams);
  parsed.searchParams.sort();
  return parsed.toString();
}

export function isTrackingSearchParam(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return normalizedName.startsWith("utm_") || trackingSearchParams.has(normalizedName);
}

export function faviconFor(url: string): string {
  const host = new URL(url).hostname;
  return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
}

export function cleanText(value: string | undefined): string {
  return (value ?? "")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function absolutize(value: string | undefined | null, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

const trackingSearchParams = new Set([
  "_hsenc",
  "_hsmi",
  "ck_subscriber_id",
  "dclid",
  "fbclid",
  "gclid",
  "gbraid",
  "igshid",
  "li_fat_id",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "msclkid",
  "oly_anon_id",
  "oly_enc_id",
  "scid",
  "spm",
  "twclid",
  "vero_id",
  "wbraid",
  "yclid"
]);

function removeTrackingSearchParams(searchParams: URLSearchParams): void {
  for (const name of [...searchParams.keys()]) {
    if (isTrackingSearchParam(name)) {
      searchParams.delete(name);
    }
  }
}
