# Hunter

Hunter is a browser-extension plus desktop-app prototype for saving, recognizing, and reviewing articles, posts, threads, and other reading-flow items.

## Run Locally

```bash
pnpm install
pnpm dev
```

`pnpm dev` launches the Electron desktop shell. The shell owns everything:

- Renders the React UI in a native window (Vite serves the dev URL inside the webview).
- Spawns the Node sidecar that serves the API on the first free port in `4317–4319` (typically `4317`).
- Loads its dev data from the repo's `./data/` directory so the desktop shell shares the same store you've been building with previously.

The legacy "open `localhost:5173` in your browser" workflow has been retired — the desktop shell is the only supported dev entry point.

## Harness Workflow

Use the repository harness files before starting long-running agent work:

- `AGENTS.md`: agent entry point, project rules, and verification commands.
- `feature-list.json`: scoped feature slices, dependencies, verification, and evidence.
- `progress.md`: current facts and active work.
- `session-handoff.md`: restart/continue notes for the next session.

Useful commands:

```bash
pnpm harness:init
pnpm check
pnpm verify
pnpm lint
pnpm format:check
pnpm build:renderer
pnpm build:electron
pnpm golden:browser
pnpm golden:extension
pnpm golden:visual
pnpm golden:visual:update
pnpm extension:check
pnpm extension:build
pnpm extension:watch
pnpm electron:dir
pnpm electron:build
```

`pnpm check` uses TypeScript project references across `shared`, `server`, `src` renderer, `electron`, `extension`, and `scripts`. The check emits declaration-only build metadata into the ignored `.tsbuild/` directory so cross-project contracts are checked without writing runtime JavaScript into source folders.

`pnpm electron:dir` builds an unsigned unpacked app for local smoke testing. `pnpm electron:build` produces the current platform installer through electron-builder; release signing/notarization is still separate release work.

GitHub Actions runs the same `pnpm verify` gate on pull requests and pushes to `main`. The workflow uses Node 22, pnpm 10.33.0, and Xvfb so the installed Chrome extension golden can launch headed Chromium in CI. `pnpm verify` includes TypeScript, ESLint, Prettier, fixtures, API smoke, browser golden, extension golden, visual golden, and build.

## Test

```bash
pnpm test
pnpm check
pnpm build
```

`pnpm test` currently covers deterministic content signals, recognition metadata and phase timing, Capture Events, content quality rules, sanitized HTML, cover image scoring, Extracted Content contract validation, content recognition fixtures, source adapter contracts, the snapshot-required API guard, focused extension snapshots, durable recognition jobs, and SQLite Repository behavior. `pnpm golden:browser` verifies the sandboxed reader view for captured Canonical Content HTML, `pnpm golden:extension` loads the real Chrome extension into Chromium to verify installed extension capture, and `pnpm golden:visual` checks desktop/mobile visual contracts while writing screenshots to `artifacts/visual/` and comparing committed platform baselines when present. Use `pnpm golden:visual:update` to intentionally refresh the current platform's baseline PNGs.

## Chrome Extension

1. Start the local app with `pnpm dev` — this launches the Electron desktop shell, which spawns the Node sidecar that serves the API on the first free port in `4317–4319`.
2. In another terminal, run `pnpm extension:build` once, or `pnpm extension:watch` while actively editing extension code.
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Click Load unpacked.
6. Choose this repository's `extension/dist/` directory.

The extension probes `127.0.0.1:4317`, `4318`, `4319` in order and uses the first one that responds — so it talks to whichever port the Electron-managed sidecar happens to bind.

When saving a page, the extension captures a focused article/main content root when possible instead of blindly sending the full page shell. It caps snapshot HTML, text, and image candidates before posting to the local API so Save stays responsive on heavy pages. Toolbar action popup launch, Popup Save, context-menu Save, and extension E2E all route through the same background capture pipeline.

The extension source is TypeScript under `extension/src/`. `pnpm extension:check` type-checks the extension, `pnpm extension:build` bundles the MV3 service worker, popup, and injected extractor into `extension/dist/`, and `pnpm extension:watch` repeats the same build whenever source/static extension files change. Chrome still needs the unpacked extension to be reloaded after a rebuild. `pnpm golden:extension` builds that dist directory, then runs the installed extension against isolated local API, web, and article fixture servers. It proves extension background capture, toolbar action popup launch through `chrome.action.openPopup()`, visible popup Save, Web manual Reload, Capture Events visibility, and no public `captureInput` leakage.

## Engineering Model

Hunter is organized as a multi-runtime TypeScript application:

- `shared/`: pure shared contracts and helpers; no DOM, Electron, Chrome, Express, or SQLite dependencies.
- `server/`: TypeScript Node sidecar for API, recognition, repositories, and tests.
- `src/`: TypeScript React/Vite renderer.
- `electron/src/`: TypeScript Electron main, preload, and dev orchestrator source.
- `electron/dist/`: generated Electron runtime entry files used by Electron and electron-builder.
- `extension/src/`: TypeScript Chrome MV3 runtime source.
- `extension/dist/`: generated load-unpacked extension root.
- `scripts/`: TypeScript/MJS build, smoke, and golden tooling.

`pnpm build` runs the full source gate, then builds renderer assets, Electron runtime files, and the extension dist. `pnpm electron:dir` and `pnpm electron:build` add the server sidecar bundle and pass those generated runtime artifacts to electron-builder.

The Electron preload bridge contract lives in `shared/desktopBridge.ts` and is re-exported by `src/lib/desktopBridge.ts`, so renderer and preload compile against the same API surface.

## Content Recognition

Hunter does not use AI for content recognition. The backend uses source adapters that read exclusively from the browser snapshot: generic web pages use the user-selected text as a fast path when it is substantial, then Defuddle on the snapshot HTML with a lazy Mozilla Readability fallback, PDFs and videos rely on snapshot text and metadata, and metadata is used only when full extraction is not possible. Content Signals derive summary, tags, and reading time from Canonical Content and Sanitized Content HTML. Parser HTML is sanitized with DOMPurify before storage, and total plus phase recognition timing is recorded for later performance tuning.

Each Saved Item also carries a recognition version, recognized timestamp when complete, SHA-256 content hash, and internal size-bounded capture input so future parser upgrades can reprocess items from the original URL/snapshot without touching user workflow fields. API responses strip the internal capture input so large browser snapshots do not bloat the client. Capture Events record queued and completed recognition outcomes with snapshot byte counts and timing, but not raw snapshot bodies.

The web detail view renders sanitized Canonical Content HTML in a sandboxed reader iframe. This makes captured structure visible to the user without merging source HTML into the React document.

Canonical URLs strip hash fragments and known tracking parameters such as `utm_*`, `fbclid`, and `gclid` while preserving meaningful query parameters. This keeps the same article captured from different campaign links deduped.

The save action is intentionally fast: it writes a queued item and a durable recognition job immediately, then extracts content in the background. Use the web app's `Reload` button or `/reload` command to refresh the library after saving from the extension.

## Project Structure

- `src/`: React/Vite renderer.
- `server/`: Express API, content recognition, content signals, JSON and SQLite repository adapters.
- `server/repositories/`: Repository interface plus JSON and SQLite adapters.
- `server/sources/`: source adapters for generic web, X, Feishu, PDF, and video snapshots.
- `shared/`: shared TypeScript contracts and pure helpers.
- `electron/`: Electron desktop shell source, generated runtime entry files, icons, and sidecar resources.
- `extension/`: Chrome Manifest V3 extension source and generated local install target.
- `docs/`: product and technical design.

## Source Behavior

- Public web pages use substantial selected text as a fast path, then Defuddle on the snapshot HTML with Mozilla Readability fallback, schema/meta tags, and shared cover image scoring.
- PDFs are recognized from the visible text the extension captures from the rendered PDF page.
- YouTube and Vimeo pages use snapshot text and metadata, remaining `partial` until transcript support exists.
- X post URLs use selected text when the user highlights text and the captured DOM snapshot when the opened post exposes visible content; otherwise the item lands in `partial` or `failed` with an honest `sourceMessage`.
- Feishu pages are recognized from the browser snapshot of the opened document and land in `ready` or `partial` based on captured content quality.

## Persistence

The default development repository is JSON at `data/hunter-store.json`.

To run the API on SQLite:

```bash
$env:HUNTER_REPOSITORY="sqlite"
$env:HUNTER_SQLITE_PATH="data/hunter.sqlite"
pnpm dev
```

The SQLite adapter imports the JSON store on first empty startup unless `HUNTER_SQLITE_IMPORT_JSON=false` is set. It also stores durable recognition jobs. It uses Node's built-in `node:sqlite`, which is available in the current Node 22 runtime but still prints an experimental warning.

## Library Query API

`GET /api/items` supports server-side filtering and pagination:

- `q`: search text.
- `filter`: `all`, `unread`, `reading`, `read`, `archived`, or `favorite`.
- `sourceType`: `article`, `post`, `tweet`, `feishu`, `video`, `pdf`, or `other`.
- `limit`: page size, max `120`.
- `offset`: page offset.

The web client uses this API for search, filters, Reload, and Load more. It no longer relies on fetching the whole library for client-side filtering.

`GET /api/capture-events?limit=50` returns recent capture diagnostics for development and local operations views. The web sidebar shows the same event stream with its own manual Reload button.

## Command Console

The web client includes a Claude Code-inspired command bar. Focus it with `Ctrl+K` / `Cmd+K`.

Useful commands:

- `/help`: show command hints in the run log.
- `/all`: clear filters and show everything.
- `/unread`, `/reading`, `/read`, `/archive`, `/fav`: filter by workflow state.
- `/x`, `/article`, `/feishu`: filter by source.
- `/star`: toggle favorite on the selected item.
- `/mark-read`, `/mark-unread`: update the selected item.
- `/refresh`: re-run content recognition for the selected item.
- `/reload`: reload the current library page and capture events.
- `/events`: reload the Capture Events panel.
- `tag:product` or any plain text: search the library.
