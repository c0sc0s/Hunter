import { CheckCircle2, ExternalLink, Inbox, Layers3, Loader2, RefreshCw, Search, Sparkles, Star, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConnectorOAuthStartResponse,
  ConnectorProvider,
  ConnectorSyncResponse,
  ConnectorView,
  ConnectorsResponse,
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type FilterKey = "all" | "unread" | "read" | "favorite";
type SourceFilter = "all" | SourceType;
type ReadState = "unread" | "read";

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
  { key: "read", label: "Read", icon: CheckCircle2 },
  { key: "favorite", label: "Favorites", icon: Star }
];

const readStates: ReadState[] = ["unread", "read"];

export function App() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const itemsRef = useRef<LibraryItem[]>([]);
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [stats, setStats] = useState<LibraryStats>(emptyStats);
  const [page, setPage] = useState<LibraryPage>(emptyPage);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [connectorAction, setConnectorAction] = useState<ConnectorProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setError(connectorError instanceof Error ? connectorError.message : "Could not load connectors");
    }
  }, []);

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
          void loadConnectors();
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
    [buildItemsUrl, loadConnectors]
  );

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => {
        void loadItems({ showLoading: true });
      },
      query.trim() ? 250 : 0
    );

    return () => window.clearTimeout(timeout);
  }, [loadItems, query]);

  async function patchItem(id: string, patch: Partial<Pick<LibraryItem, "status" | "favorite" | "tags" | "note">>) {
    const response = await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });

    if (!response.ok) throw new Error(`Could not update item: HTTP ${response.status}`);
    const updated = (await response.json()) as LibraryItem;
    setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    await loadItems();
  }

  async function deleteItem(id: string) {
    const response = await fetch(`/api/items/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`Could not delete item: HTTP ${response.status}`);
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedId(null);
    setDetailOpen(false);
    await loadItems();
  }

  async function enrichItem(id: string) {
    const response = await fetch(`/api/items/${id}/enrich`, { method: "POST" });
    if (!response.ok) throw new Error(`Could not enrich item: HTTP ${response.status}`);
    const updated = (await response.json()) as LibraryItem;
    setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    await loadItems();
  }

  async function syncConnector(provider: ConnectorProvider) {
    setConnectorAction(provider);
    try {
      const response = await fetch(`/api/connectors/${provider}/sync`, { method: "POST" });
      const body = (await response.json()) as ConnectorSyncResponse;
      if (!response.ok) {
        setError(body.error ?? `Could not sync ${provider}.`);
        return;
      }
      await loadItems({ showLoading: true });
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Could not sync connector");
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
        setError(`${body.error ?? `Could not start ${provider} OAuth.`}${missing}`);
        return;
      }

      window.open(body.authorizationUrl, "_blank", "noopener,noreferrer");
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not start connector authorization");
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
      await response.json();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Could not disconnect connector");
    } finally {
      setConnectorAction(null);
      await loadConnectors();
    }
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
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">bookmark library</p>
            </div>
          </div>

          <nav className="grid shrink-0 gap-1" aria-label="Library filters">
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

          <div className="mt-5 grid shrink-0 grid-cols-2 gap-2 lg:mt-auto">
            <MetricCard label="Saved" value={stats.total} />
            <MetricCard label="Unread" value={stats.unread} />
          </div>
        </aside>

        <section className="min-w-0 bg-muted/20 p-4 sm:p-6">
          <header className="mb-4 grid gap-4">
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
                onPatch={(patch) => void patchItem(selected.id, patch)}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      </main>
    </TooltipProvider>
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
          <span className="shrink-0" data-visual-dynamic>
            {formatDate(item.savedAt)}
          </span>
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
          <Badge variant={readState(item) === "read" ? "default" : "outline"}>{readStateLabel(readState(item))}</Badge>
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t-0 bg-transparent">
        <IconTooltip label="Open link">
          <Button asChild size="icon" variant="outline" onClick={(event) => event.stopPropagation()}>
            <a href={item.url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
            </a>
          </Button>
        </IconTooltip>
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
        <IconTooltip label={readState(item) === "read" ? "Mark unread" : "Mark read"}>
          <Button
            size="icon"
            type="button"
            variant="outline"
            onClick={(event) => {
              event.stopPropagation();
              onPatch({ status: readState(item) === "read" ? "unread" : "read" });
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
  connectors,
  item,
  onPatch,
  onDelete,
  onEnrich
}: {
  connectors: ConnectorView[];
  item: LibraryItem;
  onPatch: (patch: Partial<Pick<LibraryItem, "status" | "favorite" | "tags" | "note">>) => void;
  onDelete: () => void;
  onEnrich: () => void;
}) {
  const requiredConnector = findConnector(connectors, item.requiredConnector);
  const overview = item.summary || item.excerpt || item.readableText || "No overview captured yet.";

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
        <Button asChild className="shrink-0" variant="outline">
          <a href={item.url} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
            <span>Open link</span>
          </a>
        </Button>
      </div>

      <Tabs value={readState(item)} onValueChange={(status) => onPatch({ status: status as ReadState })}>
        <TabsList className="grid h-auto w-full grid-cols-2">
          {readStates.map((status) => (
            <TabsTrigger key={status} value={status}>
              {readStateLabel(status)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DetailSection icon={Sparkles} title="Overview">
        <p className="leading-7 text-muted-foreground">{overview}</p>
        <dl className="grid gap-3 text-sm">
          <Meta label="Saved" value={formatDate(item.savedAt)} visualDynamic />
        </dl>
      </DetailSection>

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
        <Button asChild variant="default">
          <a href={item.url} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
            <span>Open link</span>
          </a>
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

function readState(item: LibraryItem): ReadState {
  return item.status === "read" ? "read" : "unread";
}

function readStateLabel(state: ReadState): string {
  return state === "read" ? "Read" : "Unread";
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
