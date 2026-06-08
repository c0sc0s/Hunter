import type { PublicLibraryItem } from "../../shared/types";
import { upgradeCdnCoverResolution } from "../../shared/coverImageUrl";

export function getItemCoverImage(item: PublicLibraryItem): string | undefined {
  return item.coverImage ? upgradeCdnCoverResolution(item.coverImage) : undefined;
}
