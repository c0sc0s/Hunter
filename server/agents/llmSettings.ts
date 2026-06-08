import { mkdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentLlmProvider, AgentLlmSettings, UpdateAgentLlmSettingsInput } from "../../shared/types";
import { hunterDataPath } from "../dataDir";

export type StoredAgentLlmSettings = {
  provider?: AgentLlmProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  updatedAt?: string;
};

const settingsFileName = "agent-llm-settings.json";

export function readAgentLlmSettingsSync(): StoredAgentLlmSettings {
  try {
    return parseStoredSettings(readFileSync(settingsPath(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    return {};
  }
}

export async function readAgentLlmSettings(): Promise<StoredAgentLlmSettings> {
  try {
    return parseStoredSettings(await readFile(settingsPath(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    return {};
  }
}

export async function updateAgentLlmSettings(input: UpdateAgentLlmSettingsInput): Promise<StoredAgentLlmSettings> {
  const previous = await readAgentLlmSettings();
  const providerChanged = Boolean(input.provider && input.provider !== previous.provider);
  const next: StoredAgentLlmSettings = {
    ...previous,
    provider: input.provider ?? previous.provider,
    baseUrl: trimOptional(input.baseUrl) ?? (providerChanged ? undefined : previous.baseUrl),
    model: trimOptional(input.model) ?? (providerChanged ? undefined : previous.model),
    updatedAt: new Date().toISOString()
  };

  if (input.clearApiKey || (providerChanged && input.apiKey === undefined)) {
    delete next.apiKey;
  } else if (input.apiKey !== undefined) {
    const apiKey = input.apiKey.trim();
    if (apiKey) next.apiKey = apiKey;
  }

  await writeSettings(next);
  return next;
}

export function toPublicAgentLlmSettings(settings: StoredAgentLlmSettings, resolved: AgentLlmSettings): AgentLlmSettings {
  return {
    provider: resolved.provider,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    apiKeyConfigured: resolved.provider === "ollama" ? false : Boolean(settings.apiKey) || resolved.apiKeyConfigured,
    updatedAt: settings.updatedAt
  };
}

function parseStoredSettings(raw: string): StoredAgentLlmSettings {
  const parsed = JSON.parse(raw) as StoredAgentLlmSettings;
  return {
    provider: isProvider(parsed.provider) ? parsed.provider : undefined,
    baseUrl: trimOptional(parsed.baseUrl),
    model: trimOptional(parsed.model),
    apiKey: trimOptional(parsed.apiKey),
    updatedAt: trimOptional(parsed.updatedAt)
  };
}

async function writeSettings(settings: StoredAgentLlmSettings): Promise<void> {
  const filePath = settingsPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  try {
    await writeFile(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmpPath, filePath);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

function settingsPath(): string {
  const filePath = hunterDataPath(settingsFileName);
  mkdirSync(path.dirname(filePath), { recursive: true });
  return filePath;
}

function trimOptional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isProvider(value: unknown): value is AgentLlmProvider {
  return value === "ollama" || value === "deepseek" || value === "openai-compatible";
}
