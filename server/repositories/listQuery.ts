import type { LibraryItem, LibraryQuery } from "../../shared/types";

export const defaultLibraryLimit = 60;
export const maxLibraryLimit = 120;

export type NormalizedLibraryQuery = Required<Pick<LibraryQuery, "limit" | "offset">> & Pick<LibraryQuery, "filter" | "sourceType" | "q">;

export function normalizeLibraryQuery(query: LibraryQuery = {}): NormalizedLibraryQuery {
  return {
    filter: query.filter && query.filter !== "all" ? query.filter : undefined,
    sourceType: query.sourceType,
    q: normalizeSearch(query.q),
    limit: clampInteger(query.limit, defaultLibraryLimit, 1, maxLibraryLimit),
    offset: clampInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER)
  };
}

export function filterItems(items: LibraryItem[], query: NormalizedLibraryQuery): LibraryItem[] {
  const search = query.q?.toLowerCase();

  return items.filter((item) => {
    if (query.filter === "favorite" && !item.favorite) return false;
    if (query.filter && query.filter !== "favorite" && item.status !== query.filter) return false;
    if (query.sourceType && item.sourceType !== query.sourceType) return false;
    if (search && !searchText(item).includes(search)) return false;
    return true;
  });
}

export function pageItems<T>(items: T[], query: NormalizedLibraryQuery): T[] {
  return items.slice(query.offset, query.offset + query.limit);
}

export function searchText(item: LibraryItem): string {
  return [item.title, item.summary, item.excerpt, item.readableText, item.sourceName, item.note, item.author, ...item.tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function buildPage(query: NormalizedLibraryQuery, total: number) {
  return {
    limit: query.limit,
    offset: query.offset,
    total,
    hasMore: query.offset + query.limit < total
  };
}

function normalizeSearch(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const integer = Math.trunc(value);
  if (integer < min) return min;
  if (integer > max) return max;
  return integer;
}
