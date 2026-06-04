import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Inbox, Loader2, RefreshCw } from "lucide-react";
import type { LibraryPage, PublicLibraryItem, UpdateItemInput } from "../../shared/types";
import { ItemCard } from "./ItemCard";
import { LoadingGrid } from "./LoadingGrid";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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
  const [gridRef] = useAutoAnimate<HTMLDivElement>({ duration: 220, easing: "ease-out" });

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
      <div ref={gridRef} className="columns-1 gap-3 sm:columns-2 2xl:columns-3">
        {items.map((item) => (
          <div key={item.id} className="mb-3 break-inside-avoid">
            <ItemCard
              item={item}
              selected={selectedId === item.id}
              onPatch={(patch) => onPatch(item.id, patch)}
              onSelect={() => onSelect(item.id)}
            />
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
