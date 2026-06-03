# Huntter Session Handoff

## Start Here

1. Read `AGENTS.md`.
2. Run `pnpm harness:init`.
3. Check `feature-list.json` for the next `ready` or `in_progress` feature.
4. Read `progress.md` for current facts.

## Current Session

- Goal: continue hardening Huntter into a commercial-grade, source-first content recognition system without AI dependency.
- Completed features: all 26 harness slices are `done`, through `connector-state-control`.
- Verification: `pnpm verify` passed on 2026-06-03.

## Handoff Notes

- Keep Harness assets short and operational.
- Preserve the product rule: shallow metadata must never be reported as full content.
- Feishu URL-only capture returns `needs_connector`; Feishu browser snapshots use the content quality gate and can become `ready` when substantial visible content is captured.
- X capture uses bounded public oEmbed, selected-text fallback, browser-snapshot fallback, and connector-required fallback for unresolved posts.
- Manual refresh uses stored internal capture input, preserves user workflow fields, and strips capture input from API responses.
- Stored capture input is size-bounded in `server/captureInput.ts` before persistence.
- `pnpm golden:browser` runs an isolated Playwright journey covering save, manual Reload, extension-style snapshot capture, search, favorite, status change, and manual Refresh.
- `pnpm golden:extension` installs the real MV3 extension in Chromium, saves deterministic local articles through the extension background path and visible popup Save, verifies Web manual Reload and Capture Events, and asserts no public snapshot leakage.
- `pnpm golden:extension` also invokes `chrome.action.openPopup()` from the service worker to smoke-test the toolbar action entry; Playwright still does not expose the native toolbar bubble as an interactable page target here.
- `.github/workflows/verify.yml` runs `pnpm verify` on pull requests and pushes to `main` with Node 22, pnpm 10.33.0, Playwright Chromium, and Xvfb.
- `pnpm golden:visual` checks desktop/mobile visual contracts, no horizontal overflow, reader iframe visibility, Capture Events visibility, and writes screenshots to `artifacts/visual/`.
- `pnpm golden:visual` also compares screenshots against platform baselines when present; `tests/visual-baselines/win32-x64/` is committed and `pnpm golden:visual:update` refreshes baselines explicitly.
- GitHub Actions currently sets `HUNTTER_VISUAL_ALLOW_MISSING_BASELINE=true` because `linux-x64` baselines still need to be generated from a Linux environment with Playwright system dependencies.
- `pnpm verify` now includes ESLint and Prettier format checks before tests and golden journeys.
- `pnpm lint` runs with `--max-warnings=0`; warning regressions now fail locally and in CI.
- Browser-selected text and browser snapshot content produce sanitized Canonical Content HTML through `server/sources/contentHtml.ts`.
- Connector state can be patched or disconnected through the API, and connector sync requests return explicit `409` or `501` responses until real provider handlers exist.
- The web sidebar has manual connector Sync/Disconnect controls, separates local connection state from planned availability, and no longer clips Capture or connector controls.

## Next Action

All current harness features are done. The next useful slice is generating and committing `linux-x64` visual baselines, exploring CDP target inspection for native toolbar bubble screenshots, or the first real connector implementation once OAuth scopes and token storage are specified.
