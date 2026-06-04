import { ExternalLink, Loader2, Sparkles, Star, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { PublicLibraryItem } from "../../shared/types";
import { Cover } from "./Cover";
import { IconTooltip } from "./IconTooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getItemCoverImage } from "@/lib/cover";
import { formatDate } from "@/lib/format";
import { sourceLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function ItemDetail({
  item,
  onPatch,
  onDelete
}: {
  item: PublicLibraryItem;
  onPatch: (patch: Partial<Pick<PublicLibraryItem, "status" | "favorite" | "tags" | "note">>) => void;
  onDelete: () => void;
}) {
  const overview = item.summary || item.excerpt || item.readableText || "No overview captured yet.";
  const coverImage = getItemCoverImage(item);
  const [unavailableCoverImage, setUnavailableCoverImage] = useState<string | null>(null);
  const hasCover = Boolean(coverImage) && coverImage !== unavailableCoverImage;

  useEffect(() => {
    setUnavailableCoverImage(null);
  }, [coverImage]);

  return (
    <div className="anim-fade-rise grid gap-5 p-4 sm:p-6">
      {hasCover ? <Cover item={item} className="h-48 rounded-lg" onUnavailable={setUnavailableCoverImage} /> : null}

      <div
        className={cn(
          "min-w-0",
          !hasCover &&
            "hunter-card-top-glow relative overflow-hidden rounded-lg border border-border/65 bg-card/95 p-4 pt-5 shadow-[inset_0_1px_0_rgb(255_255_255_/_5%)] before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-primary/45 before:via-border before:to-transparent"
        )}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {!hasCover ? (
            <Badge className="border-border/70 bg-muted/45 text-muted-foreground" variant="outline">
              {sourceLabel(item.sourceType)}
            </Badge>
          ) : null}
          <span className="text-xs font-medium text-muted-foreground">{item.sourceName}</span>
          <SourceStateBadge item={item} />
        </div>
        <h2 className={cn("font-semibold leading-tight tracking-tight", hasCover ? "text-2xl" : "text-[1.65rem]")}>{item.title}</h2>
      </div>

      <Button asChild className="w-full" size="lg" variant="default">
        <a href={item.url} target="_blank" rel="noreferrer">
          <ExternalLink className="size-4" />
          <span>Open link</span>
        </a>
      </Button>

      <DetailSection icon={Sparkles} title="Overview">
        <p className="leading-7 text-muted-foreground">{overview}</p>
        <dl className="grid gap-3 text-sm">
          <Meta label="Saved" value={formatDate(item.savedAt)} visualDynamic />
        </dl>
      </DetailSection>

      {item.enrichmentState !== "ready" && (item.sourceMessage || item.enrichmentError) ? (
        <Alert variant={item.enrichmentState === "failed" ? "destructive" : "default"}>
          <AlertTitle>Capture note</AlertTitle>
          <AlertDescription>{item.sourceMessage || item.enrichmentError}</AlertDescription>
        </Alert>
      ) : null}

      <Separator />

      <div className="flex flex-wrap items-center gap-1">
        <IconTooltip label="Delete">
          <Button
            aria-label="Delete"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </IconTooltip>
        <Button
          className={cn("ml-auto", item.favorite && "text-chart-2")}
          type="button"
          variant="outline"
          onClick={() => onPatch({ favorite: !item.favorite })}
        >
          <Star key={item.favorite ? "fav-on" : "fav-off"} className={cn(item.favorite && "fill-chart-2 anim-star-pop")} />
          <span>{item.favorite ? "Saved" : "Star"}</span>
        </Button>
      </div>
    </div>
  );
}

function SourceStateBadge({ item }: { item: PublicLibraryItem }) {
  if (item.enrichmentState === "processing") {
    return (
      <Badge variant="outline">
        <Loader2 className="size-3 animate-spin" />
        processing
      </Badge>
    );
  }

  if (item.enrichmentState === "ready") {
    return <Badge variant="secondary">ready</Badge>;
  }

  return <Badge variant={item.enrichmentState === "failed" ? "destructive" : "outline"}>{item.enrichmentState}</Badge>;
}

function DetailSection({ children, icon: Icon, title }: { children: ReactNode; icon: typeof Sparkles; title: string }) {
  return (
    <section className="grid gap-3 border-t pt-4">
      <h3 className="flex items-center gap-2 font-medium">
        <Icon className="size-4" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Meta({ label, value, visualDynamic = false }: { label: string; value: string; visualDynamic?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-mono text-xs font-medium" data-visual-dynamic={visualDynamic ? true : undefined} title={value}>
        {value}
      </dd>
    </div>
  );
}
