import { useEffect, useState } from "react";
import type { PublicLibraryItem } from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import { getItemCoverImage } from "@/lib/cover";
import { sourceLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function Cover({
  item,
  className,
  onUnavailable
}: {
  item: PublicLibraryItem;
  className?: string;
  onUnavailable?: (coverImage: string) => void;
}) {
  // Some CDNs (notably B站 / i*.hdslb.com) hotlink-block requests carrying a
  // cross-origin Referer with 403. Using a real <img> with `referrerPolicy=
  // "no-referrer"` makes the browser send no Referer, so the CDN returns 200.
  // CSS background-image cannot opt out of Referer, which is why this needs to
  // be an <img>. Keep loading eager: macOS WKWebView can leave lazy images
  // pending inside the library's overflow-scrolled CSS columns. If the URL is
  // missing or fails, the component renders nothing so no-cover items use the
  // compact text-first layouts in cards/details.
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
        className="absolute inset-0 size-full object-cover"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(255_255_255_/_8%),transparent_35%,rgb(0_0_0_/_10%))] shadow-[inset_0_1px_0_rgb(255_255_255_/_10%)]"
      />
      <Badge
        className="absolute bottom-3 left-3 border-white/10 bg-background/75 text-foreground shadow-[0_1px_8px_rgb(0_0_0_/_22%)] backdrop-blur-md"
        variant="outline"
      >
        {sourceLabel(item.sourceType)}
      </Badge>
    </div>
  );
}
