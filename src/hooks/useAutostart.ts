import { useCallback, useEffect, useState } from "react";
import { getDesktopBridge } from "@/lib/desktopBridge";

/**
 * Autostart toggle bridge to the desktop shell.
 *
 * Auto-detects whether it is running inside the Electron shell. In a plain
 * browser context (e.g. a golden test that hits the Vite dev server directly,
 * or someone opening the bundled web build in a browser), `available` is
 * `false`, `setEnabled` is a no-op, and callers can hide their UI.
 *
 * The OS is the source of truth — the user may have toggled the launch agent
 * in System Settings since we last looked — so we re-read after every
 * mutation instead of trusting the local React state.
 */
export type AutostartState = {
  available: boolean;
  loading: boolean;
  enabled: boolean | null;
  error: string | null;
  setEnabled: (next: boolean) => Promise<void>;
  refresh: () => Promise<void>;
};

function describeError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function useAutostart(): AutostartState {
  const [available, setAvailable] = useState<boolean>(() => Boolean(getDesktopBridge()));
  const [loading, setLoading] = useState<boolean>(available);
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    setError(null);
    try {
      const bridge = getDesktopBridge();
      if (!bridge) {
        setAvailable(false);
        return;
      }

      const supported = await bridge.isAutostartAvailable();
      setAvailable(supported);
      if (!supported) {
        setEnabledState(null);
        return;
      }

      setEnabledState(Boolean(await bridge.getAutostart()));
    } catch (err) {
      setError(describeError(err, "Could not read autostart state"));
    } finally {
      setLoading(false);
    }
  }, [available]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setEnabled = useCallback(
    async (next: boolean) => {
      if (!available) return;
      setLoading(true);
      setError(null);
      try {
        const bridge = getDesktopBridge();
        if (!bridge) {
          setLoading(false);
          return;
        }
        await bridge.setAutostart(next);
      } catch (err) {
        setError(describeError(err, "Could not change autostart state"));
        setLoading(false);
        return;
      }
      // Re-read once the mutation lands; refresh() owns the final loading
      // flag transition so we don't flicker on success.
      await refresh();
    },
    [available, refresh]
  );

  return { available, loading, enabled, error, setEnabled, refresh };
}
