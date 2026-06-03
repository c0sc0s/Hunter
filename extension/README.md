# Huntter Chrome Extension

## Local Install

1. Start the Huntter API with `pnpm dev`.
2. Open Chrome Extensions.
3. Enable Developer mode.
4. Load unpacked and choose this `extension/` directory.

The extension saves to `http://127.0.0.1:4317` by default. You can change that in the popup.

The injected extractor prefers a focused `article`, `main`, or common content container and sends that HTML with metadata. It falls back to the page body when no useful content root exists.
