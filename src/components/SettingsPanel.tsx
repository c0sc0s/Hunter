import { Settings2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAutostart } from "@/hooks/useAutostart";

/**
 * Settings entry point. Currently exposes the autostart toggle when running
 * inside the desktop shell; in browser-only mode the autostart row is hidden
 * because the OS launch-agent API is not available.
 *
 * Kept intentionally small. New settings groups should land in `<section>`s
 * inside the same sheet rather than spawning new top-level surfaces.
 */
export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const autostart = useAutostart();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open settings">
          <Settings2 className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="dark w-[360px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Tune how Hunter runs on this machine.</SheetDescription>
        </SheetHeader>

        {autostart.available ? <AutostartRow autostart={autostart} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function AutostartRow({ autostart }: { autostart: ReturnType<typeof useAutostart> }) {
  const checked = autostart.enabled === true;
  return (
    <div className="mt-6 flex items-start justify-between gap-4 rounded-lg border border-border/70 bg-card p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">Launch at login</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Start Hunter automatically when you sign in so the browser extension can sync without you opening the app first.
        </p>
        {autostart.error ? <p className="mt-2 text-xs text-destructive">{autostart.error}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={autostart.loading}
        onClick={() => void autostart.setEnabled(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-50 ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`pointer-events-none inline-block size-5 translate-y-0.5 rounded-full bg-background shadow-sm transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
