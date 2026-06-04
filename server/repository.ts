import { createJsonRepository } from "./repositories/jsonRepository";
import type { LibraryRepository } from "./repositories/types";

let repositoryPromise: Promise<LibraryRepository> | undefined;

export const libraryRepository: LibraryRepository = {
  async list(query) {
    return (await resolveRepository()).list(query);
  },

  async findById(id) {
    return (await resolveRepository()).findById(id);
  },

  async upsertQueued(item, input) {
    return (await resolveRepository()).upsertQueued(item, input);
  },

  async patch(id, input) {
    return (await resolveRepository()).patch(id, input);
  },

  async delete(id) {
    return (await resolveRepository()).delete(id);
  },

  async replaceRecognitionResult(id, enriched, input) {
    return (await resolveRepository()).replaceRecognitionResult(id, enriched, input);
  },

  async markRecognitionFailed(id, error) {
    return (await resolveRepository()).markRecognitionFailed(id, error);
  },

  async enqueueRecognitionJob(job) {
    return (await resolveRepository()).enqueueRecognitionJob(job);
  },

  async claimRecognitionJobs(limit) {
    return (await resolveRepository()).claimRecognitionJobs(limit);
  },

  async completeRecognitionJob(id) {
    return (await resolveRepository()).completeRecognitionJob(id);
  },

  async failRecognitionJob(id, error, runAfter) {
    return (await resolveRepository()).failRecognitionJob(id, error, runAfter);
  },

  async recordCaptureEvent(event) {
    return (await resolveRepository()).recordCaptureEvent(event);
  },

  async listCaptureEvents(limit) {
    return (await resolveRepository()).listCaptureEvents(limit);
  }
};

async function resolveRepository(): Promise<LibraryRepository> {
  repositoryPromise ??= createRepository();
  return repositoryPromise;
}

/**
 * Default: SQLite. The adapter brings WAL journalling, busy-timeout retries,
 * per-statement transactions, and crash-safe writes — none of which the JSON
 * repository can offer. Multiple concurrent sidecars are still rejected at the
 * dataDir-lock layer, but if one does slip through, SQLite's locking prevents
 * the kind of "half-written file" corruption that bit us with the JSON store.
 *
 * Opt out with `HUNTER_REPOSITORY=json` for tests / scripts that explicitly
 * want the file-based path (e.g. round-tripping a hand-edited snapshot).
 */
async function createRepository(): Promise<LibraryRepository> {
  if (process.env.HUNTER_REPOSITORY === "json") {
    return createJsonRepository();
  }

  const { createSqliteRepository } = await import("./repositories/sqliteRepository");
  return createSqliteRepository();
}
