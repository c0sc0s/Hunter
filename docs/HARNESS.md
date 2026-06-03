# Huntter Harness v0

Harness v0 is the repository-local system that lets coding agents work with less guessing and more proof. It is deliberately small: files, scripts, tests, and evidence before orchestration platforms.

## Five Subsystems

| Subsystem    | Huntter Asset                                                                  | Purpose                                                                                           |
| ------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Instructions | `AGENTS.md`, `docs/INDEX.md`, `CONTEXT.md`                                     | Tell agents what to read, what rules matter, and where deeper facts live.                         |
| State        | `progress.md`, `feature-list.json`                                             | Record current facts, completed slices, blocked work, and next steps outside the chat transcript. |
| Scope        | `feature-list.json`                                                            | Keep work in one verifiable slice with dependencies and explicit out-of-scope notes.              |
| Verification | `pnpm verify`, tests, `pnpm smoke:api`, `pnpm golden:browser`, evidence fields | Prove completion with commands, results, artifacts, and mock boundaries.                          |
| Lifecycle    | `pnpm harness:init`, `session-handoff.md`                                      | Make startup, continuation, and handoff repeatable across sessions.                               |

## Operating Loop

1. Run `pnpm harness:init` to confirm the harness assets are present and parseable.
2. Pick one `ready` feature from `feature-list.json`.
3. Read the feature's `scope`, `outOfScope`, `dependencies`, and `verification`.
4. Make the smallest change that satisfies the slice.
5. Run the listed verification commands, plus `pnpm verify` before handing off.
6. Write evidence back to `feature-list.json` and update `progress.md`.
7. Update `session-handoff.md` with the next action and any caveats.

## Evidence Packet

Each completed feature should include evidence with:

- `date`: ISO date.
- `commands`: exact commands run.
- `result`: `passed`, `failed`, or `partial`.
- `artifacts`: screenshots, logs, traces, or reports when available.
- `mockBoundary`: what was mocked or not covered by live dependencies.
- `notes`: reviewer-facing details.

## First Golden Journeys

- Public URL capture reaches `ready` with canonical content.
- Feishu URL-only capture reaches `needs_connector`.
- Feishu browser snapshot reaches `ready` or `partial` based on visible content quality.
- X oEmbed, selected-text, and browser-snapshot fallbacks remain deterministic and disclose connector limits.
- Recognition refresh preserves user-owned fields and replaces recognition output.
- Browser UI journey covers save, manual Reload, extension-style snapshot capture, search, favorite, status change, and manual Refresh.

## Upgrade Rule

When the same issue appears three times, promote it in this order:

1. Document the rule.
2. Add a checklist item or feature verification command.
3. Add a test, smoke script, hook, or CI gate.
4. Add the scenario to a regression/eval backlog.
