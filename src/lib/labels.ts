import type { SourceType } from "../../shared/types";
import { filters } from "../constants";
import type { FilterKey } from "../types";

export function activeFilterTitle(filter: FilterKey): string {
  return filters.find((entry) => entry.key === filter)?.label ?? "Library";
}

export function sourceLabel(sourceType: SourceType): string {
  return {
    article: "Article",
    post: "Post",
    tweet: "X",
    feishu: "Feishu",
    video: "Video",
    pdf: "PDF",
    other: "Link"
  }[sourceType];
}
