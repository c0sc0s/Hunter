import {
  AlignLeft,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  Circle,
  Ellipsis,
  Loader2,
  Star,
  Trash2,
  type LucideIcon
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { PublicLibraryItem } from "../../shared/types";
import { Cover, CoverSourceBadge } from "./Cover";
import { IconTooltip } from "./IconTooltip";
import { SiteIcon } from "./SiteIcon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { getItemCoverImage } from "@/lib/cover";
import { formatDate, formatRelativeToToday } from "@/lib/format";
import { readState } from "@/lib/items";
import { sourceLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function ItemDetail({
  item,
  onPatch,
  onClassify,
  onDelete
}: {
  item: PublicLibraryItem;
  onPatch: (patch: Partial<Pick<PublicLibraryItem, "status" | "favorite" | "tags" | "note">>) => void;
  onClassify: () => Promise<void>;
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
    <div className="hunter-detail-content anim-fade-rise grid gap-5 p-4 sm:p-6">
      {hasCover ? (
        <DetailCover item={item} onDelete={onDelete} onPatch={onPatch} onUnavailableCoverImage={setUnavailableCoverImage} />
      ) : null}

      {hasCover ? (
        <div className="hunter-detail-heading-block hunter-detail-heading-block-with-cover min-w-0 max-w-full">
          <div className="hunter-detail-priority-meta hunter-detail-priority-meta-date-only min-w-0">
            <SavedDateChip savedAt={item.savedAt} />
          </div>
          <DetailTitle item={item} hasCover={hasCover} />
        </div>
      ) : (
        <div className="hunter-detail-no-cover-group min-w-0">
          <NoCoverDetailHeader item={item} onDelete={onDelete} onPatch={onPatch} />
          <SavedDateRow savedAt={item.savedAt} />
        </div>
      )}

      <Button asChild className="hunter-detail-open-link w-full min-w-0 max-w-full overflow-hidden" size="lg" variant="default">
        <a href={item.url} target="_blank" rel="noreferrer">
          <span className="min-w-0 truncate">Open link</span>
        </a>
      </Button>

      <DetailSection icon={AlignLeft} title="Description">
        <p className="hunter-detail-wrap leading-7 text-muted-foreground">{overview}</p>
      </DetailSection>

      <AgentClassificationPanel item={item} onClassify={onClassify} />

      {item.enrichmentState !== "ready" && (item.sourceMessage || item.enrichmentError) ? (
        <Alert variant={item.enrichmentState === "failed" ? "destructive" : "default"}>
          <AlertTitle>Capture note</AlertTitle>
          <AlertDescription className="hunter-detail-wrap">{item.sourceMessage || item.enrichmentError}</AlertDescription>
        </Alert>
      ) : null}

      <Separator />
    </div>
  );
}

function AgentClassificationPanel({ item, onClassify }: { item: PublicLibraryItem; onClassify: () => Promise<void> }) {
  const result = item.agentClassification;
  const [classifying, setClassifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClassify() {
    setClassifying(true);
    setError(null);
    try {
      await onClassify();
    } catch (classifyError) {
      setError(classifyError instanceof Error ? classifyError.message : "Could not classify item");
    } finally {
      setClassifying(false);
    }
  }

  return (
    <DetailSection icon={BrainCircuit} title="Agent">
      <div className="hunter-agent-panel grid gap-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{result ? "Classification" : "Not classified"}</p>
            {result ? (
              <p className="hunter-detail-wrap text-xs text-muted-foreground">
                {result.model} / {formatDate(result.generatedAt)}
              </p>
            ) : null}
          </div>
          <Button className="shrink-0" disabled={classifying} size="sm" type="button" variant="secondary" onClick={handleClassify}>
            {classifying ? <Loader2 className="animate-spin" /> : <BrainCircuit />}
            <span>{result ? "Reclassify" : "Classify"}</span>
          </Button>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Classification failed</AlertTitle>
            <AlertDescription className="hunter-detail-wrap">{error}</AlertDescription>
          </Alert>
        ) : null}

        {result ? <AgentClassificationResultView result={result} /> : null}
      </div>
    </DetailSection>
  );
}

function AgentClassificationResultView({ result }: { result: NonNullable<PublicLibraryItem["agentClassification"]> }) {
  const classification = result.classification;
  const contentCategoryLabel = classification.contentCategory?.label ?? classification.primaryCategory;
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex min-w-0 flex-wrap gap-2">
        <Badge className="hunter-agent-badge" variant="secondary">
          {contentCategoryLabel}
        </Badge>
        <Badge className="hunter-agent-badge" variant="secondary">
          {classification.primaryCategory}
        </Badge>
        <Badge className="hunter-agent-badge" variant="outline">
          {classification.intent}
        </Badge>
        <Badge className="hunter-agent-badge" variant="outline">
          {Math.round(classification.confidence * 100)}%
        </Badge>
        {classification.needsFollowUp ? (
          <Badge className="hunter-agent-badge" variant="outline">
            follow-up
          </Badge>
        ) : null}
      </div>

      {classification.topics.length ? (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {classification.topics.map((topic) => (
            <Badge key={topic} className="hunter-agent-topic" variant="outline">
              {topic}
            </Badge>
          ))}
        </div>
      ) : null}

      <p className="hunter-detail-wrap text-sm leading-6 text-muted-foreground">{classification.summary}</p>

      {classification.keyPoints.length ? (
        <ul className="grid gap-1.5 pl-4 text-sm leading-6 text-muted-foreground">
          {classification.keyPoints.map((point) => (
            <li className="hunter-detail-wrap list-disc" key={point}>
              {point}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function NoCoverDetailHeader({
  item,
  onDelete,
  onPatch
}: {
  item: PublicLibraryItem;
  onDelete: () => void;
  onPatch: (patch: Partial<Pick<PublicLibraryItem, "status" | "favorite" | "tags" | "note">>) => void;
}) {
  return (
    <div className="hunter-detail-no-cover-header hunter-card-top-glow relative min-w-0 max-w-full overflow-hidden rounded-lg border border-border/70 bg-muted/30 p-4 shadow-[inset_0_1px_0_rgb(255_255_255_/_7%)] before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-primary/45 before:via-border before:to-transparent">
      <div className="hunter-detail-no-cover-top">
        <div className="hunter-detail-priority-meta min-w-0">
          <Badge className="border-border/70 bg-muted/45 text-muted-foreground" variant="outline">
            {sourceLabel(item.sourceType)}
          </Badge>
          <SourceIdentity item={item} />
        </div>
        <div className="hunter-detail-header-actions">
          <DetailActions item={item} onPatch={onPatch} placement="header" />
          <DetailMoreMenu item={item} onDelete={onDelete} onPatch={onPatch} placement="header" />
        </div>
      </div>
      <DetailTitle item={item} hasCover={false} />
    </div>
  );
}

function DetailTitle({ item, hasCover }: { item: PublicLibraryItem; hasCover: boolean }) {
  return (
    <h2 className={cn("hunter-detail-wrap font-semibold leading-tight tracking-tight", hasCover ? "text-2xl" : "text-[1.65rem]")}>
      {item.title}
    </h2>
  );
}

function DetailCover({
  item,
  onDelete,
  onPatch,
  onUnavailableCoverImage
}: {
  item: PublicLibraryItem;
  onDelete: () => void;
  onPatch: (patch: Partial<Pick<PublicLibraryItem, "status" | "favorite" | "tags" | "note">>) => void;
  onUnavailableCoverImage: (url: string) => void;
}) {
  return (
    <div className="hunter-detail-cover-shell">
      <div className="hunter-detail-cover-shape">
        <Cover item={item} className="hunter-detail-cover-frame" showSourceBadge={false} onUnavailable={onUnavailableCoverImage} />
      </div>
      <CoverSourceBadge item={item} className="hunter-detail-cover-source-badge absolute left-3 top-3" />
      <DetailMoreMenu item={item} onDelete={onDelete} onPatch={onPatch} placement="cover" />
      <div className="hunter-detail-cover-caption">
        <SourceIdentity item={item} />
        <DetailActions item={item} onPatch={onPatch} placement="cover" />
      </div>
    </div>
  );
}

function DetailActions({
  item,
  onPatch,
  placement
}: {
  item: PublicLibraryItem;
  onPatch: (patch: Partial<Pick<PublicLibraryItem, "status" | "favorite" | "tags" | "note">>) => void;
  placement: "cover" | "header";
}) {
  const isRead = readState(item) === "read";
  const readActionLabel = isRead ? "Mark unread" : "Mark read";
  const readVisibleLabel = isRead ? "Read" : "Unread";
  const ReadIcon = isRead ? CheckCircle2 : Circle;

  return (
    <div
      className={cn(
        "hunter-detail-actions flex min-w-0 items-center",
        placement === "cover" && "hunter-detail-cover-actions",
        placement === "header" && "hunter-detail-header-read-action"
      )}
    >
      <IconTooltip label={readActionLabel}>
        <Button
          aria-label={readActionLabel}
          aria-pressed={isRead}
          className={cn("hunter-detail-read-action", isRead ? "hunter-detail-read-action-read" : "hunter-detail-read-action-unread")}
          data-read-state={isRead ? "read" : "unread"}
          size="lg"
          type="button"
          variant="ghost"
          onClick={() => onPatch({ status: isRead ? "unread" : "read" })}
        >
          <ReadIcon className={cn(isRead && "anim-star-pop")} />
          <span>{readVisibleLabel}</span>
        </Button>
      </IconTooltip>
    </div>
  );
}

function DetailMoreMenu({
  item,
  onDelete,
  onPatch,
  placement
}: {
  item: PublicLibraryItem;
  onDelete: () => void;
  onPatch: (patch: Partial<Pick<PublicLibraryItem, "status" | "favorite" | "tags" | "note">>) => void;
  placement: "cover" | "header";
}) {
  return (
    <DropdownMenu>
      <IconTooltip label="More actions">
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="More actions"
            className={cn(
              "hunter-detail-more-trigger",
              placement === "cover" && "hunter-detail-cover-more",
              placement === "header" && "hunter-detail-header-more"
            )}
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
      </IconTooltip>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => onPatch({ favorite: !item.favorite })}>
          <Star className={cn(item.favorite && "fill-chart-2 text-chart-2")} />
          <span>{item.favorite ? "Unfavorite" : "Favorite"}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onSelect={onDelete}>
          <Trash2 />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SourceIdentity({ item }: { item: PublicLibraryItem }) {
  return (
    <span className="hunter-detail-source-chip">
      <SiteIcon item={item} className="hunter-detail-site-icon size-5 bg-muted/45" />
      <span className="min-w-0 truncate">{item.sourceName}</span>
    </span>
  );
}

function SavedDateChip({ savedAt }: { savedAt: string }) {
  const savedDate = formatDate(savedAt);
  const savedAge = formatRelativeToToday(savedAt);

  return (
    <span className="hunter-detail-saved-chip" title={`Saved ${savedDate}`} data-visual-dynamic>
      <CalendarDays className="size-3.5" />
      <span className="hunter-detail-saved-copy">Saved {savedAge}</span>
      <span className="hunter-detail-meta-separator" aria-hidden="true">
        /
      </span>
      <time className="hunter-detail-saved-date" dateTime={savedAt}>
        {savedDate}
      </time>
    </span>
  );
}

function SavedDateRow({ savedAt }: { savedAt: string }) {
  return (
    <div className="hunter-detail-saved-row min-w-0">
      <SavedDateChip savedAt={savedAt} />
    </div>
  );
}

function DetailSection({ children, icon: Icon, title }: { children: ReactNode; icon: LucideIcon; title: string }) {
  return (
    <section className="grid min-w-0 max-w-full gap-3 border-t pt-4">
      <h3 className="flex min-w-0 items-center gap-2 font-medium">
        <Icon className="size-4" />
        {title}
      </h3>
      {children}
    </section>
  );
}
