import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useResponsiveMasonry } from "@/hooks/useResponsiveMasonry";

export function LoadingGrid() {
  const skeletonItems = [0, 1, 2, 3];
  const { columnWidth, columns, gap, setContainerElement } = useResponsiveMasonry(skeletonItems, (item) => (item % 2 === 0 ? 8 : 4));

  return (
    <div
      ref={setContainerElement}
      className="hunter-library-masonry"
      data-column-count={columns.length}
      data-loading-grid
      style={{ columnGap: `${gap}px` }}
    >
      {columns.map((column, columnIndex) => (
        <div
          key={columnIndex}
          className="hunter-library-masonry-column"
          style={{ rowGap: `${gap}px`, width: `min(100%, ${columnWidth}px)` }}
        >
          {column.map((item) => (
            <Card key={item} className="gap-4 pt-0">
              {item % 2 === 0 ? <Skeleton className="h-36 rounded-none rounded-t-lg" /> : <div className="mx-4 mt-3 h-px bg-muted" />}
              <CardHeader>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-4/5" />
              </CardHeader>
              <CardContent className="grid gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className={item % 2 === 0 ? "h-4 w-2/3" : "h-4 w-1/2"} />
              </CardContent>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}
