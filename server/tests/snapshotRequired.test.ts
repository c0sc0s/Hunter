import assert from "node:assert/strict";
import type { Server } from "node:http";

process.env.HUNTER_DISABLE_LISTEN = "true";
process.env.HUNTER_REPOSITORY = "sqlite";
process.env.HUNTER_SQLITE_PATH = ":memory:";
process.env.HUNTER_SQLITE_IMPORT_JSON = "false";

const { app } = await import("../index");

const server = await new Promise<Server>((resolve) => {
  const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
});
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const response = await fetch(`${baseUrl}/api/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/snapshot-required" })
  });

  assert.equal(response.status, 400, "POST /api/items without a snapshot must return 400");
  const body = (await response.json()) as { error: string; issues?: Array<{ path: Array<string | number> }> };
  assert.equal(body.error, "Invalid request");
  assert.ok(
    body.issues?.some((issue) => issue.path?.includes("snapshot")),
    "Validation issues should mention snapshot"
  );

  const structuredCandidateResponse = await fetch(`${baseUrl}/api/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: "https://example.com/structured-cover",
      snapshot: {
        url: "https://example.com/structured-cover",
        title: "Structured cover",
        imageCandidates: [
          {
            url: "https://cdn.example.com/static/share.png",
            score: 900,
            source: "metadata:og_image",
            width: 300,
            height: 300
          },
          {
            url: "https://cdn.example.com/uploads/article-photo.jpg",
            score: 780,
            source: "content_image",
            width: 960,
            height: 540,
            context: "article figure image",
            inContentRoot: true
          }
        ]
      }
    })
  });
  assert.equal(structuredCandidateResponse.status, 201, "structured image candidates should pass API validation");
  const structuredCandidateItem = (await structuredCandidateResponse.json()) as { coverImage?: string };
  assert.equal(structuredCandidateItem.coverImage, "https://cdn.example.com/uploads/article-photo.jpg");

  console.log("snapshot-required api fixture passed");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
