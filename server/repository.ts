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
  },

  async listConnectors() {
    return (await resolveRepository()).listConnectors();
  },

  async upsertConnector(record) {
    return (await resolveRepository()).upsertConnector(record);
  }
};

async function resolveRepository(): Promise<LibraryRepository> {
  repositoryPromise ??= createRepository();
  return repositoryPromise;
}

async function createRepository(): Promise<LibraryRepository> {
  if (process.env.HUNTTER_REPOSITORY === "sqlite") {
    const { createSqliteRepository } = await import("./repositories/sqliteRepository");
    return createSqliteRepository();
  }

  return createJsonRepository();
}
