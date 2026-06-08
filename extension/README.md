# Hunter Chrome Extension

## Local Install

1. Start the Hunter desktop app with `pnpm dev` — this launches the Electron shell, which spawns the API sidecar on the first free port in `4317–4319`.
2. Open Chrome Extensions.
3. Enable Developer mode.
4. Load unpacked and choose this `extension/` directory.

The extension probes `127.0.0.1:4317`, `4318`, `4319` in order at save time and uses the first one that responds — so it works whichever port the Electron-managed sidecar lands on. You can still override the base URL from the popup if you want to point at a different host.

The toolbar popup currently shows the save form for any injectable browser page. `extension/src/contentSupport.js` keeps the earlier article/video/X detector, but `CONTENT_SUPPORT_GATE_ENABLED` is disabled while the support algorithm is redesigned. The background and context-menu save paths likewise post snapshots without this UX preflight; the server still owns final source recognition and extraction quality.

The injected extractor prefers a focused `article`, `main`, or common content container and sends that HTML with metadata. It also includes a bounded list of alternate content-root candidates plus a text-only body fallback, so the API can recover when the first focused root is too narrow or noisy.
