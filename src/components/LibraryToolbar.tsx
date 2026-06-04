import { RefreshCw, Search, X } from "lucide-react";
import type { LibraryPage, LibraryStats } from "../../shared/types";
import type { FilterKey, SourceFilter } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { activeFilterTitle, sourceLabel } from "@/lib/labels";

export function LibraryToolbar({
  filter,
  sourceFilter,
  stats,
  page,
  visibleCount,
  query,
  onQueryChange,
  onReload
}: {
  filter: FilterKey;
  sourceFilter: SourceFilter;
  stats: LibraryStats;
  page: LibraryPage;
  visibleCount: number;
  query: string;
  onQueryChange: (query: string) => void;
  onReload: () => void;
}) {
  return (
    <div className="mb-4 grid gap-4">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          workspace / {sourceFilter === "all" ? "all sources" : sourceLabel(sourceFilter)}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h2 className="truncate text-3xl font-semibold tracking-tight">{activeFilterTitle(filter)}</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{visibleCount} visible</span>
            <span>/</span>
            <span>{page.total} matched</span>
            <span>/</span>
            <span>{stats.total} indexed</span>
            <Button className="ml-2 h-7 gap-1 px-2 text-xs" type="button" variant="outline" onClick={onReload}>
              <RefreshCw className="size-3.5" />
              Reload
            </Button>
          </div>
        </div>
      </div>

      <div className="relative w-full">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-10 bg-card pl-9 pr-10 text-sm shadow-xs"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
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
            onClick={() => onQueryChange("")}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
