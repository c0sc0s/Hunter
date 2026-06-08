export type ApiReadyPayload = {
  base: string;
};

export type HunterDesktopBridge = {
  getApiBase: () => Promise<string | null>;
  onApiReady: (listener: (payload: ApiReadyPayload) => void) => () => void;
  isAutostartAvailable: () => Promise<boolean>;
  getAutostart: () => Promise<boolean>;
  setAutostart: (enabled: boolean) => Promise<boolean>;
};

declare global {
  interface Window {
    hunterDesktop?: HunterDesktopBridge;
  }
}

export function getDesktopBridge(): HunterDesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.hunterDesktop;
}
