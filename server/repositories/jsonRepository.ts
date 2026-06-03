import type { CreateItemInput, LibraryItem, UpdateItemInput } from "../../shared/types";
import { listConnectorViews } from "../connectors";
import { getStats, readItems, updateCaptureEvents, updateConnectors, updateItems, updateRecognitionJobs } from "../store";
import { markRecognitionFailedItem, mergeQueuedItem, mergeRecognitionResult, patchItem } from "./itemMerges";
import { buildPage, filterItems, normalizeLibraryQuery, pageItems } from "./listQuery";
import type { LibraryRepository } from "./types";

export function createJsonRepository(): LibraryRepository {
  return {
    async list(query) {
      const items = await readItems();
      const normalizedQuery = normalizeLibraryQuery(query);
      const filtered = filterItems(items, normalizedQuery);
      return {
        items: pageItems(filtered, normalizedQuery),
        stats: getStats(items),
        page: buildPage(normalizedQuery, filtered.length)
      };
    },

    async findById(id: string) {
      const items = await readItems();
      return items.find((item) => item.id === id);
    },

    async upsertQueued(item: LibraryItem, input: CreateItemInput) {
      return updateItems((items) => {
        const index = items.findIndex((candidate) => candidate.canonicalUrl === item.canonicalUrl || candidate.url === input.url);
        if (index < 0) {
          items.unshift(item);
          return { items, result: item };
        }

        const merged = mergeQueuedItem(items[index], item, input);
        items[index] = merged;
        return { items, result: merged };
      });
    },

    async patch(id: string, input: UpdateItemInput) {
      return updateItems((items) => {
        const index = items.findIndex((item) => item.id === id);
        if (index < 0) return { items, result: undefined };

        const updated = patchItem(items[index], input);
        items[index] = updated;
        return { items, result: updated };
      });
    },

    async delete(id: string) {
      return updateItems((items) => {
        const nextItems = items.filter((item) => item.id !== id);
        return { items: nextItems, result: nextItems.length !== items.length };
      });
    },

    async replaceRecognitionResult(id: string, enriched: LibraryItem, input: Pick<CreateItemInput, "note" | "tags">) {
      return updateItems((items) => {
        const index = items.findIndex((item) => item.id === id);
        if (index < 0) return { items, result: undefined };

        const updated = mergeRecognitionResult(items[index], enriched, input);
        items[index] = updated;
        return { items, result: updated };
      });
    },

    async markRecognitionFailed(id: string, error: unknown) {
      await updateItems((items) => {
        const index = items.findIndex((item) => item.id === id);
        if (index < 0) return { items, result: undefined };

        items[index] = markRecognitionFailedItem(items[index], error);
        return { items, result: undefined };
      });
    },

    async enqueueRecognitionJob(job) {
      return updateRecognitionJobs((jobs) => {
        const nextJobs = jobs.filter((candidate) => candidate.itemId !== job.itemId && candidate.id !== job.id);
        nextJobs.push(job);
        return { jobs: nextJobs, result: job };
      });
    },

    async claimRecognitionJobs(limit: number) {
      return updateRecognitionJobs((jobs) => {
        const now = new Date();
        const staleRunningBefore = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
        const claimed = [];

        for (const job of jobs) {
          if (claimed.length >= limit) break;
          const due = job.runAfter <= now.toISOString();
          const staleRunning = job.status === "running" && job.updatedAt <= staleRunningBefore;
          if (!due && !staleRunning) continue;
          if (job.status !== "queued" && job.status !== "failed" && !staleRunning) continue;

          job.status = "running";
          job.attemptCount += 1;
          job.updatedAt = now.toISOString();
          claimed.push(job);
        }

        return { jobs, result: claimed };
      });
    },

    async completeRecognitionJob(id: string) {
      await updateRecognitionJobs((jobs) => ({ jobs: jobs.filter((job) => job.id !== id), result: undefined }));
    },

    async failRecognitionJob(id: string, error: unknown, runAfter: string) {
      await updateRecognitionJobs((jobs) => {
        const nextJobs = jobs.map((job) =>
          job.id === id
            ? {
                ...job,
                status: "failed" as const,
                lastError: error instanceof Error ? error.message : "Unknown recognition job error",
                runAfter,
                updatedAt: new Date().toISOString()
              }
            : job
        );
        return { jobs: nextJobs, result: undefined };
      });
    },

    async recordCaptureEvent(event) {
      return updateCaptureEvents((events) => {
        const nextEvents = [event, ...events].slice(0, 1000);
        return { events: nextEvents, result: event };
      });
    },

    async listCaptureEvents(limit = 50) {
      return updateCaptureEvents((events) => ({
        events,
        result: events.slice(0, Math.max(1, Math.min(200, limit)))
      }));
    },

    async listConnectors() {
      return updateConnectors((connectors) => ({ connectors, result: listConnectorViews(connectors) }));
    },

    async upsertConnector(record) {
      return updateConnectors((connectors) => {
        const nextConnectors = connectors.filter((connector) => connector.provider !== record.provider);
        nextConnectors.push(record);
        return { connectors: nextConnectors, result: record };
      });
    }
  };
}
