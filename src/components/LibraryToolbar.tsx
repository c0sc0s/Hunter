import { RefreshCw, Search, X } from "lucide-react";
import type { LibraryPage, LibraryStats } from "../../shared/types";
import type { FilterKey } from "../types";
import { AgentCategoryFilters } from "./AgentCategoryFilters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { activeFilterTitle } from "@/lib/labels";

export function LibraryToolbar({
  filter,
  stats,
  page,
  visibleCount,
  query,
  selectedAgentCategoryId,
  agentClassifying,
  agentClassifyError,
  onQueryChange,
  onAgentCategoryChange,
  onClassifyIncremental,
  onReload
}: {
  filter: FilterKey;
  stats: LibraryStats;
  page: LibraryPage;
  visibleCount: number;
  query: string;
  selectedAgentCategoryId: string | null;
  agentClassifying: boolean;
  agentClassifyError: string | null;
  onQueryChange: (query: string) => void;
  onAgentCategoryChange: (categoryId: string | null) => void;
  onClassifyIncremental: () => void;
  onReload: () => void;
}) {
  return (
    <div className="mb-4 grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-[16px]">
        <h2 className="truncate text-3xl font-semibold tracking-tight">{activeFilterTitle(filter)}</h2>
        <div className="hunter-window-no-drag relative z-40 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{visibleCount} visible</span>
          <span>/</span>
          <span>{page.total} matched</span>
          <span>/</span>
          <span>{stats.total} indexed</span>
          <Button className="hunter-window-no-drag ml-2 h-7 gap-1 px-2 text-xs" type="button" variant="outline" onClick={onReload}>
            <RefreshCw className="size-3.5" />
            Reload
          </Button>
        </div>
      </div>

      <div className="hunter-window-no-drag relative z-40 w-full">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="hunter-window-no-drag h-10 bg-card pl-9 pr-10 text-sm shadow-xs"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search saved items"
          aria-label="Search"
        />
        {query ? (
          <Button
            className="hunter-window-no-drag absolute right-1 top-1 size-8"
            size="icon"
            variant="ghost"
            type="button"
            title="Clear"
            onClick={() => onQueryChange("")}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>

      <AgentCategoryFilters
        categories={stats.agentCategories}
        selectedCategoryId={selectedAgentCategoryId}
        classifying={agentClassifying}
        error={agentClassifyError}
        onChange={onAgentCategoryChange}
        onClassifyIncremental={onClassifyIncremental}
      />
    </div>
  );
}
