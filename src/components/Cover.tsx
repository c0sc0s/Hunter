import { FileText, Link2, MessageCircle, Newspaper, Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicLibraryItem, SourceType } from "../../shared/types";
import { getItemCoverImage } from "@/lib/cover";
import { sourceLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

const sourceIcons: Record<SourceType, typeof Newspaper> = {
  article: Newspaper,
  post: MessageCircle,
  tweet: MessageCircle,
  feishu: FileText,
  video: Play,
  pdf: FileText,
  other: Link2
};

export function Cover({
  item,
  className,
  onUnavailable,
  showSourceBadge = true
}: {
  item: PublicLibraryItem;
  className?: string;
  onUnavailable?: (coverImage: string) => void;
  showSourceBadge?: boolean;
}) {
  // Some CDNs (notably B站 / i*.hdslb.com) hotlink-block requests carrying a
  // cross-origin Referer with 403. Using a real <img> with `referrerPolicy=
  // "no-referrer"` makes the browser send no Referer, so the CDN returns 200.
  // CSS background-image cannot opt out of Referer, which is why this needs to
  // be an <img>. Keep loading eager: macOS WKWebView can leave lazy images
  // pending inside the library's overflow-scrolled list. If the URL is missing
  // or fails, the component renders nothing so no-cover items use the compact
  // text-first layouts in cards/details.
  //
  // We also run the cover URL through `upgradeCdnCoverResolution` so legacy
  // library items captured before the server-side rewrite landed (e.g. B站
  // covers stored as the 5.8KB `@189w_107h.webp` thumbnail) still render
  // crisply without a database migration.
  const [imageBroken, setImageBroken] = useState(false);
  const coverImage = getItemCoverImage(item);
  const showImage = Boolean(coverImage) && !imageBroken;

  useEffect(() => {
    setImageBroken(false);
  }, [coverImage]);

  if (!showImage) {
    return null;
  }

  return (
    <div
      className={cn(
        "relative grid place-items-center overflow-hidden bg-[linear-gradient(135deg,color-mix(in_oklch,var(--chart-2),transparent_82%),color-mix(in_oklch,var(--muted),transparent_18%))] text-chart-2",
        className
      )}
    >
      <img
        src={coverImage}
        alt=""
        data-cover-image
        referrerPolicy="no-referrer"
        loading="eager"
        decoding="async"
        onError={() => {
          setImageBroken(true);
          if (coverImage) onUnavailable?.(coverImage);
        }}
        className="hunter-cover-image absolute inset-0 size-full object-cover"
      />
      <div
        aria-hidden="true"
        className="hunter-cover-gloss pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(255_255_255_/_8%),transparent_35%,rgb(0_0_0_/_10%))] shadow-[inset_0_1px_0_rgb(255_255_255_/_10%)]"
      />
      {showSourceBadge ? <CoverSourceBadge item={item} className="absolute bottom-3 left-3" /> : null}
    </div>
  );
}

export function CoverSourceBadge({ item, className }: { item: PublicLibraryItem; className?: string }) {
  const SourceIcon = sourceIcons[item.sourceType];

  return (
    <span
      className={cn(
        "hunter-cover-type-badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-full border border-white/12 bg-[linear-gradient(180deg,rgb(42_44_49_/_90%),rgb(23_24_28_/_88%))] px-2 py-0.5 text-[0.625rem] font-medium whitespace-nowrap text-white/95 shadow-[0_1px_0_rgb(255_255_255_/_7%)_inset,0_10px_24px_rgb(0_0_0_/_30%)] ring-1 ring-black/20 backdrop-blur-md",
        className
      )}
    >
      <SourceIcon className="size-2.5 text-white/80" aria-hidden="true" />
      {sourceLabel(item.sourceType)}
    </span>
  );
}
