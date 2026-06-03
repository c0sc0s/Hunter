import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CaptureEvent, ConnectorRecord, LibraryItem, LibraryStats, SourceType } from "../shared/types";
import type { RecognitionJob } from "./repositories/types";
import { seedItems } from "./seed";

type StoreFile = {
  items: LibraryItem[];
  recognitionJobs?: RecognitionJob[];
  connectors?: ConnectorRecord[];
  captureEvents?: CaptureEvent[];
};

type StoreState = {
  items: LibraryItem[];
  recognitionJobs: RecognitionJob[];
  connectors: ConnectorRecord[];
  captureEvents: CaptureEvent[];
};

const dataDir = path.resolve("data");
const storePath = path.join(dataDir, "huntter-store.json");
let operationChain: Promise<unknown> = Promise.resolve();

export async function readItems(): Promise<LibraryItem[]> {
  return (await readStoreFromDisk()).items;
}

export async function writeItems(items: LibraryItem[]): Promise<void> {
  await enqueueStoreOperation(async () => {
    const state = await readStoreFromDisk();
    await writeStoreToDisk({ ...state, items });
  });
}

export async function updateItems<T>(
  update: (items: LibraryItem[]) => Promise<{ items: LibraryItem[]; result: T }> | { items: LibraryItem[]; result: T }
): Promise<T> {
  return enqueueStoreOperation(async () => {
    const state = await readStoreFromDisk();
    const current = state.items;
    const { items, result } = await update([...current]);
    await writeStoreToDisk({ ...state, items });
    return result;
  });
}

export async function updateRecognitionJobs<T>(
  update: (jobs: RecognitionJob[]) => Promise<{ jobs: RecognitionJob[]; result: T }> | { jobs: RecognitionJob[]; result: T }
): Promise<T> {
  return enqueueStoreOperation(async () => {
    const state = await readStoreFromDisk();
    const { jobs, result } = await update([...state.recognitionJobs]);
    await writeStoreToDisk({ ...state, recognitionJobs: jobs });
    return result;
  });
}

async function readStoreFromDisk(): Promise<StoreState> {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    return {
      items: parsed.items,
      recognitionJobs: parsed.recognitionJobs ?? [],
      connectors: parsed.connectors ?? [],
      captureEvents: parsed.captureEvents ?? []
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    const seeded = { items: seedItems, recognitionJobs: [], connectors: [], captureEvents: [] };
    await writeStoreToDisk(seeded);
    return seeded;
  }
}

export async function updateConnectors<T>(
  update: (
    connectors: ConnectorRecord[]
  ) => Promise<{ connectors: ConnectorRecord[]; result: T }> | { connectors: ConnectorRecord[]; result: T }
): Promise<T> {
  return enqueueStoreOperation(async () => {
    const state = await readStoreFromDisk();
    const { connectors, result } = await update([...state.connectors]);
    await writeStoreToDisk({ ...state, connectors });
    return result;
  });
}

export async function updateCaptureEvents<T>(
  update: (events: CaptureEvent[]) => Promise<{ events: CaptureEvent[]; result: T }> | { events: CaptureEvent[]; result: T }
): Promise<T> {
  return enqueueStoreOperation(async () => {
    const state = await readStoreFromDisk();
    const { events, result } = await update([...state.captureEvents]);
    await writeStoreToDisk({ ...state, captureEvents: events });
    return result;
  });
}

async function writeStoreToDisk(state: StoreState): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(storePath, JSON.stringify(state, null, 2), "utf8");
}

async function enqueueStoreOperation<T>(operation: () => Promise<T>): Promise<T> {
  const nextOperation = operationChain.catch(() => undefined).then(operation);
  operationChain = nextOperation.then(
    () => undefined,
    () => undefined
  );
  return nextOperation;
}

export function getStats(items: LibraryItem[]): LibraryStats {
  const sources = emptySourceCounts();
  for (const item of items) {
    sources[item.sourceType] += 1;
  }

  return {
    total: items.length,
    unread: items.filter((item) => item.status === "unread").length,
    reading: items.filter((item) => item.status === "reading").length,
    read: items.filter((item) => item.status === "read").length,
    archived: items.filter((item) => item.status === "archived").length,
    favorite: items.filter((item) => item.favorite).length,
    sources
  };
}

function emptySourceCounts(): Record<SourceType, number> {
  return {
    article: 0,
    post: 0,
    tweet: 0,
    feishu: 0,
    video: 0,
    pdf: 0,
    other: 0
  };
}
