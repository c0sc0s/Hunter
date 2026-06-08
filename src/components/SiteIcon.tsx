import { Globe2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicLibraryItem } from "../../shared/types";
import { cn } from "@/lib/utils";

export function SiteIcon({ item, className }: { item: PublicLibraryItem; className?: string }) {
  const [imageBroken, setImageBroken] = useState(false);
  const showImage = Boolean(item.favicon) && !imageBroken;

  useEffect(() => {
    setImageBroken(false);
  }, [item.favicon]);

  return (
    <span
      className={cn(
        "grid size-5 shrink-0 place-items-center overflow-hidden rounded-sm bg-muted/35 text-[10px] font-semibold text-muted-foreground shadow-[inset_0_1px_0_rgb(255_255_255_/_3%)]",
        className
      )}
      title={item.sourceName}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={item.favicon}
          alt=""
          referrerPolicy="no-referrer"
          loading="eager"
          decoding="async"
          onError={() => setImageBroken(true)}
          className="size-3.5 object-contain"
        />
      ) : (
        <Globe2 className="size-3" />
      )}
    </span>
  );
}
