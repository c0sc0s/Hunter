# Huntter Session Handoff

## Start Here

1. Read `AGENTS.md`.
2. Run `pnpm harness:init`.
3. Check `feature-list.json` for the next `ready` or `in_progress` feature.
4. Read `progress.md` for current facts.

## Current Session

- Goal: continue hardening Huntter into a commercial-grade, source-first content recognition system without AI dependency.
- Completed features: all 22 harness slices are `done`, through `lint-format-quality-gate`.
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
- `.github/workflows/verify.yml` runs `pnpm verify` on pull requests and pushes to `main` with Node 22, pnpm 10.33.0, Playwright Chromium, and Xvfb.
- `pnpm golden:visual` checks desktop/mobile visual contracts, no horizontal overflow, reader iframe visibility, Capture Events visibility, and writes screenshots to `artifacts/visual/`.
- `pnpm verify` now includes ESLint and Prettier format checks before tests and golden journeys.
- Browser-selected text and browser snapshot content produce sanitized Canonical Content HTML through `server/sources/contentHtml.ts`.

## Next Action

All current harness features are done. The next useful slice is lint warning tightening, baseline image diffing, toolbar-bubble automation, or a connector-specific implementation.
