# Huntter Progress

Last updated: 2026-06-03

## Current Facts

- Huntter uses a source-first capture architecture.
- Content recognition is deterministic and local; it must not depend on AI models.
- Source adapters currently cover generic web pages, X URLs, and Feishu/Lark URLs.
- Repository behavior is abstracted behind JSON and SQLite adapters.
- Feishu/X permissioned-source failures carry `requiredConnector` and render against connector state.
- Connector state can now be updated or cleared through the API, while connector sync requests fail explicitly until real provider handlers exist.
- Feishu OAuth authorization start/callback exists behind configured app credentials and stores access/refresh tokens as encrypted server-side connector credentials.
- Feishu manual sync refreshes expired or near-expired access tokens with the stored refresh token before provider API calls.
- Feishu manual sync can import saved direct `/docx/{document_id}` URL-only items and `/wiki/{node_token}` pages that resolve to docx through official Feishu APIs, replacing `needs_connector` with connector-provenance `ready`/`partial` content.
- Disconnecting Feishu clears encrypted connector credentials as well as public connector state.
- The web sidebar now exposes manual connector Sync and Disconnect controls, and planned availability no longer hides local connection state.
- The web sidebar now exposes manual connector Connect controls; users still click Reload after completing OAuth because the client does not poll.
- The desktop sidebar is scrollable with non-shrinking operational panels so Capture and connector controls are not clipped.
- Feishu browser snapshots now use the content quality gate, producing `ready` for substantial visible content and `partial` for limited visible content.
- X captures now use bounded oEmbed, selected-text fallback, and browser-snapshot fallback before requiring a future X connector.
- The web client uses manual Reload; it does not poll for background recognition.
- The extension caps browser snapshot payloads before posting to the local API.
- Popup Save delegates to the extension background save-tab pipeline instead of owning duplicate extraction and POST logic.
- Generic web recognition now has a pure quality gate for candidate selection, extraction state, confidence, selected-text parser skip, and lazy Readability fallback.
- Generic web public fetches are bounded by timeout, accepted content type, and max HTML bytes before parser work.
- Parser HTML is sanitized with DOMPurify before storage as Sanitized Content HTML.
- Saved Items now carry Recognition Version, recognized timestamp, and Content Hash for parser upgrades and reprocessing comparisons.
- Saved Items now record recognition duration in milliseconds for parser and Source Adapter performance tuning.
- Saved Items now record recognition phase timing for Source Adapter, Content Signals, and item-build work.
- Saved Items and recognition jobs now use bounded Capture Input for refresh/reprocessing while public API responses strip it to avoid returning large snapshots.
- Capture Events now record queued captures, recognition outcomes, manual refresh outcomes, snapshot byte sizes, timing, content hashes, and errors without storing raw snapshot bodies.
- The web client now has a manual Capture Events sidebar panel and `/events` command; it still does not poll.
- Stored Capture Input is size-bounded and normalized before persistence.
- Duplicate saves preserve browser-snapshot Capture Input over weaker URL-only input.
- Browser golden journey is executable through `pnpm golden:browser` and is included in `pnpm verify`.
- Installed Chrome extension golden journey is executable through `pnpm golden:extension` and is included in `pnpm verify`.
- The installed extension golden now covers both background save messaging and visible popup Save clicks.
- The installed extension golden now invokes `chrome.action.openPopup()` to smoke-test the toolbar action popup entry before the observable popup Save flow.
- Visual golden journey is executable through `pnpm golden:visual` and is included in `pnpm verify`.
- Visual golden now compares against committed platform-specific PNG baselines when a baseline exists; `win32-x64` baselines are committed.
- ESLint and Prettier are configured and included in `pnpm verify`.
- ESLint now runs with `--max-warnings=0`; the quality gate fails on any lint warning.
- GitHub Actions now runs the full `pnpm verify` gate for pull requests and pushes to `main`.
- PDF URLs now route through a first-class `pdf` Source Adapter using `unpdf`, with bounded download size and browser snapshot fallback.
- YouTube/Vimeo URLs now route through a first-class `video` Source Adapter using public oEmbed metadata and honest `partial` state.
- Canonical URLs strip known tracking parameters while preserving meaningful query parameters, improving duplicate detection.
- Browser extension snapshots now prefer focused content roots over blind full-page DOM slices.
- Generic web metadata now selects Article-like JSON-LD nodes across scripts and `@graph` structures before generic document-shell metadata.
- Canonical Content HTML now follows the winning extractor: browser selection, browser snapshot, or parser output.
- The web detail view renders Sanitized Content HTML inside a sandboxed reader iframe.
- Cover images now use shared scoring across queued previews and Source Adapters instead of first-image-wins heuristics.
- Content Signals now derive summary, tags, and reading time from Canonical Content and Sanitized Content HTML through a dedicated module.
- Source Adapter outputs are runtime-validated at the registry seam before item building.
- Test fixtures exist for recognition and SQLite repository behavior.
- Harness v0 is being added to make agent work scoped, stateful, verifiable, and handoff-friendly.

## Active Work

- No active harness feature. All current feature slices are done.

## Latest Verification

- 2026-06-03: `pnpm verify` passed.
- Covered `pnpm harness:init`, `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm smoke:api`, `pnpm golden:browser`, `pnpm golden:extension`, `pnpm golden:visual`, and `pnpm build`.
- Latest run also covered connector source contracts, SQLite connector state, and `/api/connectors` smoke behavior.
- Latest run added `pnpm test:quality` for selected text, selected-text parser skip, Defuddle, browser snapshot, metadata-only, and lazy Readability fallback decisions.
- Latest run added `pnpm test:html` for stored content HTML sanitization: scripts, event handlers, JavaScript URLs, style attributes, SVG, and named property isolation.
- Latest run added `pnpm test:metadata` and API smoke assertions for recognition version, recognized timestamp, and SHA-256 content hash.
- Latest run added source contract coverage for text PDF extraction through `unpdf` and API smoke coverage for the new source adapter list.
- Latest run added source contract coverage for YouTube/Vimeo oEmbed metadata and API smoke coverage for the new video adapter.
- Latest run added `pnpm test:url` for tracking-parameter cleanup, query preservation, deterministic ordering, and SQLite dedupe.
- Latest run added `pnpm test:extension` for focused article/main HTML snapshot extraction and image priority.
- Latest run updated recognition fixtures to cover JSON-LD `@graph` and multi-script Article metadata selection.
- Latest run added recognition fixtures for browser-selected Canonical Content and logged-in style browser snapshot text fallback.
- Latest run promoted `capture-public-url` to `done` with feature evidence in `feature-list.json`.
- Latest run promoted `capture-feishu-url` to `done` with source-contract coverage for URL-only `needs_connector`, limited snapshot `partial`, and substantial snapshot `ready`.
- Latest run promoted `capture-x-url` to `done` with source-contract coverage for public oEmbed `ready`, selected-text `partial`, browser snapshot `ready`, and oEmbed failure `needs_connector`.
- Latest run promoted `refresh-recognition` to `done` with repository and API smoke coverage for stored capture input, workflow-field preservation, and public response stripping.
- Latest run added `pnpm golden:browser` for an executable browser journey covering save, manual Reload, extension-style snapshot capture, search, favorite, status change, and manual Refresh.
- Latest run added `pnpm test:capture-input` for size-bounded internal capture input and refresh input reconstruction; full `pnpm verify` passed with this coverage included.
- Latest run promoted `selected-capture-fast-path` to `done`; generic web recognition now skips Defuddle/Readability when browser-selected text already meets the ready threshold.
- Latest run added `pnpm test:cover` for shared cover image scoring and low-quality image rejection.
- Latest run added `pnpm test:html-fetch` for public HTML fetch content-type and byte-size boundaries.
- Latest run expanded `pnpm golden:browser` to assert that captured Canonical Content HTML appears in the sandboxed reader iframe.
- Latest run added `pnpm test:signals` for structured summary, deterministic tags, low-signal filtering, CJK text, and reading time.
- Latest run added recognition duration assertions to recognition fixtures, SQLite repository fixtures, and API smoke.
- Latest run added `pnpm test:contract` for Extracted Content required fields, state invariants, confidence, URL fields, and `contentHtml` safety.
- Latest run added `pnpm test:timing` for recognition total, Source Adapter, Content Signals, and item-build phase timing.
- Latest run added `pnpm test:capture-events` and API smoke assertions for Capture Events, snapshot byte accounting, SQLite persistence, and no raw snapshot text leakage.
- Latest run expanded `pnpm golden:browser` to cover manual Capture Events panel reload and extension snapshot event visibility.
- Latest run added `pnpm golden:extension` for installed Manifest V3 capture through the real extension background path, Web manual Reload, Capture Events, no public `captureInput`, and no raw snapshot text in event responses.
- Latest run extended `pnpm golden:extension` to click the visible popup Save button and verify tags, note, reader content, and browser-snapshot provenance.
- Latest run extended `pnpm golden:extension` to invoke `chrome.action.openPopup()` from the service worker before the observable popup Save flow.
- Latest run added connector state control APIs for patch, disconnect, and explicit unsupported sync responses.
- Latest run expanded `pnpm smoke:api` to cover connector state updates, single-connector reads, disconnected sync failure, planned sync failure, and disconnect behavior.
- Latest run tightened `pnpm golden:visual` visible-control checks with IntersectionObserver clipping checks for desktop Capture and connector controls.
- Latest run refreshed `win32-x64` visual baselines after the connector sidebar and unclipped Capture panel layout change.
- Latest run added Feishu OAuth start/callback endpoints, short-lived OAuth state, PKCE authorization parameters, mocked token exchange coverage, account label lookup, and encrypted connector credential storage.
- Latest run added `pnpm test:connector-secrets` for AES-GCM connector token sealing and added SQLite credential CRUD coverage.
- Latest run expanded `pnpm smoke:api` to cover Feishu OAuth missing-config errors, authorization URL generation, callback token storage, public response token exclusion, and disconnect credential cleanup.
- Latest run refreshed `win32-x64` visual baselines after the sidebar connector action changed from Sync to Connect for disconnected providers.
- Latest run added Feishu direct docx raw-content import on manual connector sync, using decrypted server-side user access tokens and recording connector Capture Events without raw content leakage.
- Latest run expanded `pnpm smoke:api` to cover URL-only Feishu docx capture, connector sync import, connector provenance, sanitized reader HTML, content hash, and event privacy.
- Latest run added Feishu wiki node resolution on manual connector sync, using the official wiki get_node API before docx raw-content import.
- Latest run expanded `pnpm smoke:api` to cover URL-only Feishu wiki capture, wiki-to-docx resolution, connector provenance, resolved title usage, sanitized reader HTML, content hash, and event privacy.
- Latest run added Feishu access-token refresh before manual connector sync, rotating encrypted access and refresh tokens when stored access is expired or near expiry.
- Latest run expanded `pnpm smoke:api` to cover expired-token detection, refresh-token exchange, one-time refresh-token rotation, encrypted credential replacement, and subsequent docx/wiki API calls using the refreshed access token.
- Latest run added `.github/workflows/verify.yml` so hosted CI uses Node 22, pnpm 10.33.0, Playwright Chromium, Xvfb, and the same `pnpm verify` command.
- Latest run added `pnpm golden:visual` for desktop/mobile visual contracts, screenshot artifacts, reader iframe visibility, Capture Events visibility, and no horizontal overflow.
- Latest run added ESLint flat config, Prettier config, `pnpm lint`, `pnpm format:check`, and wired both checks into `pnpm verify`.
- Latest run tightened `pnpm lint` to zero warnings by refactoring App data-load callbacks and scoping shadcn primitive fast-refresh export handling.
- Latest run added platform visual baseline diffing with `pnpm golden:visual:update`, committed `win32-x64` baselines, and zero-warning static checks.
- Note: Node emitted an experimental warning for `node:sqlite`; verification still passed.

## Open Gaps

- Feishu OAuth authorization, encrypted token storage, sync-time token refresh, direct docx raw-content import, and wiki-node-to-docx import are implemented, but non-docx wiki import, block fidelity, permission refresh, and background sync are not implemented.
- X OAuth/import connector is not implemented; only local connector state control and explicit unsupported sync responses exist.
- Native Chrome toolbar bubble target inspection is still not executable through Playwright in this workspace; the toolbar action popup API itself is now smoke-tested.
- `linux-x64` visual baselines are not committed yet; GitHub Actions temporarily allows missing platform baselines until they are generated from a CI-compatible Linux environment.

## Next Step

All current harness features are `done`. The next hardening step should add Feishu block-level import, non-docx wiki import, permission refresh, generate and commit `linux-x64` visual baselines, or explore CDP target inspection for native toolbar bubble screenshots.
