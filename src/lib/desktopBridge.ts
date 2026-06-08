import type { HunterDesktopBridge } from "../../shared/desktopBridge";

export type { ApiReadyPayload, HunterDesktopBridge } from "../../shared/desktopBridge";

declare global {
  interface Window {
    hunterDesktop?: HunterDesktopBridge;
  }
}

export function getDesktopBridge(): HunterDesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.hunterDesktop;
}
