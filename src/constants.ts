import { CheckCircle2, Inbox, Layers3, Star } from "lucide-react";
import type { LibraryPage, LibraryStats } from "../shared/types";
import type { FilterKey } from "./types";

export const pageSize = 60;

export const emptyStats: LibraryStats = {
  total: 0,
  unread: 0,
  reading: 0,
  read: 0,
  archived: 0,
  favorite: 0,
  sources: {
    article: 0,
    post: 0,
    tweet: 0,
    feishu: 0,
    video: 0,
    pdf: 0,
    other: 0
  }
};

export const emptyPage: LibraryPage = {
  limit: 60,
  offset: 0,
  total: 0,
  hasMore: false
};

export const filters: Array<{ key: FilterKey; label: string; icon: typeof Inbox }> = [
  { key: "all", label: "Library", icon: Layers3 },
  { key: "unread", label: "Unread", icon: Inbox },
  { key: "read", label: "Read", icon: CheckCircle2 },
  { key: "favorite", label: "Favorites", icon: Star }
];
