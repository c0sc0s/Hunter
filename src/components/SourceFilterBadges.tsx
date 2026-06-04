import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import type { LibraryStats, SourceType } from "../../shared/types";
import type { SourceFilter } from "../types";
import { Badge } from "@/components/ui/badge";
import { sourceLabel } from "@/lib/labels";

export function SourceFilterBadges({
  stats,
  active,
  onChange
}: {
  stats: LibraryStats;
  active: SourceFilter;
  onChange: (filter: SourceFilter) => void;
}) {
  const sourceCounts = useMemo(() => {
    return (Object.entries(stats.sources) as Array<[SourceType, number]>).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
  }, [stats.sources]);

  const [badgesRef] = useAutoAnimate<HTMLDivElement>({ duration: 200, easing: "ease-out" });

  return (
    <div className="mt-4 shrink-0 rounded-lg border border-sidebar-border bg-sidebar-accent/45 p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Sparkles className="size-3.5" />
        sources
      </div>
      <div ref={badgesRef} className="flex flex-wrap gap-1.5">
        <Badge className="cursor-pointer" variant={active === "all" ? "default" : "outline"} onClick={() => onChange("all")}>
          all {stats.total}
        </Badge>
        {sourceCounts.map(([source, count]) => (
          <Badge
            key={source}
            className="cursor-pointer"
            variant={active === source ? "default" : "outline"}
            onClick={() => onChange(source)}
          >
            {sourceLabel(source)} {count}
          </Badge>
        ))}
      </div>
    </div>
  );
}
