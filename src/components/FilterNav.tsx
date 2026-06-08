import type { LibraryStats } from "../../shared/types";
import { filters } from "../constants";
import type { FilterKey } from "../types";
import { countForFilter } from "@/lib/items";

export function FilterNav({ active, stats, onChange }: { active: FilterKey; stats: LibraryStats; onChange: (filter: FilterKey) => void }) {
  return (
    <nav className="hunter-filter-nav" aria-label="Library filters">
      {filters.map((entry) => {
        const Icon = entry.icon;
        const count = countForFilter(stats, entry.key);
        const isActive = entry.key === active;

        return (
          <button
            key={entry.key}
            className="hunter-filter-row"
            data-active={isActive ? "true" : "false"}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(entry.key)}
          >
            <span className="hunter-filter-row-mark" aria-hidden="true" />
            <Icon className="hunter-filter-row-icon" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
            <span className="hunter-filter-row-count">{count}</span>
          </button>
        );
      })}
    </nav>
  );
}
