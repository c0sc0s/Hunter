import assert from "node:assert/strict";
import { fetchHtmlDocument, htmlFetchLimits } from "../sources/htmlFetch";

const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = (async () =>
    new Response("<!doctype html><title>Bounded</title>", {
      headers: { "content-type": "text/html; charset=utf-8" }
    })) as typeof fetch;

  assert.match(await fetchHtmlDocument("https://example.com/article"), /Bounded/);

  globalThis.fetch = (async () =>
    new Response("not an image", {
      headers: { "content-type": "image/png" }
    })) as typeof fetch;

  await assert.rejects(fetchHtmlDocument("https://example.com/image.png"), /expected HTML content/);

  globalThis.fetch = (async () =>
    new Response("<html></html>", {
      headers: {
        "content-type": "text/html",
        "content-length": String(htmlFetchLimits.maxBytes + 1)
      }
    })) as typeof fetch;

  await assert.rejects(fetchHtmlDocument("https://example.com/huge"), /larger than/);

  globalThis.fetch = (async () =>
    new Response("x".repeat(htmlFetchLimits.maxBytes + 1), {
      headers: { "content-type": "text/html" }
    })) as typeof fetch;

  await assert.rejects(fetchHtmlDocument("https://example.com/streaming-huge"), /larger than/);

  console.log("html fetch fixtures passed");
} finally {
  globalThis.fetch = originalFetch;
}
