import type { LibraryStats, PublicLibraryItem } from "../../shared/types";
import type { FilterKey, ReadState } from "../types";

export function mergeItems(current: PublicLibraryItem[], incoming: PublicLibraryItem[]): PublicLibraryItem[] {
  const byId = new Map<string, PublicLibraryItem>();
  for (const item of [...current, ...incoming]) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function countForFilter(stats: LibraryStats, key: FilterKey): number {
  if (key === "all") return stats.total;
  if (key === "favorite") return stats.favorite;
  return stats[key];
}

export function readState(item: PublicLibraryItem): ReadState {
  return item.status === "read" ? "read" : "unread";
}

export function readStateLabel(state: ReadState): string {
  return state === "read" ? "Read" : "Unread";
}
