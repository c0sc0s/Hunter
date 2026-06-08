import type { PublicLibraryItem } from "../../shared/types";

export function itemNeedsAgentClassification(item: PublicLibraryItem): boolean {
  if (item.enrichmentState === "processing" || item.enrichmentState === "failed") return false;

  const result = item.agentClassification;
  if (!result?.classification.contentCategory) return true;
  if (item.contentHash && result.contentHash !== item.contentHash) return true;
  return false;
}
