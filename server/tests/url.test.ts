import assert from "node:assert/strict";
import { normalizeUrl } from "../extract";
import { buildQueuedItem } from "../itemBuilder";
import { SqliteRepository } from "../repositories/sqliteRepository";

assert.equal(
  normalizeUrl("https://example.com/read?utm_source=newsletter&id=42&fbclid=abc&utm_campaign=launch#comments"),
  "https://example.com/read?id=42"
);

assert.equal(normalizeUrl("https://example.com/read?b=2&a=1&MSCLKID=paid&mc_cid=mail"), "https://example.com/read?a=1&b=2");

assert.equal(
  normalizeUrl("https://example.com/search?q=content+recognition&page=2"),
  "https://example.com/search?page=2&q=content+recognition"
);

const repo = new SqliteRepository(":memory:");
try {
  const firstUrl = "https://example.com/article?id=42&utm_source=twitter";
  const secondUrl = "https://example.com/article?fbclid=share&id=42&utm_medium=social";
  const first = buildQueuedItem(
    {
      url: firstUrl,
      tags: ["first"],
      snapshot: { url: firstUrl, textContent: "first snapshot text" }
    },
    "item-first",
    "2026-06-02T00:00:00.000Z"
  );
  const second = buildQueuedItem(
    {
      url: secondUrl,
      tags: ["second"],
      snapshot: { url: secondUrl, textContent: "second snapshot text" }
    },
    "item-second",
    "2026-06-02T00:01:00.000Z"
  );

  await repo.upsertQueued(first, { url: first.url, tags: first.tags, snapshot: { url: first.url } });
  const merged = await repo.upsertQueued(second, { url: second.url, tags: second.tags, snapshot: { url: second.url } });
  const list = await repo.list();

  assert.equal(first.canonicalUrl, "https://example.com/article?id=42");
  assert.equal(second.canonicalUrl, "https://example.com/article?id=42");
  assert.equal(merged.id, "item-first");
  assert.equal(list.stats.total, 1);
  assert.ok(merged.tags.includes("first"));
  assert.ok(merged.tags.includes("second"));
} finally {
  repo.close();
}

console.log("url normalization fixtures passed");
