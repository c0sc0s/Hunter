# AGENTS.md

## Repository Entry

Huntter is a browser-extension plus web-client prototype for saving, recognizing, and reviewing reading-flow items. Start every non-trivial task by reading:

1. `CONTEXT.md` for domain language and product rules.
2. `docs/INDEX.md` for the current documentation map.
3. `feature-list.json` for scoped work slices, dependencies, verification, and evidence.
4. `progress.md` and `session-handoff.md` for current status before continuing prior work.

## Project Map

- `src/`: React/Vite web client.
- `server/`: Express API, source adapters, content recognition, content signals, and repositories.
- `server/sources/`: source adapters for generic web, X, Feishu, and future connectors.
- `server/repositories/`: JSON and SQLite repository adapters.
- `shared/`: shared TypeScript types.
- `extension/`: Chrome Manifest V3 extension.
- `docs/`: product, technical, database, content recognition, and harness docs.

## Commands

- `pnpm dev`: run API and web client.
- `pnpm check`: TypeScript check.
- `pnpm test`: recognition, source-contract, and repository fixtures.
- `pnpm smoke:api`: API smoke test with an in-memory repository.
- `pnpm harness:init`: validate required harness assets.
- `pnpm verify`: run the full local verification loop.

## Engineering Rules

- Keep changes small, composable, and easy to review.
- Validate inputs at API boundaries with explicit schemas.
- Do not hide failures or return fake success.
- Preserve Huntter's source-first design: route captures through source adapters instead of treating every URL as a generic article.
- Never pretend shallow URL metadata is full content. Use `ready`, `partial`, `needs_connector`, or `failed` honestly.
- Prefer deterministic local content recognition and content signals. Do not add AI-dependent recognition unless the product rule changes.
- Add or update tests when touching source adapters, repository behavior, extraction states, or public API contracts.

## Done Means

A feature slice is not complete until:

1. Its scope and dependencies are clear in `feature-list.json`.
2. Relevant commands from the feature's `verification` list have been run.
3. Evidence records the commands, result, mock boundaries, and any artifacts.
4. `progress.md` and `session-handoff.md` are updated when work will continue in another session.

Use subagents or parallel work only for read-heavy exploration, tests, triage, or review. Avoid parallel write-heavy changes unless the slices are independent.
