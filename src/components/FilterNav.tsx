import type { LibraryStats } from "../../shared/types";
import { filters } from "../constants";
import type { FilterKey } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { countForFilter } from "@/lib/items";

export function FilterNav({ active, stats, onChange }: { active: FilterKey; stats: LibraryStats; onChange: (filter: FilterKey) => void }) {
  return (
    <nav className="grid shrink-0 gap-1" aria-label="Library filters">
      {filters.map((entry) => {
        const Icon = entry.icon;
        const count = countForFilter(stats, entry.key);
        return (
          <Button
            key={entry.key}
            variant={entry.key === active ? "default" : "ghost"}
            className="h-10 justify-start px-2 data-[variant=default]:shadow-xs"
            type="button"
            onClick={() => onChange(entry.key)}
          >
            <Icon className="size-4" />
            <span className="flex-1 text-left">{entry.label}</span>
            <Badge variant={entry.key === active ? "secondary" : "outline"}>{count}</Badge>
          </Button>
        );
      })}
    </nav>
  );
}
