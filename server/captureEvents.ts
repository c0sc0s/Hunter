import crypto from "node:crypto";
import type { CaptureEvent, CaptureMethod, CreateItemInput, LibraryItem } from "../shared/types";

type CaptureEventInput = {
  input: CreateItemInput;
  item: LibraryItem;
  error?: unknown;
  now?: string;
};

export function buildCaptureEvent({ input, item, error, now = new Date().toISOString() }: CaptureEventInput): CaptureEvent {
  return {
    id: crypto.randomUUID(),
    itemId: item.id,
    sourceUrl: input.url,
    canonicalUrl: item.canonicalUrl,
    sourceType: item.sourceType,
    captureMethod: item.captureMethod ?? captureMethodFromInput(input),
    snapshotBytes: estimateSnapshotBytes(input),
    resultState: item.enrichmentState,
    recognitionVersion: item.recognitionVersion,
    recognitionDurationMs: item.recognitionDurationMs,
    contentHash: item.contentHash,
    error: errorMessage(error) ?? item.enrichmentError,
    createdAt: now
  };
}

export function estimateSnapshotBytes(input: Pick<CreateItemInput, "snapshot">): number {
  if (!input.snapshot) return 0;
  return Buffer.byteLength(JSON.stringify(input.snapshot), "utf8");
}

function captureMethodFromInput(input: CreateItemInput): CaptureMethod {
  return input.snapshot ? "extension_snapshot" : "url_fetch";
}

function errorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  return error instanceof Error ? error.message : "Unknown capture error";
}
