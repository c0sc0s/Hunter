import { Inbox, Loader2, RefreshCw } from "lucide-react";
import { useCallback } from "react";
import type { LibraryPage, PublicLibraryItem, UpdateItemInput } from "../../shared/types";
import { ItemCard } from "./ItemCard";
import { LoadingGrid } from "./LoadingGrid";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getItemCoverImage } from "@/lib/cover";
import { useResponsiveMasonry } from "@/hooks/useResponsiveMasonry";

export function LibraryGrid({
  items,
  page,
  selectedId,
  loading,
  loadingMore,
  onSelect,
  onPatch,
  onLoadMore
}: {
  items: PublicLibraryItem[];
  page: LibraryPage;
  selectedId: string | null;
  loading: boolean;
  loadingMore: boolean;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: UpdateItemInput) => void;
  onLoadMore: () => void;
}) {
  const estimateItemWeight = useCallback((item: PublicLibraryItem) => {
    const hasCover = Boolean(getItemCoverImage(item));
    const titleLines = Math.min(2, Math.max(1, Math.ceil(item.title.length / 34)));
    const summaryLines = Math.min(2, Math.max(1, Math.ceil(item.summary.length / 70)));
    const tagRows = item.tags.length > 0 ? 0.6 : 0;
    return (hasCover ? 7.5 : 2.4) + titleLines * 1.25 + summaryLines + tagRows;
  }, []);
  const { columnWidth, columns, containerWidth, gap, setContainerElement } = useResponsiveMasonry(items, estimateItemWeight);

  if (loading) {
    return <LoadingGrid />;
  }

  if (!items.length) {
    return (
      <Card className="grid min-h-[260px] place-items-center border-border/70 bg-card/80">
        <CardContent className="flex flex-col items-center gap-2 text-muted-foreground">
          <Inbox className="size-7" />
          <span>No items</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="anim-fade-rise grid gap-4">
      <div
        ref={setContainerElement}
        className="hunter-library-masonry"
        data-column-count={columns.length}
        data-column-width={Math.round(columnWidth)}
        data-container-width={containerWidth}
        style={{ columnGap: `${gap}px` }}
      >
        {columns.map((column, columnIndex) => (
          <div
            key={columnIndex}
            className="hunter-library-masonry-column"
            style={{ rowGap: `${gap}px`, width: `min(100%, ${columnWidth}px)` }}
          >
            {column.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                onPatch={(patch) => onPatch(item.id, patch)}
                onSelect={() => onSelect(item.id)}
              />
            ))}
          </div>
        ))}
      </div>
      {page.hasMore ? (
        <Button className="mx-auto min-w-44" disabled={loadingMore} type="button" variant="outline" onClick={onLoadMore}>
          {loadingMore ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          <span>Load more</span>
        </Button>
      ) : null}
    </div>
  );
}
