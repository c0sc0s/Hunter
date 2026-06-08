import { Loader2, Sparkles, WandSparkles, X } from "lucide-react";
import type { AgentContentCategorySummary } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AgentCategoryFilters({
  categories,
  selectedCategoryId,
  classifying,
  error,
  onChange,
  onClassifyIncremental
}: {
  categories: AgentContentCategorySummary[];
  selectedCategoryId: string | null;
  classifying: boolean;
  error: string | null;
  onChange: (categoryId: string | null) => void;
  onClassifyIncremental: () => void;
}) {
  const classifiedCount = categories.reduce((total, category) => total + category.count, 0);

  return (
    <section className="hunter-agent-filter-panel hunter-window-no-drag" aria-label="AI category filters">
      <div className="hunter-agent-filter-header">
        <div className="hunter-agent-filter-title">
          <Sparkles className="size-3.5" />
          <span>AI topics</span>
          {selectedCategoryId ? (
            <Button className="hunter-agent-filter-clear" size="icon-sm" type="button" variant="ghost" onClick={() => onChange(null)}>
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <Button
          className="hunter-agent-analyze-button"
          disabled={classifying}
          size="sm"
          type="button"
          variant="outline"
          onClick={onClassifyIncremental}
        >
          {classifying ? <Loader2 className="size-3.5 animate-spin" /> : <WandSparkles className="size-3.5" />}
          <span>{classifying ? "Analyzing" : "Analyze"}</span>
        </Button>
      </div>

      <div className="hunter-agent-filter-chips" aria-label="AI topics">
        <CategoryChip active={!selectedCategoryId} count={classifiedCount} label="All" onClick={() => onChange(null)} />
        {categories.map((category) => (
          <CategoryChip
            key={category.id}
            active={selectedCategoryId === category.id}
            count={category.count}
            label={category.label}
            title={category.description}
            onClick={() => onChange(category.id)}
          />
        ))}
      </div>

      {error ? <p className="hunter-agent-filter-error">{error}</p> : null}
    </section>
  );
}

function CategoryChip({
  active,
  count,
  label,
  title,
  onClick
}: {
  active: boolean;
  count: number;
  label: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn("hunter-agent-filter-chip", active && "hunter-agent-filter-chip-active")}
      data-active={active ? "true" : "false"}
      title={title}
      type="button"
      onClick={onClick}
    >
      <span className="hunter-agent-filter-chip-label">{label}</span>
      <span className="hunter-agent-filter-chip-count">{count}</span>
    </button>
  );
}
