import { z } from "zod";
import type { AgentLlmProvider, AgentLlmSettings } from "../../shared/types";
import { readAgentLlmSettingsSync } from "./llmSettings";

export type LocalLlmProvider = AgentLlmProvider;

export type LocalLlmConfig = {
  provider: LocalLlmProvider;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  temperature: number;
  apiKey?: string;
};

export type LocalLlmStatus = {
  ok: boolean;
  provider: LocalLlmProvider;
  baseUrl: string;
  model: string;
  modelAvailable: boolean;
  availableModels: string[];
  apiKeyConfigured?: boolean;
  error?: string;
};

export class LocalLlmError extends Error {
  constructor(
    public readonly code: "request_failed" | "request_timeout" | "http_error" | "invalid_response" | "invalid_json" | "schema_mismatch",
    message: string
  ) {
    super(message);
    this.name = "LocalLlmError";
  }
}

const ollamaTagsSchema = z
  .object({
    models: z
      .array(
        z
          .object({
            name: z.string().optional(),
            model: z.string().optional()
          })
          .passthrough()
      )
      .optional()
  })
  .passthrough();

const ollamaGenerateSchema = z
  .object({
    response: z.string()
  })
  .passthrough();

const openAiCompatibleModelsSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: z.string()
          })
          .passthrough()
      )
      .optional()
  })
  .passthrough();

const chatCompletionSchema = z
  .object({
    choices: z.array(
      z
        .object({
          message: z
            .object({
              content: z.string().nullable().optional()
            })
            .passthrough()
            .optional()
        })
        .passthrough()
    )
  })
  .passthrough();

const ollamaDefaultBaseUrl = "http://127.0.0.1:11434";
const ollamaDefaultModel = "llama3.2:3b";
const deepSeekDefaultBaseUrl = "https://api.deepseek.com";
const deepSeekDefaultModel = "deepseek-v4-flash";
const openAiCompatibleDefaultBaseUrl = "https://api.openai.com/v1";
const defaultTimeoutMs = 60_000;
const defaultTemperature = 0.1;

export function resolveLocalLlmConfig(env: NodeJS.ProcessEnv = process.env): LocalLlmConfig {
  const settings = readAgentLlmSettingsSync();
  const provider = settings.provider ?? parseProvider(env.HUNTER_LLM_PROVIDER || env.HUNTER_LOCAL_LLM_PROVIDER);
  const timeoutMs = parsePositiveInteger(env.HUNTER_LOCAL_LLM_TIMEOUT_MS || env.HUNTER_LLM_TIMEOUT_MS, defaultTimeoutMs);
  const temperature = parseTemperature(env.HUNTER_LOCAL_LLM_TEMPERATURE || env.HUNTER_LLM_TEMPERATURE, defaultTemperature);

  if (provider === "deepseek") {
    return {
      provider,
      baseUrl: normalizeBaseUrl(
        settings.baseUrl || env.HUNTER_DEEPSEEK_BASE_URL || env.HUNTER_OPENAI_COMPATIBLE_BASE_URL || deepSeekDefaultBaseUrl
      ),
      model: settings.model || env.HUNTER_DEEPSEEK_MODEL?.trim() || env.HUNTER_LOCAL_LLM_MODEL?.trim() || deepSeekDefaultModel,
      timeoutMs,
      temperature,
      apiKey: settings.apiKey || env.HUNTER_DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY || env.HUNTER_OPENAI_COMPATIBLE_API_KEY
    };
  }

  if (provider === "openai-compatible") {
    return {
      provider,
      baseUrl: normalizeBaseUrl(settings.baseUrl || env.HUNTER_OPENAI_COMPATIBLE_BASE_URL || openAiCompatibleDefaultBaseUrl),
      model: settings.model || env.HUNTER_OPENAI_COMPATIBLE_MODEL?.trim() || env.HUNTER_LOCAL_LLM_MODEL?.trim() || "gpt-4o-mini",
      timeoutMs,
      temperature,
      apiKey: settings.apiKey || env.HUNTER_OPENAI_COMPATIBLE_API_KEY || env.OPENAI_API_KEY
    };
  }

  return {
    provider,
    baseUrl: normalizeBaseUrl(settings.baseUrl || env.HUNTER_LOCAL_LLM_BASE_URL || env.OLLAMA_HOST || ollamaDefaultBaseUrl),
    model: settings.model || env.HUNTER_LOCAL_LLM_MODEL?.trim() || ollamaDefaultModel,
    timeoutMs,
    temperature
  };
}

export function getResolvedLocalLlmSettings(config: LocalLlmConfig = resolveLocalLlmConfig()): AgentLlmSettings {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyConfigured: config.provider === "ollama" ? false : Boolean(config.apiKey)
  };
}

export async function getLocalLlmStatus(config: LocalLlmConfig = resolveLocalLlmConfig()): Promise<LocalLlmStatus> {
  if (config.provider !== "ollama") {
    return getOpenAiCompatibleStatus(config);
  }

  try {
    const response = await fetchWithTimeout(`${config.baseUrl}/api/tags`, {
      method: "GET",
      timeoutMs: Math.min(config.timeoutMs, 5_000)
    });

    if (!response.ok) {
      return unavailable(config, `Ollama returned HTTP ${response.status}`);
    }

    const body = ollamaTagsSchema.parse(await response.json());
    const availableModels = (body.models ?? [])
      .map((model) => model.model || model.name)
      .filter((model): model is string => Boolean(model))
      .sort((a, b) => a.localeCompare(b));

    return {
      ok: true,
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      modelAvailable: availableModels.includes(config.model),
      availableModels
    };
  } catch (error) {
    return unavailable(config, describeLocalLlmFailure(error));
  }
}

export async function generateLocalJson<T>(
  input: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
  },
  config: LocalLlmConfig = resolveLocalLlmConfig()
): Promise<T> {
  if (config.provider !== "ollama") {
    return generateOpenAiCompatibleJson(input, config);
  }

  const response = await fetchWithTimeout(`${config.baseUrl}/api/generate`, {
    method: "POST",
    timeoutMs: config.timeoutMs,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      system: input.system,
      prompt: input.prompt,
      stream: false,
      format: "json",
      options: {
        temperature: config.temperature
      }
    })
  });

  if (!response.ok) {
    throw new LocalLlmError("http_error", `Ollama returned HTTP ${response.status}`);
  }

  let generated: z.infer<typeof ollamaGenerateSchema>;
  try {
    generated = ollamaGenerateSchema.parse(await response.json());
  } catch (error) {
    throw new LocalLlmError("invalid_response", describeLocalLlmFailure(error));
  }

  let parsedJson: unknown;
  try {
    parsedJson = parseJsonObject(generated.response);
  } catch (error) {
    throw new LocalLlmError("invalid_json", describeLocalLlmFailure(error));
  }

  try {
    return input.schema.parse(parsedJson);
  } catch (error) {
    throw new LocalLlmError("schema_mismatch", describeLocalLlmFailure(error));
  }
}

async function getOpenAiCompatibleStatus(config: LocalLlmConfig): Promise<LocalLlmStatus> {
  if (!config.apiKey) {
    return unavailable(config, `${providerLabel(config.provider)} API key is not configured`);
  }

  try {
    const response = await fetchWithTimeout(`${config.baseUrl}/models`, {
      method: "GET",
      timeoutMs: Math.min(config.timeoutMs, 5_000),
      headers: {
        Authorization: `Bearer ${config.apiKey}`
      }
    });

    if (!response.ok) {
      return unavailable(config, `${providerLabel(config.provider)} returned HTTP ${response.status}`);
    }

    const body = openAiCompatibleModelsSchema.parse(await response.json());
    const availableModels = (body.data ?? []).map((model) => model.id).sort((a, b) => a.localeCompare(b));
    return {
      ok: true,
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      modelAvailable: availableModels.length === 0 ? false : availableModels.includes(config.model),
      availableModels,
      apiKeyConfigured: true
    };
  } catch (error) {
    return unavailable(config, describeLocalLlmFailure(error));
  }
}

async function generateOpenAiCompatibleJson<T>(
  input: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
  },
  config: LocalLlmConfig
): Promise<T> {
  if (!config.apiKey) {
    throw new LocalLlmError("request_failed", `${providerLabel(config.provider)} API key is not configured`);
  }

  const response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    timeoutMs: config.timeoutMs,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.prompt }
      ],
      stream: false,
      temperature: config.temperature,
      response_format: { type: "json_object" },
      ...(config.provider === "deepseek" ? { thinking: { type: "disabled" } } : {})
    })
  });

  if (!response.ok) {
    throw new LocalLlmError("http_error", `${providerLabel(config.provider)} returned HTTP ${response.status}`);
  }

  let generated: z.infer<typeof chatCompletionSchema>;
  try {
    generated = chatCompletionSchema.parse(await response.json());
  } catch (error) {
    throw new LocalLlmError("invalid_response", describeLocalLlmFailure(error));
  }

  const content = generated.choices[0]?.message?.content;
  if (!content) {
    throw new LocalLlmError("invalid_response", `${providerLabel(config.provider)} returned no message content`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = parseJsonObject(content);
  } catch (error) {
    throw new LocalLlmError("invalid_json", describeLocalLlmFailure(error));
  }

  try {
    return input.schema.parse(parsedJson);
  } catch (error) {
    throw new LocalLlmError("schema_mismatch", describeLocalLlmFailure(error));
  }
}

export function parseJsonObject(value: string): unknown {
  const trimmed = value.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("Local LLM response did not contain a JSON object");
    }
    return JSON.parse(unfenced.slice(start, end + 1));
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function parseProvider(value: string | undefined): LocalLlmProvider {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "deepseek") return "deepseek";
  if (normalized === "openai-compatible" || normalized === "openai_compatible" || normalized === "openai") return "openai-compatible";
  return "ollama";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTemperature(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2 ? parsed : fallback;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & {
    timeoutMs: number;
  }
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new LocalLlmError("request_timeout", "Local LLM request timed out");
    }
    throw new LocalLlmError("request_failed", describeLocalLlmFailure(error));
  } finally {
    clearTimeout(timeout);
  }
}

function unavailable(config: LocalLlmConfig, error: string): LocalLlmStatus {
  return {
    ok: false,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    modelAvailable: false,
    availableModels: [],
    apiKeyConfigured: config.provider === "ollama" ? undefined : Boolean(config.apiKey),
    error
  };
}

function providerLabel(provider: LocalLlmProvider): string {
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "openai-compatible") return "OpenAI-compatible provider";
  return "Ollama";
}

function describeLocalLlmFailure(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Local LLM request failed";
}
