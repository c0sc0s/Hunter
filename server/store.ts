import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CaptureEvent, LibraryItem, LibraryStats, SourceType } from "../shared/types";
import { resolveDataDir } from "./dataDir";
import type { RecognitionJob } from "./repositories/types";
import { seedItems } from "./seed";

type StoreFile = {
  items: LibraryItem[];
  recognitionJobs?: RecognitionJob[];
  captureEvents?: CaptureEvent[];
};

type StoreState = {
  items: LibraryItem[];
  recognitionJobs: RecognitionJob[];
  captureEvents: CaptureEvent[];
};

const dataDir = resolveDataDir();
const storePath = path.join(dataDir, "hunter-store.json");
let operationChain: Promise<unknown> = Promise.resolve();

export async function readItems(): Promise<LibraryItem[]> {
  return (await readStoreFromDisk()).items;
}

export async function readCaptureEvents(): Promise<CaptureEvent[]> {
  return (await readStoreFromDisk()).captureEvents;
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
      items: (parsed.items ?? []).map(stripLegacyItemFields),
      recognitionJobs: parsed.recognitionJobs ?? [],
      captureEvents: (parsed.captureEvents ?? []).map(stripLegacyCaptureEventFields)
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    // Seed only when explicitly requested. A first-run production instance gets
    // an empty store; the development harness opts in via HUNTER_SEED=true.
    const items = shouldSeedStore() ? seedItems : [];
    const initial: StoreState = { items, recognitionJobs: [], captureEvents: [] };
    await writeStoreToDisk(initial);
    return initial;
  }
}

function shouldSeedStore(): boolean {
  return process.env.HUNTER_SEED === "true";
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

// Atomic write: serialize into a sibling temp file, then rename onto the real
// path. `rename` is atomic on POSIX, so a reader either sees the previous
// complete file or the new complete file, never a partial one. This protects
// against SIGKILL mid-write (e.g. the desktop shell killing the sidecar) and
// against an orphan sidecar racing with the live one on the same data dir.
async function writeStoreToDisk(state: StoreState): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const tmpPath = `${storePath}.tmp.${process.pid}`;
  const payload = JSON.stringify(state, null, 2);
  try {
    await writeFile(tmpPath, payload, "utf8");
    await rename(tmpPath, storePath);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
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

function stripLegacyItemFields(raw: LibraryItem): LibraryItem {
  const legacy = raw as LibraryItem & { captureMethod?: unknown; sourceAccess?: unknown; requiredConnector?: unknown };
  const { captureMethod: _captureMethod, sourceAccess: _sourceAccess, requiredConnector: _requiredConnector, ...rest } = legacy;
  const enrichmentState = mapLegacyState(rest.enrichmentState);
  return { ...rest, enrichmentState };
}

function stripLegacyCaptureEventFields(raw: CaptureEvent): CaptureEvent {
  const legacy = raw as CaptureEvent & { captureMethod?: unknown };
  const { captureMethod: _captureMethod, ...rest } = legacy;
  const resultState = mapLegacyState(rest.resultState);
  return { ...rest, resultState };
}

function mapLegacyState(state: string): LibraryItem["enrichmentState"] {
  return state === "needs_connector" ? "failed" : (state as LibraryItem["enrichmentState"]);
}
