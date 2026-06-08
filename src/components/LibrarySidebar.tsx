import type { LibraryStats } from "../../shared/types";
import type { FilterKey, SourceFilter } from "../types";
import { FilterNav } from "./FilterNav";
import { MetricCard } from "./MetricCard";
import { SettingsPanel } from "./SettingsPanel";
import { SourceFilterBadges } from "./SourceFilterBadges";
import { cn } from "@/lib/utils";

const hunterMarkUrl = new URL("../../assets/brand/hunter-mark.svg", import.meta.url).href;

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
        "hunter-panel-top min-w-0 overflow-hidden bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:block lg:h-full",
        collapsed && "lg:pointer-events-none"
      )}
    >
      <div className="hunter-sidebar-content flex h-full w-full flex-col overflow-y-auto px-3.5 pb-3.5 pt-4 lg:w-[var(--library-sidebar-expanded-width)] lg:pt-11">
        <div className="hunter-sidebar-brand" aria-label="Hunter">
          <span className="hunter-sidebar-brand-mark" aria-hidden="true">
            <img src={hunterMarkUrl} alt="" className="size-3.5" />
          </span>
          <span className="hunter-sidebar-brand-copy">
            <span className="hunter-sidebar-brand-name">Hunter</span>
          </span>
        </div>

        <div className="grid shrink-0 gap-3">
          <FilterNav active={filter} stats={stats} onChange={onFilterChange} />

          <SourceFilterBadges active={sourceFilter} stats={stats} onChange={onSourceFilterChange} />
        </div>

        <div className="hunter-sidebar-metrics mt-4 grid shrink-0 grid-cols-2 gap-2 lg:mt-auto">
          <MetricCard label="Saved" value={stats.total} />
          <MetricCard label="Unread" value={stats.unread} />
        </div>

        <div className="hunter-sidebar-settings">
          <SettingsPanel triggerClassName="hunter-sidebar-settings-button" showTriggerLabel />
        </div>
      </div>
    </aside>
  );
}
