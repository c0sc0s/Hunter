import { KeyRound, Save, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentLlmProvider, AgentLlmSettings } from "../../shared/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAutostart } from "@/hooks/useAutostart";
import { fetchAgentLlmSettings, saveAgentLlmSettings } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Settings entry point. Keeps machine-local preferences in one surface:
 * LLM provider selection and, inside the desktop shell, the autostart toggle.
 *
 * Kept intentionally small. New settings groups should land in `<section>`s
 * inside the same sheet rather than spawning new top-level surfaces.
 */
export function SettingsPanel({ triggerClassName, showTriggerLabel = false }: { triggerClassName?: string; showTriggerLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const autostart = useAutostart();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className={triggerClassName} variant="ghost" size={showTriggerLabel ? "lg" : "icon"} aria-label="Open settings">
          <Settings2 className="size-4" />
          {showTriggerLabel ? <span>Settings</span> : null}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="dark w-[min(100vw,420px)] overflow-y-auto sm:w-[420px]">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Local app preferences.</SheetDescription>
        </SheetHeader>

        <div className="grid gap-5 px-6 pb-6">
          <LlmProviderSettings />
          {autostart.available ? (
            <>
              <Separator />
              <AutostartRow autostart={autostart} />
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

type LlmSettingsForm = {
  provider: AgentLlmProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  apiKeyConfigured: boolean;
};

const providerDefaults: Record<AgentLlmProvider, Pick<LlmSettingsForm, "baseUrl" | "model">> = {
  ollama: {
    baseUrl: "http://127.0.0.1:11434",
    model: "llama3.2:3b"
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash"
  },
  "openai-compatible": {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini"
  }
};

function LlmProviderSettings() {
  const [form, setForm] = useState<LlmSettingsForm>(() => ({
    provider: "ollama",
    ...providerDefaults.ollama,
    apiKey: "",
    apiKeyConfigured: false
  }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchAgentLlmSettings()
      .then((settings) => {
        if (!active) return;
        setForm(formFromSettings(settings));
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load LLM settings");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const selectProvider = (provider: AgentLlmProvider) => {
    setSaved(false);
    setForm((current) => ({
      ...current,
      provider,
      ...providerDefaults[provider],
      apiKey: "",
      apiKeyConfigured: provider === current.provider ? current.apiKeyConfigured : false
    }));
  };

  const save = async (clearApiKey = false) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const settings = await saveAgentLlmSettings({
        provider: form.provider,
        baseUrl: form.baseUrl,
        model: form.model,
        apiKey: clearApiKey ? undefined : form.apiKey,
        clearApiKey
      });
      setForm(formFromSettings(settings));
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save LLM settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="grid gap-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">LLM provider</p>
          <p className="mt-1 text-xs text-muted-foreground">{providerLabel(form.provider)}</p>
        </div>
        <Badge variant={form.apiKeyConfigured || form.provider === "ollama" ? "secondary" : "outline"}>
          {form.provider === "ollama" ? "local" : form.apiKeyConfigured ? "key set" : "no key"}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border/70 bg-muted/35 p-1">
        {(["ollama", "deepseek", "openai-compatible"] as const).map((provider) => (
          <button
            key={provider}
            type="button"
            className={cn("hunter-settings-provider-option", form.provider === provider && "hunter-settings-provider-option-active")}
            aria-pressed={form.provider === provider}
            onClick={() => selectProvider(provider)}
          >
            {providerShortLabel(provider)}
          </button>
        ))}
      </div>

      <div className="grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Base URL</span>
          <Input value={form.baseUrl} disabled={loading || saving} onChange={(event) => setFormValue("baseUrl", event.target.value)} />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Model</span>
          <Input value={form.model} disabled={loading || saving} onChange={(event) => setFormValue("model", event.target.value)} />
        </label>

        {form.provider !== "ollama" ? (
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">API key</span>
            <Input
              value={form.apiKey}
              type="password"
              disabled={loading || saving}
              placeholder={form.apiKeyConfigured ? "Leave blank to keep current key" : ""}
              onChange={(event) => setFormValue("apiKey", event.target.value)}
            />
          </label>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Settings error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {saved ? <p className="text-xs text-muted-foreground">Saved.</p> : null}

      <div className="flex flex-wrap justify-end gap-2">
        {form.provider !== "ollama" && form.apiKeyConfigured ? (
          <Button type="button" variant="outline" disabled={saving} onClick={() => void save(true)}>
            <KeyRound />
            <span>Clear key</span>
          </Button>
        ) : null}
        <Button type="button" disabled={loading || saving} onClick={() => void save(false)}>
          <Save />
          <span>{saving ? "Saving" : "Save"}</span>
        </Button>
      </div>
    </section>
  );

  function setFormValue(field: keyof Pick<LlmSettingsForm, "baseUrl" | "model" | "apiKey">, value: string) {
    setSaved(false);
    setForm((current) => ({ ...current, [field]: value }));
  }
}

function formFromSettings(settings: AgentLlmSettings): LlmSettingsForm {
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: "",
    apiKeyConfigured: settings.apiKeyConfigured
  };
}

function providerLabel(provider: AgentLlmProvider): string {
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "openai-compatible") return "OpenAI-compatible";
  return "Ollama";
}

function providerShortLabel(provider: AgentLlmProvider): string {
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "openai-compatible") return "OpenAI";
  return "Ollama";
}

function AutostartRow({ autostart }: { autostart: ReturnType<typeof useAutostart> }) {
  const checked = autostart.enabled === true;
  return (
    <section className="flex items-start justify-between gap-4 rounded-lg border border-border/70 bg-card p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">Launch at login</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Start Hunter automatically when you sign in so the browser extension can sync without you opening the app first.
        </p>
        {autostart.error ? <p className="mt-2 text-xs text-destructive">{autostart.error}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={autostart.loading}
        onClick={() => void autostart.setEnabled(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-50 ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`pointer-events-none inline-block size-5 translate-y-0.5 rounded-full bg-background shadow-sm transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </section>
  );
}
