import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// `store.ts` reads HUNTER_DATA_DIR at module load. Set it up before importing.
const tempDataDir = mkdtempSync(path.join(tmpdir(), "hunter-store-"));
process.env.HUNTER_DATA_DIR = tempDataDir;

const storeModule = await import("../store.js");
const { writeItems, readItems } = storeModule;

test.after(() => {
  rmSync(tempDataDir, { recursive: true, force: true });
});

test("writeItems persists the final state through a tmp file + rename", async () => {
  const seed = [
    {
      id: "item-1",
      url: "https://example.com/1",
      title: "One",
      sourceType: "article" as const,
      status: "unread" as const,
      favorite: false,
      tags: [],
      savedAt: new Date().toISOString(),
      enrichmentState: "ready" as const
    }
  ] as unknown as Parameters<typeof writeItems>[0];

  await writeItems(seed);

  const onDisk = readFileSync(path.join(tempDataDir, "hunter-store.json"), "utf8");
  const parsed = JSON.parse(onDisk) as { items: { id: string }[] };
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].id, "item-1");

  // No stranded tmp files after a successful write.
  const stragglers = readdirSync(tempDataDir).filter((name) => name.startsWith("hunter-store.json.tmp."));
  assert.deepEqual(stragglers, [], `unexpected tmp leftovers: ${stragglers.join(", ")}`);

  const roundtrip = await readItems();
  assert.equal(roundtrip.length, 1);
  assert.equal(roundtrip[0].id, "item-1");
});

test("two sequential writes leave only the latest payload (and no tmp file)", async () => {
  const base = {
    url: "https://example.com/x",
    title: "X",
    sourceType: "article" as const,
    status: "unread" as const,
    favorite: false,
    tags: [],
    savedAt: new Date().toISOString(),
    enrichmentState: "ready" as const
  };

  await writeItems([{ id: "a", ...base }] as unknown as Parameters<typeof writeItems>[0]);
  await writeItems([{ id: "b", ...base }] as unknown as Parameters<typeof writeItems>[0]);

  const final = JSON.parse(readFileSync(path.join(tempDataDir, "hunter-store.json"), "utf8")) as {
    items: { id: string }[];
  };
  assert.equal(final.items.length, 1);
  assert.equal(final.items[0].id, "b");

  const stragglers = readdirSync(tempDataDir).filter((name) => name.startsWith("hunter-store.json.tmp."));
  assert.deepEqual(stragglers, []);
});
