import { CheckCircle2, ExternalLink, Star } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicLibraryItem } from "../../shared/types";
import { Cover } from "./Cover";
import { IconTooltip } from "./IconTooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { getItemCoverImage } from "@/lib/cover";
import { formatDate } from "@/lib/format";
import { readState, readStateLabel } from "@/lib/items";
import { sourceLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function ItemCard({
  item,
  selected,
  onSelect,
  onPatch
}: {
  item: PublicLibraryItem;
  selected: boolean;
  onSelect: () => void;
  onPatch: (patch: Partial<Pick<PublicLibraryItem, "status" | "favorite">>) => void;
}) {
  const coverImage = getItemCoverImage(item);
  const [unavailableCoverImage, setUnavailableCoverImage] = useState<string | null>(null);
  const hasCover = Boolean(coverImage) && coverImage !== unavailableCoverImage;

  useEffect(() => {
    setUnavailableCoverImage(null);
  }, [coverImage]);

  return (
    <Card
      aria-current={selected ? "true" : undefined}
      data-has-cover={hasCover ? "true" : "false"}
      data-library-item-card
      className={cn(
        "hunter-card-top-glow group/itemcard relative isolate cursor-pointer gap-0 border-border/55 bg-card/95 pt-0 pb-0 shadow-[0_1px_0_rgb(255_255_255_/_4%),0_10px_28px_rgb(0_0_0_/_14%)] transition-[transform,box-shadow,border-color,background-color] duration-[var(--motion-base)] ease-[var(--ease-out-soft)] will-change-transform after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_1px_0_rgb(255_255_255_/_6%)] hover:-translate-y-px hover:border-foreground/20 hover:bg-card hover:shadow-[0_1px_0_rgb(255_255_255_/_6%),0_16px_44px_rgb(0_0_0_/_24%)]",
        !hasCover && "border-border/65",
        selected &&
          "border-foreground/35 bg-card shadow-[0_0_0_1px_rgb(255_255_255_/_12%),0_18px_54px_rgb(0_0_0_/_34%)] before:absolute before:inset-x-3 before:top-0 before:z-10 before:h-px before:bg-[linear-gradient(90deg,transparent,rgb(255_255_255_/_64%),transparent)] after:ring-1 after:ring-inset after:ring-primary/45 after:shadow-[inset_0_1px_0_rgb(255_255_255_/_12%),inset_0_0_0_1px_rgb(255_255_255_/_6%)]"
      )}
      onClick={onSelect}
    >
      {hasCover ? (
        <Cover item={item} className="h-36 rounded-t-lg border-b border-border/45" onUnavailable={setUnavailableCoverImage} />
      ) : (
        <div className="mx-4 mt-3 h-px bg-gradient-to-r from-primary/40 via-border to-transparent" />
      )}
      <CardHeader className="gap-2 px-4 pt-3.5">
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          <span
            aria-label={readStateLabel(readState(item))}
            title={readStateLabel(readState(item))}
            className={cn(
              "size-1.5 shrink-0 rounded-full transition-colors duration-[var(--motion-base)] ease-[var(--ease-out-soft)]",
              readState(item) === "unread" ? "bg-primary" : "bg-muted-foreground/25"
            )}
          />
          <span className="min-w-0 truncate">{item.sourceName}</span>
          {!hasCover ? (
            <Badge className="shrink-0 border-border/70 bg-muted/45 text-[10px] text-muted-foreground" variant="outline">
              {sourceLabel(item.sourceType)}
            </Badge>
          ) : null}
          <span className="ml-auto shrink-0" data-visual-dynamic>
            {formatDate(item.savedAt)}
          </span>
        </div>
        <CardTitle
          className={cn(
            "font-semibold leading-snug tracking-tight transition-colors duration-[var(--motion-base)] ease-[var(--ease-out-soft)]",
            hasCover ? "line-clamp-2 text-base" : "line-clamp-2 text-lg",
            readState(item) === "read" && "text-foreground/65"
          )}
        >
          {item.title}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn("grid content-start px-4", hasCover ? "gap-3" : "gap-2.5 pt-0.5")}>
        <p className={cn("text-sm leading-6 text-muted-foreground", hasCover ? "line-clamp-3" : "line-clamp-2")}>{item.summary}</p>
        {item.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {item.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="mt-3 justify-between gap-1 border-t border-border/35 bg-muted/10 px-3.5 py-2.5">
        <IconTooltip label="Open link">
          <Button asChild size="icon-sm" variant="ghost" onClick={(event) => event.stopPropagation()}>
            <a href={item.url} target="_blank" rel="noreferrer">
              <ExternalLink />
            </a>
          </Button>
        </IconTooltip>
        <div className="flex items-center gap-0.5">
          <IconTooltip label={item.favorite ? "Unfavorite" : "Favorite"}>
            <Button
              className={item.favorite ? "text-chart-2" : undefined}
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                onPatch({ favorite: !item.favorite });
              }}
            >
              <Star key={item.favorite ? "fav-on" : "fav-off"} className={cn(item.favorite && "fill-chart-2 anim-star-pop")} />
            </Button>
          </IconTooltip>
          <IconTooltip label={readState(item) === "read" ? "Mark unread" : "Mark read"}>
            <Button
              className={readState(item) === "read" ? "text-chart-3" : undefined}
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                onPatch({ status: readState(item) === "read" ? "unread" : "read" });
              }}
            >
              <CheckCircle2 />
            </Button>
          </IconTooltip>
        </div>
      </CardFooter>
    </Card>
  );
}
