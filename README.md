# Huntter

Huntter is a browser-extension plus web-client prototype for saving, recognizing, and reviewing articles, posts, threads, and other reading-flow items.

## Run Locally

```bash
pnpm install
pnpm dev
```

- Web client: http://127.0.0.1:5173
- API: http://127.0.0.1:4317

## Harness Workflow

Use the repository harness files before starting long-running agent work:

- `AGENTS.md`: agent entry point, project rules, and verification commands.
- `feature-list.json`: scoped feature slices, dependencies, verification, and evidence.
- `progress.md`: current facts and active work.
- `session-handoff.md`: restart/continue notes for the next session.

Useful commands:

```bash
pnpm harness:init
pnpm verify
pnpm lint
pnpm format:check
pnpm golden:browser
pnpm golden:extension
pnpm golden:visual
pnpm golden:visual:update
```

GitHub Actions runs the same `pnpm verify` gate on pull requests and pushes to `main`. The workflow uses Node 22, pnpm 10.33.0, and Xvfb so the installed Chrome extension golden can launch headed Chromium in CI. `pnpm verify` includes TypeScript, ESLint, Prettier, fixtures, API smoke, browser golden, extension golden, visual golden, and build.

## Test

```bash
pnpm test
pnpm check
pnpm build
```

`pnpm test` currently covers deterministic content signals, recognition metadata and phase timing, Capture Events, content quality rules, sanitized HTML, bounded HTML fetch, cover image scoring, Extracted Content contract validation, encrypted connector secret handling, content recognition fixtures, source adapter contracts, focused extension snapshots, connector state, durable recognition jobs, and SQLite Repository behavior. `pnpm golden:browser` verifies the sandboxed reader view for captured Canonical Content HTML, `pnpm golden:extension` loads the real Chrome extension into Chromium to verify installed extension capture, and `pnpm golden:visual` checks desktop/mobile visual contracts while writing screenshots to `artifacts/visual/` and comparing committed platform baselines when present. Use `pnpm golden:visual:update` to intentionally refresh the current platform's baseline PNGs.

## Chrome Extension

1. Start the local app with `pnpm dev`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Choose `C:\Users\Admin\Documents\Huntter\extension`.

The extension saves to `http://127.0.0.1:4317` by default.

When saving a page, the extension captures a focused article/main content root when possible instead of blindly sending the full page shell. It caps snapshot HTML, text, and image candidates before posting to the local API so Save stays responsive on heavy pages. Toolbar action popup launch, Popup Save, context-menu Save, and extension E2E all route through the same background capture pipeline.

`pnpm golden:extension` runs the installed extension against isolated local API, web, and article fixture servers. It proves extension background capture, toolbar action popup launch through `chrome.action.openPopup()`, visible popup Save, Web manual Reload, Capture Events visibility, and no public `captureInput` leakage.

## Content Recognition

Huntter does not use AI for content recognition. The backend uses source adapters: generic web pages use user-selected text as a fast path when it is substantial and bounded public HTML fetches before Defuddle with lazy Mozilla Readability fallback, PDFs use `unpdf`, videos use public oEmbed metadata, and browser snapshots or metadata are used only when full extraction is not possible. Content Signals derive summary, tags, and reading time from Canonical Content and Sanitized Content HTML. Parser HTML is sanitized with DOMPurify before storage, and total plus phase recognition timing is recorded for later performance tuning.

Each Saved Item also carries a recognition version, recognized timestamp when complete, SHA-256 content hash, and internal size-bounded capture input so future parser upgrades can reprocess items from the original URL/snapshot without touching user workflow fields. API responses strip the internal capture input so large browser snapshots do not bloat the client. Capture Events record queued and completed recognition outcomes with snapshot byte counts and timing, but not raw snapshot bodies.

The web detail view renders sanitized Canonical Content HTML in a sandboxed reader iframe. This makes captured structure visible to the user without merging source HTML into the React document.

Canonical URLs strip hash fragments and known tracking parameters such as `utm_*`, `fbclid`, and `gclid` while preserving meaningful query parameters. This keeps the same article captured from different campaign links deduped.

The save action is intentionally fast: it writes a queued item and a durable recognition job immediately, then extracts content in the background. Use the web app's `Reload` button or `/reload` command to refresh the library after saving from the extension.

## Project Structure

- `src/`: React web client.
- `server/`: Express API, content recognition, content signals, JSON store adapter.
- `server/repositories/`: Repository interface plus JSON and SQLite adapters.
- `server/sources/`: source adapters for generic web, X, Feishu, and future connectors.
- `shared/`: shared TypeScript types.
- `extension/`: Chrome Manifest V3 extension.
- `docs/`: product and technical design.

## Source Behavior

- Public web pages use substantial selected text as a fast path, bounded HTML fetch, then Defuddle, Readability, schema/meta tags, and shared cover image scoring.
- PDF URLs use `unpdf` text extraction with bounded download size.
- YouTube and Vimeo URLs use public oEmbed metadata and remain `partial` until transcript support exists.
- X post URLs use public oEmbed when available, selected text when the user highlights text, and browser snapshots when the opened post exposes visible content. Unresolved posts disclose X API/connector limits.
- Feishu URLs are detected as structured/private sources. Pasted URLs are marked `needs_connector`; saving from the open page with the browser extension can capture visible content as `ready` or `partial` based on content quality.
- Items that need a permissioned integration include `requiredConnector`, currently `feishu` or `x`, so the client can show the matching connector state instead of a generic parser failure.

## Connectors

`GET /api/connectors` returns connector definitions and any stored connection state. `POST /api/connectors/feishu/oauth/start` starts Feishu OAuth when app credentials are configured, `PATCH /api/connectors/:provider` updates local connector state, `DELETE /api/connectors/:provider` disconnects it and removes stored credentials, and `POST /api/connectors/:provider/sync` returns an explicit unavailable/not-implemented error until source import exists. Private Feishu/X content still requires either a browser snapshot from the extension or a future connector import path.

Feishu OAuth configuration:

```bash
$env:HUNTTER_FEISHU_CLIENT_ID="cli_xxx"
$env:HUNTTER_FEISHU_CLIENT_SECRET="xxx"
$env:HUNTTER_FEISHU_REDIRECT_URI="http://127.0.0.1:4317/api/connectors/feishu/oauth/callback"
$env:HUNTTER_FEISHU_SCOPES="offline_access docx:document:readonly"
```

Connector tokens are encrypted before JSON/SQLite storage. Set `HUNTTER_CONNECTOR_SECRET_KEY` to pin the encryption key; otherwise Huntter creates a local key under `data/`.

## Persistence

The default development repository is JSON at `data/huntter-store.json`.

To run the API on SQLite:

```bash
$env:HUNTTER_REPOSITORY="sqlite"
$env:HUNTTER_SQLITE_PATH="data/huntter.sqlite"
pnpm dev
```

The SQLite adapter imports the JSON store on first empty startup unless `HUNTTER_SQLITE_IMPORT_JSON=false` is set. It also stores durable recognition jobs. It uses Node's built-in `node:sqlite`, which is available in the current Node 22 runtime but still prints an experimental warning.

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
- `/reload`: reload the current library page, connector state, and capture events.
- `/events`: reload the Capture Events panel.
- `tag:product` or any plain text: search the library.
