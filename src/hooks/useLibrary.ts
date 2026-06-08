import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryPage, LibraryStats, PublicLibraryItem, UpdateItemInput } from "../../shared/types";
import { emptyPage, emptyStats, pageSize } from "../constants";
import {
  classifyIncrementalLibraryItems,
  classifyLibraryItem,
  deleteLibraryItem,
  fetchAgentLlmStatus,
  fetchLibrary,
  patchLibraryItem
} from "../lib/api";
import { itemNeedsAgentClassification } from "../lib/agent";
import { mergeItems } from "../lib/items";
import { updateStatsForDelete, updateStatsForPatch } from "../lib/stats";
import type { FilterKey, SourceFilter } from "../types";

type LoadOptions = {
  append?: boolean;
  offset?: number;
  showLoading?: boolean;
};

const loadingRevealDelayMs = 120;
const loadingMinVisibleMs = 420;

export type UseLibrary = {
  items: PublicLibraryItem[];
  stats: LibraryStats;
  page: LibraryPage;
  filter: FilterKey;
  setFilter: (filter: FilterKey) => void;
  sourceFilter: SourceFilter;
  setSourceFilter: (sourceFilter: SourceFilter) => void;
  agentCategoryId: string | null;
  setAgentCategoryId: (agentCategoryId: string | null) => void;
  query: string;
  setQuery: (query: string) => void;
  selected: PublicLibraryItem | null;
  selectItem: (id: string) => void;
  closeDetail: () => void;
  detailOpen: boolean;
  setDetailOpen: (open: boolean) => void;
  loading: boolean;
  loadingMore: boolean;
  agentClassifying: boolean;
  agentClassifyError: string | null;
  error: string | null;
  reload: () => void;
  loadMore: () => void;
  patchItem: (id: string, patch: UpdateItemInput) => Promise<void>;
  classifyItem: (id: string) => Promise<void>;
  classifyIncremental: () => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
};

export function useLibrary(): UseLibrary {
  const [items, setItems] = useState<PublicLibraryItem[]>([]);
  const itemsRef = useRef<PublicLibraryItem[]>([]);
  const [stats, setStats] = useState<LibraryStats>(emptyStats);
  const [page, setPage] = useState<LibraryPage>(emptyPage);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [agentCategoryId, setAgentCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const loadingVisibleRef = useRef(true);
  const loadingRunRef = useRef(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [agentClassifying, setAgentClassifying] = useState(false);
  const [agentClassifyError, setAgentClassifyError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoClassifyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const setLoadingVisible = useCallback((visible: boolean) => {
    loadingVisibleRef.current = visible;
    setLoading(visible);
  }, []);

  const loadItems = useCallback(
    async ({ append = false, offset = 0, showLoading = false }: LoadOptions = {}) => {
      const loadingRunId = showLoading && !append ? loadingRunRef.current + 1 : loadingRunRef.current;
      let loadingShownAt: number | null = null;
      let loadingDelayId: number | undefined;

      if (showLoading) {
        if (!append) {
          loadingRunRef.current = loadingRunId;
        }

        const canKeepCurrentContent = !loadingVisibleRef.current && itemsRef.current.length > 0;
        if (canKeepCurrentContent) {
          loadingDelayId = window.setTimeout(() => {
            loadingShownAt = performance.now();
            setLoadingVisible(true);
          }, loadingRevealDelayMs);
        } else {
          loadingShownAt = performance.now();
          setLoadingVisible(true);
        }
      }
      if (append) {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const data = await fetchLibrary({
          limit: pageSize,
          offset,
          filter: filter === "all" ? undefined : filter,
          sourceType: sourceFilter === "all" ? undefined : sourceFilter,
          agentCategoryId: agentCategoryId ?? undefined,
          q: query.trim() || undefined
        });
        const nextItems = append ? mergeItems(itemsRef.current, data.items) : data.items;
        const currentSelectedId = selectedIdRef.current;
        const nextSelectedId =
          currentSelectedId && nextItems.some((item) => item.id === currentSelectedId) ? currentSelectedId : (nextItems[0]?.id ?? null);
        itemsRef.current = nextItems;
        setItems(nextItems);
        setStats(data.stats);
        setPage(data.page);
        setSelectedId(nextSelectedId);
        selectedIdRef.current = nextSelectedId;
        if (!nextSelectedId) {
          setDetailOpen(false);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load library");
      } finally {
        if (showLoading) {
          if (loadingDelayId !== undefined) {
            window.clearTimeout(loadingDelayId);
          }

          if (loadingShownAt !== null) {
            await delay(Math.max(0, loadingMinVisibleMs - (performance.now() - loadingShownAt)));
          }

          if (append || loadingRunRef.current === loadingRunId) {
            setLoadingVisible(false);
          }
        }
        if (append) {
          setLoadingMore(false);
        }
      }
    },
    [agentCategoryId, filter, query, setLoadingVisible, sourceFilter]
  );

  useEffect(() => {
    const timeout = window.setTimeout(
      () => {
        void loadItems({ showLoading: true });
      },
      query.trim() ? 250 : 0
    );

    return () => window.clearTimeout(timeout);
  }, [loadItems, query]);

  const patchItem = useCallback(
    async (id: string, patch: UpdateItemInput) => {
      // Swap the item in place and adjust the stats counters locally so the UI
      // updates immediately. We skip the full library reload because the patch
      // response already carries the authoritative item, and reloading was
      // racing the auto-animate transitions on each toggle.
      try {
        const updated = await patchLibraryItem(id, patch);
        setItems((current) => current.map((item) => (item.id === id ? updated : item)));
        setStats((current) => updateStatsForPatch(current, itemsRef.current, id, updated));
      } catch (patchError) {
        setError(patchError instanceof Error ? patchError.message : "Could not update item");
        await loadItems();
      }
    },
    [loadItems]
  );

  const classifyItem = useCallback(
    async (id: string) => {
      try {
        setAgentClassifyError(null);
        const updated = await classifyLibraryItem(id);
        setItems((current) => current.map((item) => (item.id === id ? updated : item)));
        await loadItems();
      } catch (classifyError) {
        const message = classifyError instanceof Error ? classifyError.message : "Could not classify item";
        setAgentClassifyError(message);
        setError(message);
        throw classifyError;
      }
    },
    [loadItems]
  );

  const classifyIncremental = useCallback(
    async (showError = true) => {
      if (agentClassifying) return;

      setAgentClassifying(true);
      if (showError) setAgentClassifyError(null);
      try {
        const result = await classifyIncrementalLibraryItems(6);
        if (result.classified > 0) {
          await loadItems();
        }
      } catch (classifyError) {
        const message = classifyError instanceof Error ? classifyError.message : "Could not classify new items";
        if (showError) {
          setAgentClassifyError(message);
          setError(message);
        }
        throw classifyError;
      } finally {
        setAgentClassifying(false);
      }
    },
    [agentClassifying, loadItems]
  );

  useEffect(() => {
    if (loading || agentClassifying || !items.length) return;

    const staleIds = items.filter(itemNeedsAgentClassification).map((item) => item.id);
    if (!staleIds.length) return;

    const key = staleIds.join("|");
    if (autoClassifyKeyRef.current === key) return;
    autoClassifyKeyRef.current = key;

    void (async () => {
      try {
        const status = await fetchAgentLlmStatus();
        if (!status.ok) return;
        await classifyIncremental(false);
      } catch {
        // Manual classification surfaces the actionable error. The automatic
        // pass only runs when the model is reachable, so failed probes stay quiet.
      }
    })();
  }, [agentClassifying, classifyIncremental, items, loading]);

  const deleteItem = useCallback(
    async (id: string) => {
      try {
        await deleteLibraryItem(id);
        const removed = itemsRef.current.find((item) => item.id === id);
        setItems((current) => current.filter((item) => item.id !== id));
        setSelectedId(null);
        selectedIdRef.current = null;
        setDetailOpen(false);
        if (removed) {
          setStats((current) => updateStatsForDelete(current, removed));
        }
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : "Could not delete item");
        await loadItems();
      }
    },
    [loadItems]
  );

  const selectItem = useCallback((id: string) => {
    setSelectedId(id);
    selectedIdRef.current = id;
    setDetailOpen(true);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
  }, []);

  const reload = useCallback(() => {
    void loadItems({ showLoading: true });
  }, [loadItems]);

  const loadMore = useCallback(() => {
    void loadItems({ append: true, offset: itemsRef.current.length });
  }, [loadItems]);

  const selected = useMemo(() => {
    return items.find((item) => item.id === selectedId) ?? null;
  }, [items, selectedId]);

  return {
    items,
    stats,
    page,
    filter,
    setFilter,
    sourceFilter,
    setSourceFilter,
    agentCategoryId,
    setAgentCategoryId,
    query,
    setQuery,
    selected,
    selectItem,
    closeDetail,
    detailOpen,
    setDetailOpen,
    loading,
    loadingMore,
    agentClassifying,
    agentClassifyError,
    error,
    reload,
    loadMore,
    patchItem,
    classifyItem,
    classifyIncremental: () => classifyIncremental(true),
    deleteItem
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
