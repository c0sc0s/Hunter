# Hunter Chrome Extension

## Local Install

1. Start the Hunter desktop app with `pnpm dev` — this launches the Electron shell, which spawns the API sidecar on the first free port in `4317–4319`.
2. Run `pnpm extension:build` from the repository root, or `pnpm extension:watch` while editing extension files.
3. Open Chrome Extensions.
4. Enable Developer mode.
5. Load unpacked and choose the generated `extension/dist/` directory.

The extension probes `127.0.0.1:4317`, `4318`, `4319` in order at save time and uses the first one that responds — so it works whichever port the Electron-managed sidecar lands on. You can still override the base URL from the popup if you want to point at a different host.

The TypeScript source lives under `extension/src/`. `pnpm extension:check` runs the extension typecheck, `pnpm extension:build` bundles the MV3 service worker, popup module, and injected extractor into `extension/dist/`, and `pnpm extension:watch` rebuilds that same dist directory when source/static extension files change. Chrome's MV3 runtime still needs the unpacked extension to be reloaded after a rebuild.

The toolbar popup currently shows the save form for any injectable browser page. `extension/src/contentSupport.ts` keeps the earlier article/video/X detector, but `CONTENT_SUPPORT_GATE_ENABLED` is disabled while the support algorithm is redesigned. The background and context-menu save paths likewise post snapshots without this UX preflight; the server still owns final source recognition and extraction quality.

The injected extractor prefers a focused `article`, `main`, or common content container and sends that HTML with metadata. It also includes a bounded list of alternate content-root candidates plus a text-only body fallback, so the API can recover when the first focused root is too narrow or noisy.
