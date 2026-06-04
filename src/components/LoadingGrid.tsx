import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function LoadingGrid() {
  return (
    <div className="columns-1 gap-3 sm:columns-2 2xl:columns-3" data-loading-grid>
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="mb-3 break-inside-avoid">
          <Card className="gap-4 pt-0">
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
        </div>
      ))}
    </div>
  );
}
