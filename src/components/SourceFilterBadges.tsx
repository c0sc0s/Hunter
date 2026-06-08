import { useAutoAnimate } from "@formkit/auto-animate/react";
import { AtSign, FileText, Layers2, Link2, MessageCircle, Newspaper, Play, Waypoints, type LucideIcon } from "lucide-react";
import { useMemo } from "react";
import type { LibraryStats, SourceType } from "../../shared/types";
import type { SourceFilter } from "../types";
import { sourceLabel } from "@/lib/labels";

const sourceIcons: Record<SourceType, LucideIcon> = {
  article: Newspaper,
  post: MessageCircle,
  tweet: AtSign,
  feishu: FileText,
  video: Play,
  pdf: FileText,
  other: Link2
};

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
    <section className="hunter-source-panel shrink-0" aria-label="Source filters">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="hunter-source-panel-icon">
          <Waypoints className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Sources</p>
          <p className="text-[10px] text-muted-foreground/70">
            {sourceCounts.length} type{sourceCounts.length === 1 ? "" : "s"} visible
          </p>
        </div>
      </div>
      <div ref={badgesRef} className="grid gap-1">
        <SourceFilterButton
          active={active === "all"}
          count={stats.total}
          icon={Layers2}
          label="All"
          source="all"
          onClick={() => onChange("all")}
        />
        {sourceCounts.map(([source, count]) => (
          <SourceFilterButton
            key={source}
            active={active === source}
            count={count}
            icon={sourceIcons[source]}
            label={sourceLabel(source)}
            source={source}
            onClick={() => onChange(source)}
          />
        ))}
      </div>
    </section>
  );
}

function SourceFilterButton({
  active,
  count,
  icon: Icon,
  label,
  source,
  onClick
}: {
  active: boolean;
  count: number;
  icon: LucideIcon;
  label: string;
  source: SourceFilter;
  onClick: () => void;
}) {
  return (
    <button
      className="hunter-source-filter"
      data-source={source}
      data-active={active ? "true" : "false"}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="hunter-source-filter-mark" aria-hidden="true" />
      <span className="hunter-source-filter-icon">
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <span className="hunter-source-filter-count">{count}</span>
    </button>
  );
}
