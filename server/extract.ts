export type { ExtractedContent } from "./sources/types";
export { detectSourceType, normalizeUrl } from "./sources/url";
export { extractWithSourceAdapter as extractContent, listSourceAdapters } from "./sources/registry";
