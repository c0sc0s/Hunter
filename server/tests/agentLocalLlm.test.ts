import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.HUNTER_DISABLE_LISTEN = "true";
process.env.HUNTER_REPOSITORY = "sqlite";
process.env.HUNTER_SQLITE_PATH = ":memory:";
process.env.HUNTER_SQLITE_IMPORT_JSON = "false";
const tempDataDir = mkdtempSync(path.join(tmpdir(), "hunter-agent-"));
process.env.HUNTER_DATA_DIR = tempDataDir;
process.env.HUNTER_LOCAL_LLM_BASE_URL = "http://127.0.0.1:11434";
process.env.HUNTER_LOCAL_LLM_MODEL = "hunter-test-model";
process.env.HUNTER_LLM_PROVIDER = "ollama";

const { app } = await import("../index");

const server = await new Promise<Server>((resolve) => {
  const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
});
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;
const realFetch = globalThis.fetch.bind(globalThis);

type MockMode = "ok" | "bad-json" | "unavailable";
let mockMode: MockMode = "ok";

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = requestUrl(input);
  if (url.startsWith(baseUrl)) {
    return realFetch(input, init);
  }

  if (mockMode === "unavailable") {
    throw new Error("Ollama daemon is not running");
  }

  if (url === "http://127.0.0.1:11434/api/tags") {
    return jsonResponse({
      models: [{ name: "hunter-test-model" }, { name: "other-model" }]
    });
  }

  if (url === "http://127.0.0.1:11434/api/generate") {
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body)) as { model: string; prompt: string; stream: boolean; format: string };
    assert.equal(body.model, "hunter-test-model");
    assert.equal(body.stream, false);
    assert.equal(body.format, "json");
    assert.match(body.prompt, /Snapshot-only capture/);

    return jsonResponse({
      response:
        mockMode === "bad-json"
          ? "not json"
          : JSON.stringify({
              primaryCategory: "technical",
              contentCategory: {
                existingCategoryId: null,
                label: "AI Systems",
                description: "Local LLMs, model tooling, and applied AI systems"
              },
              intent: "learn",
              topics: ["local llm", "classification"],
              summary: "The item explains local snapshot-driven capture and classification.",
              keyPoints: ["Capture uses browser snapshots.", "Classification is an optional local LLM step."],
              confidence: 0.82,
              language: "en",
              needsFollowUp: false
            })
    });
  }

  if (url === "https://api.deepseek.com/models") {
    assert.equal(
      init?.headers instanceof Headers ? init.headers.get("Authorization") : (init?.headers as Record<string, string>).Authorization,
      "Bearer test-deepseek-key"
    );
    return jsonResponse({
      data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }]
    });
  }

  if (url === "https://api.deepseek.com/chat/completions") {
    assert.equal(init?.method, "POST");
    assert.equal(
      init?.headers instanceof Headers ? init.headers.get("Authorization") : (init?.headers as Record<string, string>).Authorization,
      "Bearer test-deepseek-key"
    );
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      stream: boolean;
      response_format: { type: string };
      thinking?: { type: string };
    };
    assert.equal(body.model, "deepseek-v4-flash");
    assert.equal(body.stream, false);
    assert.equal(body.response_format.type, "json_object");
    assert.equal(body.thinking?.type, "disabled");
    assert.match(body.messages.find((message) => message.role === "user")?.content ?? "", /Captured text:/);

    return jsonResponse({
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              primaryCategory: "research",
              contentCategory: {
                existingCategoryId: "ai-systems",
                label: "AI Systems",
                description: "Local LLMs, model tooling, and applied AI systems"
              },
              intent: "reference",
              topics: ["deepseek", "openai-compatible"],
              summary: "DeepSeek classified the captured article through the OpenAI-compatible chat completions path.",
              keyPoints: ["The request used chat completions.", "The output was validated as JSON."],
              confidence: 0.77,
              language: "en",
              needsFollowUp: false
            })
          }
        }
      ]
    });
  }

  throw new Error(`Unexpected fetch ${url}`);
};

try {
  const item = await postJson<{ id: string }>("/api/items", {
    url: "https://example.com/local-llm",
    snapshot: {
      url: "https://example.com/local-llm",
      title: "Local LLM classification",
      siteName: "Example",
      textContent:
        "Snapshot-only capture keeps recognition deterministic. Local LLM classification runs as a separate agent step for understanding, routing, and review.",
      excerpt: "Snapshot-only capture keeps recognition deterministic.",
      html: `
        <html>
          <body>
            <article>
              <h1>Local LLM classification</h1>
              <p>Snapshot-only capture keeps recognition deterministic. Local LLM classification runs as a separate agent step for understanding, routing, and review.</p>
            </article>
          </body>
        </html>
      `
    }
  });

  const health = await getJson<{
    ok: boolean;
    provider: string;
    model: string;
    modelAvailable: boolean;
    availableModels: string[];
  }>("/api/agent/local-llm");
  assert.equal(health.ok, true);
  assert.equal(health.provider, "ollama");
  assert.equal(health.model, "hunter-test-model");
  assert.equal(health.modelAvailable, true);
  assert.deepEqual(health.availableModels, ["hunter-test-model", "other-model"]);

  const classification = await postJson<{
    id: string;
    agentClassification?: {
      provider: string;
      model: string;
      contentHash?: string;
      classification: {
        primaryCategory: string;
        intent: string;
        topics: string[];
        contentCategory: { id: string; label: string; source: string };
        confidence: number;
        needsFollowUp: boolean;
      };
    };
  }>(`/api/agent/items/${item.id}/classify`, undefined, 200);
  assert.equal(classification.id, item.id);
  assert.equal(classification.agentClassification?.provider, "ollama");
  assert.equal(classification.agentClassification?.model, "hunter-test-model");
  assert.equal(classification.agentClassification?.classification.primaryCategory, "technical");
  assert.ok(classification.agentClassification?.contentHash);
  assert.equal(classification.agentClassification?.classification.contentCategory.id, "ai-systems");
  assert.equal(classification.agentClassification?.classification.contentCategory.label, "AI Systems");
  assert.equal(classification.agentClassification?.classification.contentCategory.source, "new");
  assert.equal(classification.agentClassification?.classification.intent, "learn");
  assert.ok(classification.agentClassification?.classification.topics.includes("local llm"));
  assert.equal(classification.agentClassification?.classification.confidence, 0.82);
  assert.equal(classification.agentClassification?.classification.needsFollowUp, false);

  const library = await getJson<{ items: Array<{ id: string; agentClassification?: unknown }> }>("/api/items");
  assert.ok(library.items.find((candidate) => candidate.id === item.id)?.agentClassification);

  mockMode = "bad-json";
  const badJson = await postRaw(`/api/agent/items/${item.id}/classify`, undefined);
  assert.equal(badJson.status, 502);
  assert.deepEqual(await badJson.json(), {
    error: "Local LLM returned an invalid response",
    code: "invalid_json"
  });

  mockMode = "unavailable";
  const unavailable = await getJson<{ ok: boolean; error?: string }>("/api/agent/local-llm");
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.error ?? "", /Ollama daemon/);

  mockMode = "ok";
  const savedSettings = await patchJson<{
    provider: string;
    model: string;
    baseUrl: string;
    apiKeyConfigured: boolean;
  }>("/api/agent/settings", {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    apiKey: "test-deepseek-key"
  });
  assert.equal(savedSettings.provider, "deepseek");
  assert.equal(savedSettings.model, "deepseek-v4-flash");
  assert.equal(savedSettings.baseUrl, "https://api.deepseek.com");
  assert.equal(savedSettings.apiKeyConfigured, true);

  const deepSeekHealth = await getJson<{
    ok: boolean;
    provider: string;
    model: string;
    modelAvailable: boolean;
    availableModels: string[];
    apiKeyConfigured?: boolean;
  }>("/api/agent/local-llm");
  assert.equal(deepSeekHealth.ok, true);
  assert.equal(deepSeekHealth.provider, "deepseek");
  assert.equal(deepSeekHealth.model, "deepseek-v4-flash");
  assert.equal(deepSeekHealth.modelAvailable, true);
  assert.equal(deepSeekHealth.apiKeyConfigured, true);
  assert.deepEqual(deepSeekHealth.availableModels, ["deepseek-v4-flash", "deepseek-v4-pro"]);

  const deepSeekClassification = await postJson<{
    id: string;
    agentClassification?: {
      provider: string;
      model: string;
      classification: {
        primaryCategory: string;
        intent: string;
        topics: string[];
        contentCategory: { id: string; label: string; source: string };
        confidence: number;
      };
    };
  }>(`/api/agent/items/${item.id}/classify`, undefined, 200);
  assert.equal(deepSeekClassification.id, item.id);
  assert.equal(deepSeekClassification.agentClassification?.provider, "deepseek");
  assert.equal(deepSeekClassification.agentClassification?.model, "deepseek-v4-flash");
  assert.equal(deepSeekClassification.agentClassification?.classification.primaryCategory, "research");
  assert.equal(deepSeekClassification.agentClassification?.classification.contentCategory.id, "ai-systems");
  assert.equal(deepSeekClassification.agentClassification?.classification.contentCategory.source, "existing");
  assert.equal(deepSeekClassification.agentClassification?.classification.intent, "reference");
  assert.ok(deepSeekClassification.agentClassification?.classification.topics.includes("deepseek"));
  assert.equal(deepSeekClassification.agentClassification?.classification.confidence, 0.77);

  const secondItem = await postJson<{ id: string }>("/api/items", {
    url: "https://example.com/openai-compatible-routing",
    snapshot: {
      url: "https://example.com/openai-compatible-routing",
      title: "OpenAI-compatible routing",
      siteName: "Example",
      textContent:
        "The article covers provider routing for local-first content understanding, using DeepSeek as a remote mock before embedded models ship.",
      excerpt: "Provider routing for local-first content understanding.",
      html: `
        <html>
          <body>
            <article>
              <h1>OpenAI-compatible routing</h1>
              <p>The article covers provider routing for local-first content understanding, using DeepSeek as a remote mock before embedded models ship.</p>
            </article>
          </body>
        </html>
      `
    }
  });

  const incremental = await postJson<{
    attempted: number;
    classified: number;
    items: Array<{
      id: string;
      agentClassification?: {
        classification: {
          contentCategory: { id: string; label: string; source: string };
        };
      };
    }>;
    categories: Array<{ id: string; label: string; count: number }>;
  }>("/api/agent/items/classify-missing", { limit: 5 }, 200);
  assert.equal(incremental.attempted, 1);
  assert.equal(incremental.classified, 1);
  assert.equal(incremental.items[0]?.id, secondItem.id);
  assert.equal(incremental.items[0]?.agentClassification?.classification.contentCategory.id, "ai-systems");
  assert.equal(incremental.items[0]?.agentClassification?.classification.contentCategory.source, "existing");
  assert.equal(incremental.categories.find((category) => category.id === "ai-systems")?.count, 2);

  const categoryFiltered = await getJson<{
    items: Array<{ id: string }>;
    page: { total: number };
    stats: { agentCategories: Array<{ id: string; label: string; count: number }> };
  }>("/api/items?agentCategoryId=ai-systems&limit=10");
  assert.equal(categoryFiltered.page.total, 2);
  assert.deepEqual(categoryFiltered.items.map((candidate) => candidate.id).sort(), [item.id, secondItem.id].sort());
  assert.equal(categoryFiltered.stats.agentCategories.find((category) => category.id === "ai-systems")?.count, 2);

  const switchedSettings = await patchJson<{
    provider: string;
    model: string;
    baseUrl: string;
    apiKeyConfigured: boolean;
  }>("/api/agent/settings", {
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini"
  });
  assert.equal(switchedSettings.provider, "openai-compatible");
  assert.equal(switchedSettings.apiKeyConfigured, false);

  const missingOpenAiKey = await getJson<{ ok: boolean; provider: string; apiKeyConfigured?: boolean; error?: string }>(
    "/api/agent/local-llm"
  );
  assert.equal(missingOpenAiKey.ok, false);
  assert.equal(missingOpenAiKey.provider, "openai-compatible");
  assert.equal(missingOpenAiKey.apiKeyConfigured, false);
  assert.match(missingOpenAiKey.error ?? "", /API key is not configured/);

  console.log("agent local llm fixture passed");
} finally {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  rmSync(tempDataDir, { recursive: true, force: true });
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.ok, true, `${path} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown, expectedStatus = 201): Promise<T> {
  const response = await postRaw(path, body);
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${path} returned HTTP ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  assert.equal(response.ok, true, `${path} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function postRaw(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
