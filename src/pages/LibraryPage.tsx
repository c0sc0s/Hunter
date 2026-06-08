import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Layers3, PanelLeftClose, PanelLeftOpen, Sparkles } from "lucide-react";
import { ItemDetail } from "@/components/ItemDetail";
import { LibraryGrid } from "@/components/LibraryGrid";
import { LibrarySidebar } from "@/components/LibrarySidebar";
import { LibraryToolbar } from "@/components/LibraryToolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLibrary } from "@/hooks/useLibrary";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH = 264;
const DETAIL_PANEL_STORAGE_KEY = "hunter-detail-panel-width";
const DETAIL_PANEL_DEFAULT_WIDTH = 360;
const DETAIL_PANEL_MIN_WIDTH = 320;
const DETAIL_PANEL_MAX_WIDTH = 560;
const DETAIL_PANEL_MIN_LIBRARY_WIDTH = 360;

export function LibraryPage() {
  const library = useLibrary();
  const isMobileDetail = useMediaQuery("(max-width: 1023px)");
  const mobileSheetOpen = library.detailOpen && isMobileDetail;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return typeof window === "undefined" ? false : window.localStorage.getItem("hunter-sidebar-collapsed") === "true";
  });
  const [detailPanelWidth, setDetailPanelWidth] = useState(() => getInitialDetailPanelWidth(sidebarCollapsed));
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const detailResizerRef = useRef<HTMLDivElement | null>(null);
  const detailPanelWidthRef = useRef(detailPanelWidth);
  const pendingDetailPanelWidthRef = useRef(detailPanelWidth);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const resizeShieldRef = useRef<HTMLDivElement | null>(null);
  const detailPanelMaxWidth = getDetailPanelMaxWidth(sidebarCollapsed);
  const layoutStyle = {
    "--library-sidebar-expanded-width": `${SIDEBAR_WIDTH}px`,
    "--library-sidebar-width": sidebarCollapsed ? "0px" : `${SIDEBAR_WIDTH}px`,
    "--library-detail-width": `${detailPanelWidth}px`
  } as CSSProperties;

  useEffect(() => {
    window.localStorage.setItem("hunter-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const resizeDetailPanelBy = useCallback(
    (delta: number) => {
      setDetailPanelWidth((width) => clampDetailPanelWidth(width + delta, sidebarCollapsed));
    },
    [sidebarCollapsed]
  );

  const applyDetailPanelWidth = useCallback((width: number) => {
    layoutRef.current?.style.setProperty("--library-detail-width", `${width}px`);
    detailResizerRef.current?.setAttribute("aria-valuenow", String(width));
    detailResizerRef.current?.setAttribute("aria-valuetext", `${width}px`);
  }, []);

  useEffect(() => {
    detailPanelWidthRef.current = detailPanelWidth;
    pendingDetailPanelWidthRef.current = detailPanelWidth;
    applyDetailPanelWidth(detailPanelWidth);
    window.localStorage.setItem(DETAIL_PANEL_STORAGE_KEY, String(detailPanelWidth));
  }, [applyDetailPanelWidth, detailPanelWidth]);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();

      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }

      resizeShieldRef.current?.remove();
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setDetailPanelWidth((width) => clampDetailPanelWidth(width, sidebarCollapsed));
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [sidebarCollapsed]);

  const applyDetailPanelWidthDuringDrag = useCallback(
    (width: number) => {
      pendingDetailPanelWidthRef.current = width;

      if (resizeFrameRef.current !== null) {
        return;
      }

      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        applyDetailPanelWidth(pendingDetailPanelWidthRef.current);
      });
    },
    [applyDetailPanelWidth]
  );

  const handleDetailResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      resizeCleanupRef.current?.();

      const startX = event.clientX;
      const startWidth = detailPanelWidthRef.current;
      const maxWidth = getDetailPanelMaxWidth(sidebarCollapsed);
      const layoutElement = layoutRef.current;
      const resizerElement = event.currentTarget;
      const previousBodyCursor = document.body.style.cursor;
      const previousBodyUserSelect = document.body.style.userSelect;
      const previousTransition = layoutElement?.style.transition ?? "";
      const previousWillChange = layoutElement?.style.willChange ?? "";
      let active = true;

      pendingDetailPanelWidthRef.current = startWidth;
      layoutElement?.style.setProperty("transition", "none");
      layoutElement?.style.setProperty("will-change", "grid-template-columns");
      layoutElement?.setAttribute("data-detail-resizing", "true");
      resizerElement.setAttribute("data-resizing", "true");
      resizerElement.setAttribute("aria-valuenow", String(startWidth));
      resizerElement.setAttribute("aria-valuetext", `${startWidth}px`);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      try {
        resizerElement.setPointerCapture(event.pointerId);
      } catch {
        // Some embedded browser shells can reject pointer capture after a pointer is already released.
      }

      const shield = document.createElement("div");
      shield.setAttribute("aria-hidden", "true");
      shield.setAttribute("data-detail-resize-shield", "true");
      Object.assign(shield.style, {
        background: "transparent",
        cursor: "col-resize",
        inset: "0",
        position: "fixed",
        zIndex: "60"
      });
      document.body.appendChild(shield);
      resizeShieldRef.current = shield;

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        if (!active) {
          return;
        }

        const nextWidth = startWidth + startX - moveEvent.clientX;
        applyDetailPanelWidthDuringDrag(clampDetailPanelWidthForMax(nextWidth, maxWidth));
      };

      const stopResize = (commit: boolean) => {
        if (!active) {
          return;
        }

        active = false;

        if (resizeFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }

        const finalWidth = pendingDetailPanelWidthRef.current;
        applyDetailPanelWidth(finalWidth);
        detailPanelWidthRef.current = finalWidth;
        layoutElement?.style.setProperty("transition", previousTransition);
        layoutElement?.style.setProperty("will-change", previousWillChange);
        layoutElement?.removeAttribute("data-detail-resizing");
        resizerElement.removeAttribute("data-resizing");
        document.body.style.cursor = previousBodyCursor;
        document.body.style.userSelect = previousBodyUserSelect;
        resizeShieldRef.current?.remove();
        resizeShieldRef.current = null;

        try {
          if (resizerElement.hasPointerCapture(event.pointerId)) {
            resizerElement.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Ignore shell-specific pointer-capture edge cases.
        }

        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopAndCommit);
        window.removeEventListener("pointercancel", stopAndCommit);
        resizeCleanupRef.current = null;

        if (commit) {
          setDetailPanelWidth(finalWidth);
        }
      };

      const stopAndCommit = () => stopResize(true);

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopAndCommit);
      window.addEventListener("pointercancel", stopAndCommit);
      resizeCleanupRef.current = () => stopResize(false);
    },
    [applyDetailPanelWidth, applyDetailPanelWidthDuringDrag, sidebarCollapsed]
  );

  const handleDetailResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 32 : 12;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        resizeDetailPanelBy(step);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        resizeDetailPanelBy(-step);
      } else if (event.key === "Home") {
        event.preventDefault();
        setDetailPanelWidth(DETAIL_PANEL_MIN_WIDTH);
      } else if (event.key === "End") {
        event.preventDefault();
        setDetailPanelWidth(getDetailPanelMaxWidth(sidebarCollapsed));
      }
    },
    [resizeDetailPanelBy, sidebarCollapsed]
  );

  return (
    <TooltipProvider>
      <main className="dark relative min-h-screen bg-background text-foreground lg:h-screen lg:min-h-0 lg:overflow-hidden">
        {isDesktopShell() ? <DesktopTitlebarDragLayer /> : null}
        <DesktopWindowControlSlot sidebarCollapsed={sidebarCollapsed} onSidebarCollapsedChange={setSidebarCollapsed} />

        <div
          ref={layoutRef}
          data-sidebar-collapsed={sidebarCollapsed}
          style={layoutStyle}
          className="grid min-h-0 lg:h-full lg:grid-cols-[var(--library-sidebar-width)_minmax(0,1fr)_var(--library-detail-width)] lg:grid-rows-none lg:overflow-hidden lg:transition-[grid-template-columns] lg:duration-[var(--motion-slow)] lg:ease-[var(--ease-out-soft)]"
        >
          <LibrarySidebar
            stats={library.stats}
            filter={library.filter}
            onFilterChange={library.setFilter}
            sourceFilter={library.sourceFilter}
            onSourceFilterChange={library.setSourceFilter}
            collapsed={sidebarCollapsed}
          />

          <section
            className={cn(
              "hunter-panel-top min-w-0 border-r border-border/60 bg-muted/30 p-4 sm:p-6 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden",
              !sidebarCollapsed && "lg:border-l"
            )}
          >
            <LibraryToolbar
              filter={library.filter}
              stats={library.stats}
              page={library.page}
              visibleCount={library.items.length}
              query={library.query}
              selectedAgentCategoryId={library.agentCategoryId}
              agentClassifying={library.agentClassifying}
              agentClassifyError={library.agentClassifyError}
              onQueryChange={library.setQuery}
              onAgentCategoryChange={library.setAgentCategoryId}
              onClassifyIncremental={() => void library.classifyIncremental()}
              onReload={library.reload}
            />

            {library.error ? (
              <Alert className="mb-4" variant="destructive">
                <AlertTitle>Could not load library</AlertTitle>
                <AlertDescription>{library.error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
              <LibraryGrid
                items={library.items}
                page={library.page}
                selectedId={library.selected?.id ?? null}
                loading={library.loading}
                loadingMore={library.loadingMore}
                onSelect={library.selectItem}
                onPatch={(id, patch) => void library.patchItem(id, patch)}
                onLoadMore={library.loadMore}
              />
            </div>
          </section>

          <aside
            aria-label="Item detail"
            className="hunter-detail-panel-surface relative hidden min-w-0 overflow-hidden border-l border-border/35 lg:block lg:h-full"
          >
            <div
              ref={detailResizerRef}
              aria-label="Resize item detail panel"
              aria-orientation="vertical"
              aria-valuemax={detailPanelMaxWidth}
              aria-valuemin={DETAIL_PANEL_MIN_WIDTH}
              aria-valuenow={detailPanelWidth}
              aria-valuetext={`${detailPanelWidth}px`}
              className={cn(
                "group absolute inset-y-0 left-0 z-20 hidden w-4 touch-none cursor-col-resize items-center justify-center outline-none data-[resizing=true]:bg-primary/5 lg:flex",
                "focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0"
              )}
              data-detail-resizer
              role="separator"
              tabIndex={0}
              onKeyDown={handleDetailResizeKeyDown}
              onPointerDown={handleDetailResizePointerDown}
            >
              <span
                className={cn(
                  "h-10 w-1 rounded-full bg-border/80 opacity-70 transition-[background-color,opacity,height] duration-[var(--motion-base)]",
                  "group-hover:h-14 group-hover:bg-primary/60 group-hover:opacity-100 group-focus-visible:h-14 group-focus-visible:bg-primary group-focus-visible:opacity-100",
                  "group-data-[resizing=true]:h-14 group-data-[resizing=true]:bg-primary group-data-[resizing=true]:opacity-100"
                )}
              />
            </div>
            <ScrollArea className="h-screen min-w-0 max-w-full overflow-hidden lg:h-full">
              {library.selected ? (
                <ItemDetail
                  key={library.selected.id}
                  item={library.selected}
                  onDelete={() => void library.deleteItem(library.selected!.id)}
                  onPatch={(patch) => void library.patchItem(library.selected!.id, patch)}
                  onClassify={() => library.classifyItem(library.selected!.id)}
                />
              ) : (
                <DetailEmptyState hasItems={library.items.length > 0} />
              )}
            </ScrollArea>
          </aside>
        </div>

        <Sheet
          open={mobileSheetOpen}
          onOpenChange={(open) => {
            if (!isMobileDetail) {
              return;
            }

            if (open) {
              library.setDetailOpen(true);
            } else {
              library.closeDetail();
            }
          }}
        >
          <SheetContent className="dark w-full overflow-y-auto p-0 sm:max-w-xl lg:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>{library.selected?.title ?? "Saved item"}</SheetTitle>
            </SheetHeader>
            {library.selected ? (
              <ItemDetail
                key={library.selected.id}
                item={library.selected}
                onDelete={() => void library.deleteItem(library.selected!.id)}
                onPatch={(patch) => void library.patchItem(library.selected!.id, patch)}
                onClassify={() => library.classifyItem(library.selected!.id)}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      </main>
    </TooltipProvider>
  );
}

// Macros for the macOS overlay title bar zone. Keep these in sync with the
// Electron BrowserWindow `trafficLightPosition` in `electron/main.cjs`.
// Traffic lights sit at y=16 with a 12px diameter (center y=22), so we size
// the slot to 44px and vertically center the collapse button against the same
// axis. Anything taller leaves visible dead space above the sidebar nav and
// also makes the drag region swallow clicks on the first nav row.
const TITLE_BAR_SLOT_HEIGHT = 44;
const COLLAPSE_BUTTON_LEFT = 92;

function DesktopTitlebarDragLayer() {
  return (
    <div
      aria-hidden="true"
      className="hunter-window-drag-region fixed inset-x-0 top-0 z-30 hidden lg:block"
      style={{ height: `${TITLE_BAR_SLOT_HEIGHT}px` }}
    />
  );
}

function DesktopWindowControlSlot({
  sidebarCollapsed,
  onSidebarCollapsedChange
}: {
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
}) {
  return (
    <div
      className="pointer-events-none fixed left-0 top-[1px] z-40 hidden lg:flex lg:items-center lg:transition-[width] lg:duration-[var(--motion-slow)] lg:ease-[var(--ease-out-soft)]"
      style={{ width: sidebarCollapsed ? "188px" : `${SIDEBAR_WIDTH}px`, height: `${TITLE_BAR_SLOT_HEIGHT}px` }}
    >
      <Button
        className="hunter-window-no-drag pointer-events-auto relative text-muted-foreground hover:bg-muted/45 hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground dark:aria-expanded:bg-transparent"
        style={{ marginLeft: `${COLLAPSE_BUTTON_LEFT}px` }}
        variant="ghost"
        size="icon"
        aria-controls="library-sidebar"
        aria-expanded={!sidebarCollapsed}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        type="button"
        onClick={() => onSidebarCollapsedChange(!sidebarCollapsed)}
      >
        {sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
      </Button>
    </div>
  );
}

function getInitialDetailPanelWidth(sidebarCollapsed: boolean): number {
  if (typeof window === "undefined") {
    return DETAIL_PANEL_DEFAULT_WIDTH;
  }

  const storedValue = window.localStorage.getItem(DETAIL_PANEL_STORAGE_KEY);
  const storedWidth = storedValue === null ? Number.NaN : Number(storedValue);
  return clampDetailPanelWidth(Number.isFinite(storedWidth) ? storedWidth : DETAIL_PANEL_DEFAULT_WIDTH, sidebarCollapsed);
}

function getDetailPanelMaxWidth(sidebarCollapsed: boolean): number {
  if (typeof window === "undefined") {
    return DETAIL_PANEL_MAX_WIDTH;
  }

  const sidebarWidth = sidebarCollapsed ? 0 : SIDEBAR_WIDTH;
  const viewportLimitedWidth = window.innerWidth - sidebarWidth - DETAIL_PANEL_MIN_LIBRARY_WIDTH;
  return Math.max(DETAIL_PANEL_MIN_WIDTH, Math.min(DETAIL_PANEL_MAX_WIDTH, viewportLimitedWidth));
}

function clampDetailPanelWidth(width: number, sidebarCollapsed: boolean): number {
  return clampDetailPanelWidthForMax(width, getDetailPanelMaxWidth(sidebarCollapsed));
}

function clampDetailPanelWidthForMax(width: number, maxWidth: number): number {
  return Math.min(Math.max(Math.round(width), DETAIL_PANEL_MIN_WIDTH), maxWidth);
}

function isDesktopShell(): boolean {
  return typeof window !== "undefined" && Boolean(window.hunterDesktop);
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    return typeof window === "undefined" ? false : window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

function DetailEmptyState({ hasItems }: { hasItems: boolean }) {
  return (
    <div className="grid min-h-screen content-center gap-6 p-6 text-center">
      <div className="mx-auto grid size-20 place-items-center rounded-xl border border-border/70 bg-muted/40 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)]">
        {hasItems ? <Layers3 className="size-7 text-muted-foreground" /> : <Sparkles className="size-7 text-primary" />}
      </div>
      <div className="mx-auto max-w-64">
        <p className="font-heading text-xl font-semibold tracking-tight">{hasItems ? "Nothing selected" : "No items in this view"}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {hasItems
            ? "Choose a saved item to review its source, overview, and actions."
            : "Saved reading items will appear here when this view has matches."}
        </p>
      </div>
      <div className="mx-auto h-px w-28 bg-gradient-to-r from-transparent via-border to-transparent" />
    </div>
  );
}
