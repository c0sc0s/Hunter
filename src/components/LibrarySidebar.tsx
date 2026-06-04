import type { LibraryStats } from "../../shared/types";
import type { FilterKey, SourceFilter } from "../types";
import { FilterNav } from "./FilterNav";
import { MetricCard } from "./MetricCard";
import { SourceFilterBadges } from "./SourceFilterBadges";
import { cn } from "@/lib/utils";

export function LibrarySidebar({
  stats,
  filter,
  onFilterChange,
  sourceFilter,
  onSourceFilterChange,
  collapsed
}: {
  stats: LibraryStats;
  filter: FilterKey;
  onFilterChange: (filter: FilterKey) => void;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (filter: SourceFilter) => void;
  collapsed: boolean;
}) {
  return (
    <aside
      id="library-sidebar"
      aria-label="Library navigation"
      aria-hidden={collapsed}
      className={cn(
        "hunter-panel-top min-w-0 bg-sidebar p-4 text-sidebar-foreground transition-[opacity,padding,transform] duration-[var(--motion-slow)] ease-[var(--ease-out-soft)] lg:sticky lg:top-0 lg:flex lg:h-full lg:flex-col lg:overflow-y-auto lg:pt-11",
        collapsed && "lg:pointer-events-none lg:overflow-hidden lg:p-0 lg:opacity-0"
      )}
    >
      <FilterNav active={filter} stats={stats} onChange={onFilterChange} />

      <SourceFilterBadges active={sourceFilter} stats={stats} onChange={onSourceFilterChange} />

      <div className="mt-5 grid shrink-0 grid-cols-2 gap-2 lg:mt-auto">
        <MetricCard label="Saved" value={stats.total} />
        <MetricCard label="Unread" value={stats.unread} />
      </div>
    </aside>
  );
}
