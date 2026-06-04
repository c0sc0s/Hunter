# AGENTS.md

## Repository Entry

Hunter is a browser-extension plus web-client prototype for saving, recognizing, and reviewing reading-flow items. Start every non-trivial task by reading:

1. `CONTEXT.md` for domain language and product rules.
2. `docs/INDEX.md` for the current documentation map.
3. `feature-list.json` for scoped work slices, dependencies, verification, and evidence.
4. `progress.md` and `session-handoff.md` for current status before continuing prior work.

## Project Map

- `src/`: React/Vite web client.
- `server/`: Express API, source adapters, content recognition, content signals, and repositories.
- `server/sources/`: source adapters for generic web, X, Feishu, PDF, and video snapshots.
- `server/repositories/`: JSON and SQLite repository adapters.
- `shared/`: shared TypeScript types.
- `extension/`: Chrome Manifest V3 extension.
- `electron/`: Electron desktop shell, preload bridge, app icons, and bundled sidecar resources.
- `docs/`: product, technical, database, content recognition, and harness docs.

## Commands

- `pnpm dev`: launch the Electron desktop shell (which itself spawns the Node sidecar and serves the Vite dev URL inside the native window). This is the **only** dev entry point — the prior browser-on-`localhost:5173` workflow is gone; the API is always owned by Electron.
- `pnpm electron:dir`: build an unsigned unpacked Electron app for local smoke testing.
- `pnpm electron:build`: build the current platform Electron installer; signing/notarization remains separate release work.
- `pnpm check`: TypeScript check.
- `pnpm test`: recognition, source-contract, and repository fixtures.
- `pnpm smoke:api`: API smoke test with an in-memory repository.
- `pnpm harness:init`: validate required harness assets.
- `pnpm verify`: run the full local verification loop.

## Engineering Rules

- Keep changes small, composable, and easy to review.
- Validate inputs at API boundaries with explicit schemas.
- Do not hide failures or return fake success.
- Preserve Hunter's source-first design: route captures through source adapters instead of treating every URL as a generic article.
- Capture is browser-snapshot only. The API rejects requests without a snapshot, and source adapters must rely on snapshot data rather than fetching pages or oEmbed services.
- Never pretend shallow URL metadata is full content. Use `processing`, `ready`, `partial`, or `failed` honestly.
- Prefer deterministic local content recognition and content signals. Do not add AI-dependent recognition unless the product rule changes.
- Add or update tests when touching source adapters, repository behavior, extraction states, or public API contracts.

## Done Means

A feature slice is not complete until:

1. Its scope and dependencies are clear in `feature-list.json`.
2. Relevant commands from the feature's `verification` list have been run.
3. Evidence records the commands, result, mock boundaries, and any artifacts.
4. `progress.md` and `session-handoff.md` are updated when work will continue in another session.

Use subagents or parallel work only for read-heavy exploration, tests, triage, or review. Avoid parallel write-heavy changes unless the slices are independent.
