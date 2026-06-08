import type { LibraryStats, PublicLibraryItem } from "../../shared/types";

export function updateStatsForPatch(
  stats: LibraryStats,
  current: PublicLibraryItem[],
  id: string,
  updated: PublicLibraryItem
): LibraryStats {
  const previous = current.find((item) => item.id === id);
  if (!previous) return stats;

  return {
    ...stats,
    unread: stats.unread + statusDelta("unread", previous, updated),
    reading: stats.reading + statusDelta("reading", previous, updated),
    read: stats.read + statusDelta("read", previous, updated),
    archived: stats.archived + statusDelta("archived", previous, updated),
    favorite: stats.favorite + (Number(updated.favorite) - Number(previous.favorite))
  };
}

export function updateStatsForDelete(stats: LibraryStats, removed: PublicLibraryItem): LibraryStats {
  const sources = { ...stats.sources };
  sources[removed.sourceType] = Math.max(0, (sources[removed.sourceType] ?? 0) - 1);
  return {
    ...stats,
    total: Math.max(0, stats.total - 1),
    unread: stats.unread - (removed.status === "unread" ? 1 : 0),
    reading: stats.reading - (removed.status === "reading" ? 1 : 0),
    read: stats.read - (removed.status === "read" ? 1 : 0),
    archived: stats.archived - (removed.status === "archived" ? 1 : 0),
    favorite: stats.favorite - (removed.favorite ? 1 : 0),
    sources,
    agentCategories: decrementAgentCategory(stats.agentCategories, removed)
  };
}

function statusDelta(status: PublicLibraryItem["status"], previous: PublicLibraryItem, next: PublicLibraryItem): number {
  return (next.status === status ? 1 : 0) - (previous.status === status ? 1 : 0);
}

function decrementAgentCategory(stats: LibraryStats["agentCategories"], removed: PublicLibraryItem): LibraryStats["agentCategories"] {
  const categoryId = removed.agentClassification?.classification.contentCategory?.id;
  if (!categoryId) return stats;

  return stats
    .map((category) => (category.id === categoryId ? { ...category, count: Math.max(0, category.count - 1) } : category))
    .filter((category) => category.count > 0);
}
