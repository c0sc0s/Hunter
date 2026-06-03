import type { CreateItemInput, LibraryItem, UpdateItemInput } from "../../shared/types";
import { normalizeTags } from "../tags";

export const queuedMessage = "Saved. Huntter is extracting content in the background.";

export function mergeQueuedItem(previous: LibraryItem, queued: LibraryItem, input: CreateItemInput): LibraryItem {
  const captureInput = chooseCaptureInput(previous.captureInput, queued.captureInput);

  return {
    ...previous,
    ...queued,
    id: previous.id,
    savedAt: previous.savedAt,
    status: previous.status,
    favorite: previous.favorite,
    note: input.note ?? previous.note,
    tags: normalizeTags([...(previous.tags ?? []), ...(input.tags ?? queued.tags)]),
    captureInput,
    enrichmentState: "processing",
    sourceMessage: queuedMessage
  };
}

export function patchItem(previous: LibraryItem, input: UpdateItemInput): LibraryItem {
  return {
    ...previous,
    ...input,
    tags: input.tags ? normalizeTags(input.tags) : previous.tags,
    updatedAt: new Date().toISOString()
  };
}

export function mergeRecognitionResult(
  previous: LibraryItem,
  enriched: LibraryItem,
  input: Pick<CreateItemInput, "note" | "tags">
): LibraryItem {
  const captureInput = chooseCaptureInput(previous.captureInput, enriched.captureInput);

  return {
    ...previous,
    ...enriched,
    status: previous.status,
    favorite: previous.favorite,
    note: input.note ?? previous.note,
    tags: normalizeTags([...(previous.tags ?? []), ...(input.tags ?? enriched.tags)]),
    captureInput
  };
}

export function markRecognitionFailedItem(previous: LibraryItem, error: unknown): LibraryItem {
  return {
    ...previous,
    enrichmentState: "failed",
    enrichmentError: error instanceof Error ? error.message : "Unknown enrichment error",
    sourceMessage: "Background extraction failed.",
    updatedAt: new Date().toISOString()
  };
}

function chooseCaptureInput(previous: LibraryItem["captureInput"], incoming: LibraryItem["captureInput"]): LibraryItem["captureInput"] {
  if (hasSnapshot(incoming)) return incoming;
  return previous ?? incoming;
}

function hasSnapshot(input: LibraryItem["captureInput"]): boolean {
  return Boolean(input?.snapshot);
}
