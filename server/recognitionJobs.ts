import crypto from "node:crypto";
import type { CaptureEvent, CreateItemInput } from "../shared/types";
import { buildCaptureEvent } from "./captureEvents";
import { buildItem } from "./itemBuilder";
import { libraryRepository } from "./repository";
import type { RecognitionJob } from "./repositories/types";

let draining = false;
let drainRequested = false;

export async function enqueueRecognition(input: CreateItemInput, itemId: string, savedAt: string): Promise<void> {
  await libraryRepository.enqueueRecognitionJob(createRecognitionJob(input, itemId, savedAt));
  void drainRecognitionJobs();
}

export async function drainRecognitionJobs(): Promise<void> {
  if (draining) {
    drainRequested = true;
    return;
  }

  draining = true;
  try {
    while (true) {
      drainRequested = false;
      const jobs = await libraryRepository.claimRecognitionJobs(3);
      for (const job of jobs) {
        await runRecognitionJob(job);
      }

      if (!drainRequested && jobs.length === 0) break;
    }
  } finally {
    draining = false;
  }
}

function createRecognitionJob(input: CreateItemInput, itemId: string, savedAt: string): RecognitionJob {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    itemId,
    input,
    savedAt,
    status: "queued",
    attemptCount: 0,
    runAfter: now,
    createdAt: now,
    updatedAt: now
  };
}

async function runRecognitionJob(job: RecognitionJob): Promise<void> {
  let captureEvent: CaptureEvent | undefined;

  try {
    const enriched = await buildItem(job.input, job.itemId, job.savedAt);
    const updated = await libraryRepository.replaceRecognitionResult(job.itemId, enriched, job.input);
    await libraryRepository.completeRecognitionJob(job.id);
    if (updated) captureEvent = buildCaptureEvent({ input: job.input, item: updated });
  } catch (error) {
    await libraryRepository.markRecognitionFailed(job.itemId, error);
    await libraryRepository.failRecognitionJob(job.id, error, nextRunAfter(job.attemptCount));
    const failed = await libraryRepository.findById(job.itemId);
    if (failed) captureEvent = buildCaptureEvent({ input: job.input, item: failed, error });
  }

  if (captureEvent) {
    await libraryRepository.recordCaptureEvent(captureEvent);
  }
}

function nextRunAfter(attemptCount: number): string {
  const delayMs = Math.min(60_000, 2 ** Math.max(0, attemptCount - 1) * 5_000);
  return new Date(Date.now() + delayMs).toISOString();
}
