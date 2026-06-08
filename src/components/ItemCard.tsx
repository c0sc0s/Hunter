import { ExternalLink, Star } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicLibraryItem } from "../../shared/types";
import { Cover, CoverSourceBadge } from "./Cover";
import { IconTooltip } from "./IconTooltip";
import { SiteIcon } from "./SiteIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { getItemCoverImage } from "@/lib/cover";
import { formatDate } from "@/lib/format";
import { readState } from "@/lib/items";
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
  const visibleCoverImage = hasCover ? coverImage : undefined;
  const itemReadState = readState(item);
  const isRead = itemReadState === "read";

  useEffect(() => {
    setUnavailableCoverImage(null);
  }, [coverImage]);

  return (
    <Card
      aria-current={selected ? "true" : undefined}
      data-has-cover={hasCover ? "true" : "false"}
      data-library-item-card
      data-read-state={itemReadState}
      data-selected={selected ? "true" : "false"}
      className={cn(
        "hunter-library-item-card group/itemcard relative isolate cursor-pointer gap-0 pt-0 pb-0",
        !hasCover && "hunter-library-item-card-no-cover"
      )}
      onClick={onSelect}
    >
      {visibleCoverImage ? (
        <>
          <Cover item={item} className="hunter-item-card-cover" showSourceBadge={false} onUnavailable={setUnavailableCoverImage} />
          <img
            src={visibleCoverImage}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            loading="eager"
            decoding="async"
            className="hunter-item-card-cover-bleed"
          />
          <span className="hunter-item-card-cover-fade" aria-hidden="true" />
          <CoverSourceBadge item={item} className="hunter-item-card-cover-type-badge absolute left-3" />
        </>
      ) : (
        <div className="hunter-item-card-accent mx-4 mt-3" />
      )}
      <CardHeader className={cn("gap-2 px-4", hasCover ? "hunter-item-card-header-with-cover" : "pt-3.5")}>
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          <SiteIcon item={item} />
          <span className="hunter-item-card-source-name min-w-0 truncate">{item.sourceName}</span>
          {!hasCover ? (
            <Badge className="hunter-item-source-badge shrink-0 text-[10px]" variant="outline">
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
            isRead && "text-foreground/65"
          )}
        >
          {item.title}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn("grid content-start px-4", hasCover ? "hunter-item-card-content-with-cover gap-3" : "gap-2.5 pt-0.5")}>
        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{item.summary}</p>
        {item.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {item.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} className="hunter-item-tag" variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="hunter-item-card-footer mt-3 justify-between gap-1 px-3.5 py-2.5">
        <IconTooltip label="Open link">
          <Button asChild className="hunter-item-card-open-action" size="sm" variant="ghost" onClick={(event) => event.stopPropagation()}>
            <a href={item.url} target="_blank" rel="noreferrer">
              <ExternalLink />
              <span>Open</span>
            </a>
          </Button>
        </IconTooltip>
        <div className="flex items-center gap-0.5">
          <IconTooltip label={item.favorite ? "Unfavorite" : "Favorite"}>
            <Button
              aria-label={item.favorite ? "Unstar" : "Star"}
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
        </div>
      </CardFooter>
    </Card>
  );
}
