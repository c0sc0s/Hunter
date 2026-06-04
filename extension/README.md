# Hunter Chrome Extension

## Local Install

1. Start the Hunter desktop app with `pnpm dev` — this launches the Electron shell, which spawns the API sidecar on the first free port in `4317–4319`.
2. Open Chrome Extensions.
3. Enable Developer mode.
4. Load unpacked and choose this `extension/` directory.

The extension probes `127.0.0.1:4317`, `4318`, `4319` in order at save time and uses the first one that responds — so it works whichever port the Electron-managed sidecar lands on. You can still override the base URL from the popup if you want to point at a different host.

The toolbar popup first checks whether the current page looks like a supported article, video, or X post detail page. Supported pages show the save form; unsupported resources show an unsupported-type bubble and do not expose the Save action. The background and context-menu save paths run the same gate before posting snapshots.

The injected extractor prefers a focused `article`, `main`, or common content container and sends that HTML with metadata. It falls back to the page body when no useful content root exists.
