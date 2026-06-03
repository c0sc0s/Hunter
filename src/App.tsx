import {
  Archive,
  BookOpen,
  CheckCircle2,
  Clock,
  Command,
  ExternalLink,
  Inbox,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Tag,
  Trash2,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CaptureEvent,
  CaptureEventsResponse,
  ConnectorMutationResponse,
  ConnectorOAuthStartResponse,
  ConnectorProvider,
  ConnectorSyncResponse,
  ConnectorView,
  ConnectorsResponse,
  ItemStatus,
  LibraryItem,
  LibraryPage,
  LibraryResponse,
  LibraryStats,
  SourceType
} from "../shared/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type FilterKey = "all" | "unread" | "reading" | "read" | "archived" | "favorite";
type SourceFilter = "all" | SourceType;
type ActivityKind = "capture" | "command" | "update" | "system";

type ActivityEntry = {
  id: string;
  kind: ActivityKind;
  message: string;
  at: string;
};

const emptyStats: LibraryStats = {
  total: 0,
  unread: 0,
  reading: 0,
  read: 0,
  archived: 0,
  favorite: 0,
  sources: {
    article: 0,
    post: 0,
    tweet: 0,
    feishu: 0,
    video: 0,
    pdf: 0,
    other: 0
  }
};

const emptyPage: LibraryPage = {
  limit: 60,
  offset: 0,
  total: 0,
  hasMore: false
};

const pageSize = 60;

const filters: Array<{ key: FilterKey; label: string; icon: typeof Inbox }> = [
  { key: "all", label: "Library", icon: Layers3 },
  { key: "unread", label: "Unread", icon: Inbox },
  { key: "reading", label: "Reading", icon: BookOpen },
  { key: "read", label: "Read", icon: CheckCircle2 },
  { key: "archived", label: "Archive", icon: Archive },
  { key: "favorite", label: "Favorites", icon: Star }
];

const statusTabs: ItemStatus[] = ["unread", "reading", "read", "archived"];

export function App() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const itemsRef = useRef<LibraryItem[]>([]);
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [captureEvents, setCaptureEvents] = useState<CaptureEvent[]>([]);
  const [stats, setStats] = useState<LibraryStats>(emptyStats);
  const [page, setPage] = useState<LibraryPage>(emptyPage);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [query, setQuery] = useState("");
  const [commandValue, setCommandValue] = useState("");
  const [activity, setActivity] = useState<ActivityEntry[]>([
    {
      id: "boot",
      kind: "system",
      message: "Workspace booted. Type /help in the command bar.",
      at: new Date().toISOString()
    }
  ]);
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingCaptureEvents, setLoadingCaptureEvents] = useState(false);
  const [connectorAction, setConnectorAction] = useState<ConnectorProvider | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("#huntter-command")?.focus();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const sourceCounts = useMemo(() => {
    return (Object.entries(stats.sources) as Array<[SourceType, number]>).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
  }, [stats.sources]);

  const visibleItems = items;

  const selected = useMemo(() => {
    return items.find((item) => item.id === selectedId) ?? visibleItems[0] ?? items[0] ?? null;
  }, [items, selectedId, visibleItems]);

  const pushActivity = useCallback((kind: ActivityKind, message: string) => {
    setActivity((current) =>
      [
        {
          id: crypto.randomUUID(),
          kind,
          message,
          at: new Date().toISOString()
        },
        ...current
      ].slice(0, 8)
    );
  }, []);

  const buildItemsUrl = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset)
      });

      if (filter !== "all") params.set("filter", filter);
      if (sourceFilter !== "all") params.set("sourceType", sourceFilter);
      if (query.trim()) params.set("q", query.trim());

      return `/api/items?${params.toString()}`;
    },
    [filter, query, sourceFilter]
  );

  const loadConnectors = useCallback(async () => {
    try {
      const response = await fetch("/api/connectors");
      if (!response.ok) throw new Error(`Failed to load connectors: HTTP ${response.status}`);
      const data = (await response.json()) as ConnectorsResponse;
      setConnectors(data.connectors);
    } catch (connectorError) {
      pushActivity("system", connectorError instanceof Error ? connectorError.message : "Could not load connectors");
    }
  }, [pushActivity]);

  const loadCaptureEvents = useCallback(
    async (recordActivity = false) => {
      setLoadingCaptureEvents(true);
      try {
        const response = await fetch("/api/capture-events?limit=8");
        if (!response.ok) throw new Error(`Failed to load capture events: HTTP ${response.status}`);
        const data = (await response.json()) as CaptureEventsResponse;
        setCaptureEvents(data.events);
        if (recordActivity) {
          pushActivity("system", `Loaded ${data.events.length} capture events.`);
        }
      } catch (captureEventError) {
        pushActivity("system", captureEventError instanceof Error ? captureEventError.message : "Could not load capture events");
      } finally {
        setLoadingCaptureEvents(false);
      }
    },
    [pushActivity]
  );

  const loadItems = useCallback(
    async ({
      append = false,
      offset = 0,
      recordActivity = false,
      showLoading = false
    }: {
      append?: boolean;
      offset?: number;
      recordActivity?: boolean;
      showLoading?: boolean;
    } = {}) => {
      if (showLoading) {
        setLoading(true);
      }
      if (append) {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const response = await fetch(buildItemsUrl(offset));
        if (!response.ok) throw new Error(`Failed to load library: HTTP ${response.status}`);
        const data = (await response.json()) as LibraryResponse;
        const nextItems = append ? mergeItems(itemsRef.current, data.items) : data.items;
        itemsRef.current = nextItems;
        setItems(nextItems);
        setStats(data.stats);
        setPage(data.page);
        setSelectedId((current) => (current && nextItems.some((item) => item.id === current) ? current : (nextItems[0]?.id ?? null)));
        if (recordActivity) {
          pushActivity("system", `Loaded ${data.items.length} items. ${data.page.total} matched.`);
          void loadConnectors();
          void loadCaptureEvents();
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load library");
      } finally {
        if (showLoading) {
          setLoading(false);
        }
        if (append) {
          setLoadingMore(false);
        }
      }
    },
    [buildItemsUrl, loadCaptureEvents, loadConnectors, pushActivity]
  );

  useEffect(() => {
    void loadConnectors();
    void loadCaptureEvents();
  }, [loadCaptureEvents, loadConnectors]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => {
        void loadItems({ showLoading: true });
      },
      query.trim() ? 250 : 0
    );

    return () => window.clearTimeout(timeout);
  }, [loadItems, query]);

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          tags: splitTags(tags),
          note: note.trim() || undefined
        })
      });

      if (!response.ok) throw new Error(`Could not save item: HTTP ${response.status}`);
      const created = (await response.json()) as LibraryItem;
      setUrl("");
      setTags("");
      setNote("");
      setSelectedId(created.id);
      pushActivity("capture", `Queued ${created.title}`);
      await loadItems();
      await loadCaptureEvents();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save item");
    } finally {
      setSaving(false);
    }
  }

  async function patchItem(id: string, patch: Partial<Pick<LibraryItem, "status" | "favorite" | "tags" | "note">>) {
    const response = await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });

    if (!response.ok) throw new Error(`Could not update item: HTTP ${response.status}`);
    const updated = (await response.json()) as LibraryItem;
    setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    pushActivity("update", `Updated ${updated.title}`);
    await loadItems();
  }

  async function deleteItem(id: string) {
    const response = await fetch(`/api/items/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`Could not delete item: HTTP ${response.status}`);
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedId(null);
    setDetailOpen(false);
    pushActivity("update", "Deleted selected item.");
    await loadItems();
  }

  async function enrichItem(id: string) {
    const response = await fetch(`/api/items/${id}/enrich`, { method: "POST" });
    if (!response.ok) throw new Error(`Could not enrich item: HTTP ${response.status}`);
    const updated = (await response.json()) as LibraryItem;
    setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    pushActivity("update", `Refreshed ${updated.title}`);
    await loadCaptureEvents();
  }

  async function syncConnector(provider: ConnectorProvider) {
    setConnectorAction(provider);
    try {
      const response = await fetch(`/api/connectors/${provider}/sync`, { method: "POST" });
      const body = (await response.json()) as ConnectorSyncResponse;
      if (!response.ok) {
        pushActivity("system", body.error ?? `Could not sync ${provider}.`);
        return;
      }

      pushActivity("system", body.message ?? `Synced ${body.connector.label}.`);
    } catch (syncError) {
      pushActivity("system", syncError instanceof Error ? syncError.message : "Could not sync connector");
    } finally {
      setConnectorAction(null);
      await loadConnectors();
    }
  }

  async function connectConnector(provider: ConnectorProvider) {
    setConnectorAction(provider);
    try {
      const response = await fetch(`/api/connectors/${provider}/oauth/start`, { method: "POST" });
      const body = (await response.json()) as Partial<ConnectorOAuthStartResponse> & { error?: string; missing?: string[] };
      if (!response.ok || !body.authorizationUrl) {
        const missing = body.missing?.length ? ` Missing: ${body.missing.join(", ")}.` : "";
        pushActivity("system", `${body.error ?? `Could not start ${provider} OAuth.`}${missing}`);
        return;
      }

      window.open(body.authorizationUrl, "_blank", "noopener,noreferrer");
      pushActivity("system", `Opened ${provider} authorization. Click Reload after the callback completes.`);
    } catch (connectError) {
      pushActivity("system", connectError instanceof Error ? connectError.message : "Could not start connector authorization");
    } finally {
      setConnectorAction(null);
      await loadConnectors();
    }
  }

  async function disconnectConnector(provider: ConnectorProvider) {
    setConnectorAction(provider);
    try {
      const response = await fetch(`/api/connectors/${provider}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Could not disconnect connector: HTTP ${response.status}`);
      const body = (await response.json()) as ConnectorMutationResponse;
      pushActivity("system", `Disconnected ${body.connector.label}.`);
    } catch (disconnectError) {
      pushActivity("system", disconnectError instanceof Error ? disconnectError.message : "Could not disconnect connector");
    } finally {
      setConnectorAction(null);
      await loadConnectors();
    }
  }

  function runCommand(event: FormEvent) {
    event.preventDefault();
    const raw = commandValue.trim();
    if (!raw) return;

    const command = raw.toLowerCase();
    setCommandValue("");

    if (command === "/help") {
      pushActivity(
        "command",
        "Commands: /all /unread /reading /read /archive /fav /x /article /feishu /star /mark-read /refresh /reload /events or plain search."
      );
      return;
    }

    if (command === "/all") {
      setFilter("all");
      setSourceFilter("all");
      setQuery("");
      pushActivity("command", "Showing all saved items.");
      return;
    }

    if (command === "/unread" || command === "/reading" || command === "/read") {
      setFilter(command.slice(1) as FilterKey);
      pushActivity("command", `Filtered ${command.slice(1)} items.`);
      return;
    }

    if (command === "/archive") {
      setFilter("archived");
      pushActivity("command", "Filtered archived items.");
      return;
    }

    if (command === "/fav" || command === "/favorites") {
      setFilter("favorite");
      pushActivity("command", "Filtered favorite items.");
      return;
    }

    if (command === "/x" || command === "/article" || command === "/feishu") {
      setSourceFilter(command === "/x" ? "tweet" : (command.slice(1) as SourceType));
      pushActivity("command", `Filtered source ${command.slice(1)}.`);
      return;
    }

    if (command === "/star" && selected) {
      void patchItem(selected.id, { favorite: !selected.favorite });
      pushActivity("command", selected.favorite ? "Unstarred selected item." : "Starred selected item.");
      return;
    }

    if (command === "/mark-read" && selected) {
      void patchItem(selected.id, { status: "read" });
      pushActivity("command", "Marked selected item read.");
      return;
    }

    if (command === "/mark-unread" && selected) {
      void patchItem(selected.id, { status: "unread" });
      pushActivity("command", "Marked selected item unread.");
      return;
    }

    if (command === "/refresh" && selected) {
      void enrichItem(selected.id);
      pushActivity("command", "Refreshing selected item.");
      return;
    }

    if (command === "/reload") {
      void loadItems({ recordActivity: true, showLoading: true });
      return;
    }

    if (command === "/events") {
      void loadCaptureEvents(true);
      return;
    }

    if (command.startsWith("source:")) {
      const source = command.replace("source:", "").trim();
      setSourceFilter(source === "x" ? "tweet" : (source as SourceType));
      pushActivity("command", `Filtered source ${source}.`);
      return;
    }

    if (command.startsWith("tag:")) {
      setQuery(command.replace("tag:", "").trim());
      pushActivity("command", `Searching tag ${command.replace("tag:", "").trim()}.`);
      return;
    }

    setQuery(raw);
    pushActivity("command", `Searching "${raw}".`);
  }

  function selectItem(id: string) {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      setDetailOpen(true);
    }
  }

  return (
    <TooltipProvider>
      <main className="dark grid min-h-screen bg-[#141413] text-foreground lg:grid-cols-[292px_minmax(0,1fr)_430px]">
        <aside className="border-border/70 bg-background p-4 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:overflow-y-auto lg:border-r">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md border bg-muted font-mono text-sm font-semibold text-primary">
              H_
            </div>
            <div className="min-w-0">
              <h1 className="font-mono text-lg font-semibold leading-none">Huntter</h1>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">source ingestion console</p>
            </div>
          </div>

          <CapturePanel
            note={note}
            saving={saving}
            tags={tags}
            url={url}
            onNoteChange={setNote}
            onSave={saveItem}
            onTagsChange={setTags}
            onUrlChange={setUrl}
          />

          <nav className="mt-5 grid shrink-0 gap-1" aria-label="Library filters">
            {filters.map((entry) => {
              const Icon = entry.icon;
              const count = countForFilter(stats, entry.key);
              return (
                <Button
                  key={entry.key}
                  variant={entry.key === filter ? "secondary" : "ghost"}
                  className="h-10 justify-start px-2"
                  type="button"
                  onClick={() => setFilter(entry.key)}
                >
                  <Icon className="size-4" />
                  <span className="flex-1 text-left">{entry.label}</span>
                  <Badge variant={entry.key === filter ? "default" : "secondary"}>{count}</Badge>
                </Button>
              );
            })}
          </nav>

          <div className="mt-4 shrink-0 rounded-md border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase text-muted-foreground">
              <Sparkles className="size-3.5" />
              sources
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge
                className="cursor-pointer"
                variant={sourceFilter === "all" ? "default" : "outline"}
                onClick={() => setSourceFilter("all")}
              >
                all {stats.total}
              </Badge>
              {sourceCounts.map(([source, count]) => (
                <Badge
                  key={source}
                  className="cursor-pointer"
                  variant={sourceFilter === source ? "default" : "outline"}
                  onClick={() => setSourceFilter(source)}
                >
                  {sourceLabel(source)} {count}
                </Badge>
              ))}
            </div>
          </div>

          <ConnectorsPanel
            actionProvider={connectorAction}
            className="mt-4 shrink-0"
            connectors={connectors}
            onConnect={(provider) => void connectConnector(provider)}
            onDisconnect={(provider) => void disconnectConnector(provider)}
            onSync={(provider) => void syncConnector(provider)}
          />

          <CaptureEventsPanel
            className="mt-4 shrink-0"
            events={captureEvents}
            loading={loadingCaptureEvents}
            onReload={() => void loadCaptureEvents(true)}
          />

          <ActivityLog className="mt-4 hidden shrink-0 lg:grid" entries={activity} />

          <div className="mt-5 grid shrink-0 grid-cols-2 gap-2 lg:mt-auto">
            <MetricCard label="Saved" value={stats.total} />
            <MetricCard label="Unread" value={stats.unread} />
          </div>
        </aside>

        <section className="min-w-0 bg-muted/20 p-4 sm:p-6">
          <header className="mb-4 grid gap-4">
            <CommandBar commandValue={commandValue} onCommandChange={setCommandValue} onRun={runCommand} />
            <div>
              <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                workspace / {sourceFilter === "all" ? "all sources" : sourceLabel(sourceFilter)}
              </p>
              <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
                <h2 className="font-mono text-3xl font-semibold tracking-tight">{activeFilterTitle(filter)}</h2>
                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <span>{visibleItems.length} visible</span>
                  <span>/</span>
                  <span>{page.total} matched</span>
                  <span>/</span>
                  <span>{stats.total} indexed</span>
                  <Button
                    className="ml-2 h-7 gap-1 px-2 font-mono text-xs"
                    type="button"
                    variant="outline"
                    onClick={() => void loadItems({ recordActivity: true, showLoading: true })}
                  >
                    <RefreshCw className="size-3.5" />
                    Reload
                  </Button>
                </div>
              </div>
            </div>

            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 border-dashed bg-background/70 pl-9 pr-10 font-mono"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search saved items"
                aria-label="Search"
              />
              {query ? (
                <Button
                  className="absolute right-1 top-1 size-8"
                  size="icon"
                  variant="ghost"
                  type="button"
                  title="Clear"
                  onClick={() => setQuery("")}
                >
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>
          </header>

          {error ? (
            <Alert className="mb-4" variant="destructive">
              <AlertTitle>Could not load library</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <LoadingGrid />
          ) : visibleItems.length ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                {visibleItems.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    selected={selected?.id === item.id}
                    onPatch={(patch) => void patchItem(item.id, patch)}
                    onSelect={() => selectItem(item.id)}
                  />
                ))}
              </div>
              {page.hasMore ? (
                <Button
                  className="mx-auto min-w-44"
                  disabled={loadingMore}
                  type="button"
                  variant="outline"
                  onClick={() => void loadItems({ append: true, offset: items.length })}
                >
                  {loadingMore ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  <span>Load more</span>
                </Button>
              ) : null}
            </div>
          ) : (
            <Card className="grid min-h-[260px] place-items-center border-dashed bg-background/70">
              <CardContent className="flex flex-col items-center gap-2 text-muted-foreground">
                <Inbox className="size-7" />
                <span>No items</span>
              </CardContent>
            </Card>
          )}
        </section>

        <aside className="hidden min-w-0 border-l bg-background lg:block">
          <ScrollArea className="h-screen">
            {selected ? (
              <ItemDetail
                item={selected}
                connectors={connectors}
                onDelete={() => void deleteItem(selected.id)}
                onEnrich={() => void enrichItem(selected.id)}
                activity={activity}
                onPatch={(patch) => void patchItem(selected.id, patch)}
              />
            ) : (
              <div className="grid min-h-screen place-items-center text-muted-foreground">
                <Inbox className="mb-2 size-7" />
                <span>Select an item</span>
              </div>
            )}
          </ScrollArea>
        </aside>

        <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
          <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-xl">
            <SheetHeader className="sr-only">
              <SheetTitle>{selected?.title ?? "Saved item"}</SheetTitle>
            </SheetHeader>
            {selected ? (
              <ItemDetail
                item={selected}
                connectors={connectors}
                onDelete={() => void deleteItem(selected.id)}
                onEnrich={() => void enrichItem(selected.id)}
                activity={activity}
                onPatch={(patch) => void patchItem(selected.id, patch)}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      </main>
    </TooltipProvider>
  );
}

function CommandBar({
  commandValue,
  onCommandChange,
  onRun
}: {
  commandValue: string;
  onCommandChange: (value: string) => void;
  onRun: (event: FormEvent) => void;
}) {
  return (
    <Card className="gap-0 border-primary/20 bg-background p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <form className="flex items-center gap-2" onSubmit={onRun}>
        <div className="flex h-8 items-center gap-2 rounded-md border bg-muted px-2 font-mono text-xs text-muted-foreground">
          <Command className="size-3.5" />
          ctrl+k
        </div>
        <span className="font-mono text-sm text-primary">›</span>
        <Input
          id="huntter-command"
          className="h-8 border-0 bg-transparent px-0 font-mono shadow-none focus-visible:ring-0"
          value={commandValue}
          onChange={(event) => onCommandChange(event.target.value)}
          placeholder="/help, /unread, /x, /star, /refresh, /reload, or search"
        />
      </form>
    </Card>
  );
}

function CapturePanel({
  note,
  saving,
  tags,
  url,
  onNoteChange,
  onSave,
  onTagsChange,
  onUrlChange
}: {
  note: string;
  saving: boolean;
  tags: string;
  url: string;
  onNoteChange: (value: string) => void;
  onSave: (event: FormEvent) => void;
  onTagsChange: (value: string) => void;
  onUrlChange: (value: string) => void;
}) {
  return (
    <Card className="shrink-0 gap-3 border-dashed bg-muted/30 p-3" size="sm">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase text-muted-foreground">
        <Plus className="size-3.5" />
        capture
      </div>
      <form className="grid gap-2" onSubmit={onSave}>
        <div className="relative">
          <Plus className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-10 bg-background pl-9 font-mono"
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="Paste a URL"
            aria-label="URL"
          />
        </div>
        <Input
          className="bg-background font-mono"
          value={tags}
          onChange={(event) => onTagsChange(event.target.value)}
          placeholder="tags"
          aria-label="Tags"
        />
        <Textarea
          className="min-h-20 bg-background font-mono"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="note"
          aria-label="Note"
        />
        <Button className="h-10" type="submit" disabled={saving || !url.trim()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          <span>Save</span>
        </Button>
      </form>
    </Card>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="gap-1 p-3" size="sm">
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      <strong className="font-mono text-lg leading-none">{value}</strong>
    </Card>
  );
}

function ActivityLog({ className, entries }: { className?: string; entries: ActivityEntry[] }) {
  return (
    <Card className={cn("gap-3 p-3", className)} size="sm">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase text-muted-foreground">
        <Clock className="size-3.5" />
        run log
      </div>
      <div className="grid gap-2">
        {entries.slice(0, 5).map((entry) => (
          <div key={entry.id} className="grid gap-0.5 border-l border-border pl-2">
            <div className="flex items-center gap-2">
              <Badge variant={entry.kind === "command" ? "default" : "secondary"}>{entry.kind}</Badge>
              <span className="font-mono text-[11px] text-muted-foreground" data-visual-dynamic>
                {formatTime(entry.at)}
              </span>
            </div>
            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{entry.message}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ConnectorsPanel({
  actionProvider,
  className,
  connectors,
  onConnect,
  onDisconnect,
  onSync
}: {
  actionProvider: ConnectorProvider | null;
  className?: string;
  connectors: ConnectorView[];
  onConnect: (provider: ConnectorProvider) => void;
  onDisconnect: (provider: ConnectorProvider) => void;
  onSync: (provider: ConnectorProvider) => void;
}) {
  return (
    <Card className={cn("gap-3 p-3", className)} size="sm">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase text-muted-foreground">
        <Layers3 className="size-3.5" />
        connectors
      </div>
      <div className="grid gap-2">
        {connectors.map((connector) => {
          const busy = actionProvider === connector.provider;
          return (
            <div key={connector.provider} className="grid gap-2 rounded-md border bg-background/50 p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="grid min-w-0 gap-1">
                  <span className="truncate text-sm">{connector.label}</span>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={connector.connectionState === "connected" ? "default" : "outline"}>
                      {connectionStateLabel(connector.connectionState)}
                    </Badge>
                    {connector.availability === "planned" ? <Badge variant="secondary">planned</Badge> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {connector.connectionState === "not_connected" ? (
                    <IconTooltip label={`Connect ${connector.label}`}>
                      <Button
                        aria-label={`Connect ${connector.label}`}
                        className="size-7"
                        size="icon"
                        type="button"
                        variant="ghost"
                        onClick={() => onConnect(connector.provider)}
                        disabled={busy}
                      >
                        <ExternalLink className="size-3.5" />
                      </Button>
                    </IconTooltip>
                  ) : (
                    <IconTooltip label={`Sync ${connector.label}`}>
                      <Button
                        aria-label={`Sync ${connector.label}`}
                        className="size-7"
                        size="icon"
                        type="button"
                        variant="ghost"
                        onClick={() => onSync(connector.provider)}
                        disabled={busy}
                      >
                        <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
                      </Button>
                    </IconTooltip>
                  )}
                  {connector.connectionState !== "not_connected" ? (
                    <IconTooltip label={`Disconnect ${connector.label}`}>
                      <Button
                        aria-label={`Disconnect ${connector.label}`}
                        className="size-7"
                        size="icon"
                        type="button"
                        variant="ghost"
                        onClick={() => onDisconnect(connector.provider)}
                        disabled={busy}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </IconTooltip>
                  ) : null}
                </div>
              </div>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {connector.lastError ?? connector.accountLabel ?? connector.lastSyncAt ?? connector.provider}
              </span>
            </div>
          );
        })}
        {!connectors.length ? <span className="text-xs text-muted-foreground">No connectors</span> : null}
      </div>
    </Card>
  );
}

function CaptureEventsPanel({
  className,
  events,
  loading,
  onReload
}: {
  className?: string;
  events: CaptureEvent[];
  loading: boolean;
  onReload: () => void;
}) {
  return (
    <Card className={cn("gap-3 p-3", className)} size="sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase text-muted-foreground">
          <Clock className="size-3.5" />
          capture events
        </div>
        <IconTooltip label="Reload capture events">
          <Button
            aria-label="Reload capture events"
            className="size-7"
            size="icon"
            type="button"
            variant="ghost"
            onClick={onReload}
            disabled={loading}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </IconTooltip>
      </div>
      <div className="grid max-h-56 gap-2 overflow-y-auto pr-1">
        {events.length ? (
          events.map((event) => (
            <div key={event.id} className="grid gap-1 rounded-md border bg-background/50 p-2">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={event.resultState === "failed" || event.resultState === "needs_connector" ? "destructive" : "secondary"}>
                  {event.resultState}
                </Badge>
                <span className="font-mono text-[11px] text-muted-foreground" data-visual-dynamic>
                  {formatTime(event.createdAt)}
                </span>
              </div>
              <div className="truncate text-xs font-medium" title={event.sourceUrl}>
                {event.sourceType ? sourceLabel(event.sourceType) : "Source"} / {event.captureMethod}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                <span>{formatBytes(event.snapshotBytes)}</span>
                {event.recognitionDurationMs !== undefined ? (
                  <span data-visual-dynamic>{formatDuration(event.recognitionDurationMs)}</span>
                ) : null}
              </div>
              {event.error ? <p className="line-clamp-2 text-xs text-destructive">{event.error}</p> : null}
            </div>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">{loading ? "Loading events" : "No capture events"}</span>
        )}
      </div>
    </Card>
  );
}

function ItemCard({
  item,
  selected,
  onSelect,
  onPatch
}: {
  item: LibraryItem;
  selected: boolean;
  onSelect: () => void;
  onPatch: (patch: Partial<Pick<LibraryItem, "status" | "favorite">>) => void;
}) {
  return (
    <Card
      className={cn(
        "min-h-[360px] cursor-pointer gap-0 bg-background transition hover:-translate-y-0.5 hover:shadow-lg",
        selected && "ring-2 ring-primary/50"
      )}
      onClick={onSelect}
    >
      <Cover item={item} className="h-32 rounded-t-xl" />
      <CardHeader className="gap-2 pt-3">
        <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-muted-foreground">
          <span className="truncate">{item.sourceName}</span>
          <span className="shrink-0">{item.readingMinutes} min</span>
        </div>
        <CardTitle className="line-clamp-2 min-h-11 text-base">{item.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid flex-1 gap-3">
        <p className="line-clamp-3 min-h-16 text-sm leading-6 text-muted-foreground">{item.summary}</p>
        <div className="flex flex-wrap gap-1.5">
          {item.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t-0 bg-transparent">
        <IconTooltip label={item.favorite ? "Unfavorite" : "Favorite"}>
          <Button
            className={item.favorite ? "text-amber-600" : undefined}
            size="icon"
            type="button"
            variant="outline"
            onClick={(event) => {
              event.stopPropagation();
              onPatch({ favorite: !item.favorite });
            }}
          >
            <Star className="size-4" />
          </Button>
        </IconTooltip>
        <IconTooltip label={item.status === "read" ? "Mark unread" : "Mark read"}>
          <Button
            size="icon"
            type="button"
            variant="outline"
            onClick={(event) => {
              event.stopPropagation();
              onPatch({ status: item.status === "read" ? "unread" : "read" });
            }}
          >
            <CheckCircle2 className="size-4" />
          </Button>
        </IconTooltip>
      </CardFooter>
    </Card>
  );
}

function ItemDetail({
  activity,
  connectors,
  item,
  onPatch,
  onDelete,
  onEnrich
}: {
  activity: ActivityEntry[];
  connectors: ConnectorView[];
  item: LibraryItem;
  onPatch: (patch: Partial<Pick<LibraryItem, "status" | "favorite" | "tags" | "note">>) => void;
  onDelete: () => void;
  onEnrich: () => void;
}) {
  const [noteDraft, setNoteDraft] = useState({ itemId: item.id, value: item.note ?? "" });
  const localNote = noteDraft.itemId === item.id ? noteDraft.value : (item.note ?? "");
  const requiredConnector = findConnector(connectors, item.requiredConnector);

  return (
    <div className="grid gap-5 p-4 sm:p-6">
      <Cover item={item} className="h-48 rounded-xl" />

      <div className="grid grid-cols-[1fr_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{item.sourceName}</span>
            <SourceStateBadge item={item} />
          </div>
          <h2 className="font-mono text-2xl font-semibold leading-tight">{item.title}</h2>
        </div>
        <Button asChild size="icon" variant="outline">
          <a href={item.url} target="_blank" rel="noreferrer" title="Open source">
            <ExternalLink className="size-4" />
          </a>
        </Button>
      </div>

      <Tabs value={item.status} onValueChange={(status) => onPatch({ status: status as ItemStatus })}>
        <TabsList className="grid h-auto w-full grid-cols-4">
          {statusTabs.map((status) => (
            <TabsTrigger key={status} className="capitalize" value={status}>
              {status}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DetailSection icon={Sparkles} title="Summary">
        <p className="leading-7 text-muted-foreground">{item.summary}</p>
      </DetailSection>

      {item.contentHtml ? (
        <DetailSection icon={BookOpen} title="Reader">
          <ReaderFrame item={item} />
        </DetailSection>
      ) : null}

      <DetailSection icon={Tag} title="Tags">
        <div className="flex flex-wrap gap-1.5">
          {item.tags.length ? (
            item.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">No tags</span>
          )}
        </div>
      </DetailSection>

      <DetailSection icon={BookOpen} title="Excerpt">
        <p className="leading-7 text-muted-foreground">{item.excerpt || "No excerpt captured."}</p>
      </DetailSection>

      <DetailSection icon={Clock} title="Metadata">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Meta label="Type" value={sourceLabel(item.sourceType)} />
          <Meta label="Saved" value={formatDate(item.savedAt)} visualDynamic />
          <Meta label="Confidence" value={`${Math.round(item.confidence * 100)}%`} />
          <Meta label="Extractor" value={item.extractor ?? item.captureMethod ?? "unknown"} />
          {item.recognitionDurationMs !== undefined ? (
            <Meta label="Recognition" value={formatDuration(item.recognitionDurationMs)} visualDynamic />
          ) : null}
          {item.recognitionTiming ? <Meta label="Phases" value={formatRecognitionTiming(item.recognitionTiming)} visualDynamic /> : null}
        </dl>
      </DetailSection>

      <ActivityLog entries={activity} />

      <div className="grid gap-2">
        <h3 className="font-medium">Note</h3>
        <Textarea
          className="min-h-28"
          value={localNote}
          onChange={(event) => setNoteDraft({ itemId: item.id, value: event.target.value })}
        />
        <Button type="button" variant="outline" onClick={() => onPatch({ note: localNote })}>
          Save note
        </Button>
      </div>

      {item.enrichmentState !== "ready" || item.sourceMessage ? (
        <Alert variant={item.enrichmentState === "failed" || item.enrichmentState === "needs_connector" ? "destructive" : "default"}>
          <AlertTitle>{item.enrichmentState === "needs_connector" ? "Connector needed" : "Capture note"}</AlertTitle>
          <AlertDescription>
            {requiredConnector
              ? `${requiredConnector.label}: ${requiredConnector.setupMessage}`
              : item.sourceMessage || item.enrichmentError}
          </AlertDescription>
        </Alert>
      ) : null}

      <Separator />

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onEnrich}>
          <RefreshCw className="size-4" />
          <span>Refresh</span>
        </Button>
        <Button
          className={item.favorite ? "text-amber-600" : undefined}
          type="button"
          variant="outline"
          onClick={() => onPatch({ favorite: !item.favorite })}
        >
          <Star className="size-4" />
          <span>{item.favorite ? "Saved" : "Star"}</span>
        </Button>
        <Button type="button" variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4" />
          <span>Delete</span>
        </Button>
      </div>
    </div>
  );
}

function ReaderFrame({ item }: { item: LibraryItem }) {
  const srcDoc = useMemo(() => buildReaderDocument(item), [item]);

  return (
    <iframe
      className="h-[28rem] w-full rounded-lg border bg-background"
      referrerPolicy="no-referrer"
      sandbox=""
      srcDoc={srcDoc}
      title={`${item.title} reader`}
    />
  );
}

function buildReaderDocument(item: LibraryItem): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base target="_blank" />
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #fff;
        color: #24262b;
        font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
      }
      main {
        max-width: 720px;
        margin: 0 auto;
        padding: 28px;
      }
      h1, h2, h3 {
        color: #17191d;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.2;
      }
      h1 { font-size: 28px; margin: 0 0 18px; }
      h2 { font-size: 22px; margin: 28px 0 12px; }
      h3 { font-size: 18px; margin: 24px 0 10px; }
      p, li, blockquote { font-size: 17px; line-height: 1.76; }
      p { margin: 0 0 18px; }
      a { color: #0f766e; text-decoration-thickness: 1px; text-underline-offset: 3px; }
      blockquote {
        border-left: 3px solid #0f766e;
        color: #4b5563;
        margin: 22px 0;
        padding: 4px 0 4px 18px;
      }
      img, video {
        display: block;
        height: auto;
        max-width: 100%;
        border-radius: 8px;
        margin: 22px auto;
      }
      pre, code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }
      pre {
        overflow-x: auto;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #f8fafc;
        padding: 14px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 22px 0;
      }
      th, td {
        border: 1px solid #e5e7eb;
        padding: 8px 10px;
        vertical-align: top;
      }
    </style>
  </head>
  <body>
    <main aria-label="${escapeAttribute(item.title)}">${item.contentHtml ?? ""}</main>
  </body>
</html>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function Cover({ item, className }: { item: LibraryItem; className?: string }) {
  return (
    <div
      className={cn(
        "relative grid place-items-center overflow-hidden bg-[linear-gradient(135deg,rgba(20,184,166,.12),rgba(245,158,11,.10))] text-primary",
        className
      )}
      style={{
        backgroundImage: item.coverImage ? `url(${item.coverImage})` : undefined,
        backgroundPosition: "center",
        backgroundSize: "cover"
      }}
    >
      {!item.coverImage ? <Sparkles className="size-7" /> : null}
      <Badge className="absolute bottom-3 left-3 bg-background/90 text-foreground shadow-sm" variant="outline">
        {sourceLabel(item.sourceType)}
      </Badge>
    </div>
  );
}

function SourceStateBadge({ item }: { item: LibraryItem }) {
  if (item.enrichmentState === "processing") {
    return (
      <Badge variant="outline">
        <Loader2 className="size-3 animate-spin" />
        processing
      </Badge>
    );
  }

  if (item.enrichmentState === "ready") {
    return <Badge variant="secondary">{item.captureMethod ?? "ready"}</Badge>;
  }

  return (
    <Badge variant={item.enrichmentState === "needs_connector" || item.enrichmentState === "failed" ? "destructive" : "outline"}>
      {item.enrichmentState}
    </Badge>
  );
}

function DetailSection({ children, icon: Icon, title }: { children: React.ReactNode; icon: typeof Sparkles; title: string }) {
  return (
    <section className="grid gap-3 border-t pt-4">
      <h3 className="flex items-center gap-2 font-medium">
        <Icon className="size-4" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Meta({ label, value, visualDynamic = false }: { label: string; value: string; visualDynamic?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-mono font-medium" data-visual-dynamic={visualDynamic ? true : undefined} title={value}>
        {value}
      </dd>
    </div>
  );
}

function IconTooltip({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
      {[1, 2, 3].map((item) => (
        <Card key={item} className="min-h-[380px] gap-4">
          <Skeleton className="h-40 rounded-t-xl" />
          <CardHeader>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-6 w-4/5" />
          </CardHeader>
          <CardContent className="grid gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function splitTags(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function mergeItems(current: LibraryItem[], incoming: LibraryItem[]): LibraryItem[] {
  const byId = new Map<string, LibraryItem>();
  for (const item of [...current, ...incoming]) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

function countForFilter(stats: LibraryStats, key: FilterKey): number {
  if (key === "all") return stats.total;
  if (key === "favorite") return stats.favorite;
  return stats[key];
}

function activeFilterTitle(filter: FilterKey): string {
  return filters.find((entry) => entry.key === filter)?.label ?? "Library";
}

function sourceLabel(sourceType: SourceType): string {
  return {
    article: "Article",
    post: "Post",
    tweet: "X",
    feishu: "Feishu",
    video: "Video",
    pdf: "PDF",
    other: "Link"
  }[sourceType];
}

function connectionStateLabel(state: ConnectorView["connectionState"]): string {
  return {
    not_connected: "not connected",
    connected: "connected",
    error: "error",
    disabled: "disabled"
  }[state];
}

function findConnector(connectors: ConnectorView[], provider: ConnectorProvider | undefined): ConnectorView | undefined {
  if (!provider) return undefined;
  return connectors.find((connector) => connector.provider === provider);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function formatDuration(value: number): string {
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRecognitionTiming(timing: NonNullable<LibraryItem["recognitionTiming"]>): string {
  return [
    `src ${formatDuration(timing.sourceAdapterMs)}`,
    `signals ${formatDuration(timing.contentSignalsMs)}`,
    `build ${formatDuration(timing.itemBuildMs)}`
  ].join(" / ");
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}
