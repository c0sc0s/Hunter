# Hunter Documentation Index

Use this file as the stable map for humans and coding agents. Keep `AGENTS.md` short and route deeper context here.

## Domain And Product

- `CONTEXT.md`: canonical terms and the product rule that Hunter must not fake full content from shallow metadata.
- `docs/PRODUCT_DESIGN.md`: user experience and product direction.

## Architecture

- `docs/TECHNICAL_DESIGN.md`: current architecture, API, source adapter system, extension design, and persistence strategy.
- `docs/SYSTEM_REDESIGN.md`: source-first capture model, capture modes, extraction states, and implementation status.
- `docs/DATABASE_DESIGN.md`: production storage direction and schema planning.
- `docs/CONTENT_RECOGNITION.md`: deterministic content recognition rules and source-specific behavior.
- `docs/DESKTOP_OFFLINE_ARCHITECTURE.md`: Electron desktop shell + browser extension offline queue design, covering process model, sidecar supervision, port handshake, queue API, lease concurrency, data migration, and versioning.
- `docs/AGENT_LOCAL_LLM.md`: optional agent content-understanding module backed by Ollama, DeepSeek, or another OpenAI-compatible provider, with API boundaries and verification.

## Harness

- `docs/HARNESS.md`: Harness v0 operating model and asset responsibilities.
- `feature-list.json`: feature slices, dependencies, verification, and evidence.
- `progress.md`: current work facts and latest verification status.
- `session-handoff.md`: next-session restart notes.
- `.github/workflows/verify.yml`: hosted CI gate for the full `pnpm verify` command.

## Verification Commands

- `pnpm harness:init`
- `pnpm check`
- `pnpm lint`
- `pnpm format:check`
- `pnpm test`
- `pnpm test:agent`
- `pnpm smoke:api`
- `pnpm golden:browser`
- `pnpm golden:extension`
- `pnpm golden:visual`
- `pnpm build`
- `pnpm verify`

## Golden Journeys

Executable golden journeys:

1. Save a public article browser snapshot and reach `ready`.
2. Save a Feishu browser snapshot and reach `ready` or `partial` based on visible content quality.
3. Save an X selected text or opened X snapshot and disclose fallback limits honestly.
4. `POST /api/items` without a snapshot returns 400.
5. Refresh recognition and preserve user workflow fields while replacing recognition output.
6. Browser UI journey: save, manual Reload, extension-style snapshot capture, Capture Events panel reload, search, favorite, status change, and manual Refresh through `pnpm golden:browser`.
7. Installed extension journey: load the real MV3 extension, save local articles through the background path and visible popup Save, manually Reload the web app, and verify Capture Events through `pnpm golden:extension`.
8. Visual contract journey: seed a deterministic ready snapshot item, verify desktop/mobile layouts, reader content, Capture Events, no horizontal overflow, and write screenshots through `pnpm golden:visual`.
