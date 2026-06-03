# Huntter Domain Context

## Core Terms

- **Saved Item**: A user-saved piece of information, such as an article, X post, Feishu document, forum post, video, or PDF.
- **Source**: The origin platform or document system for a Saved Item, such as generic web, X, Feishu, Reddit, Notion, or WeChat.
- **Source Adapter**: The module that knows how to capture one Source. It decides whether a URL can be parsed publicly, needs a browser snapshot, or needs an account connector.
- **Capture**: The act of turning something the user sees into a Saved Item. Capture can happen through pasted URL, browser extension snapshot, or connector import.
- **Capture Event**: An audit record for a Capture or recognition refresh, including source URL, capture method, snapshot size, resulting Extraction State, timing, and error context.
- **Browser Snapshot**: Page data captured inside the user's browser session: visible text, DOM HTML, selected text, metadata, images, and favicon.
- **Connector**: An account-authorized integration for Sources that cannot be captured reliably by public URL or visible DOM alone.
- **Canonical Content**: The normalized representation Huntter derives from a Capture: title, source, readable text, sanitized content HTML, cover candidates, author, publication time, language, and confidence.
- **Canonical URL**: The normalized identity URL for a Saved Item. It removes hash fragments and known tracking parameters while preserving meaningful query parameters.
- **Sanitized Content HTML**: Parser output cleaned before storage so future reader views can render captured structure without trusting raw source markup.
- **Content Recognition**: The deterministic local process that turns raw URL/HTML/snapshot data into Canonical Content. It must not depend on AI models.
- **Recognition Version**: The deterministic pipeline version that produced a Saved Item's Canonical Content.
- **Content Hash**: A SHA-256 fingerprint of Canonical Content used to compare parser output across reprocessing runs without depending on user workflow fields.
- **Content Signals**: Derived fields from Canonical Content, including summary, tags, reading time, confidence, and extraction provenance.
- **Extraction State**: The system's honest statement about capture quality: `ready`, `partial`, `needs_connector`, or `failed`.
- **Enrichment**: Legacy code/module name for Content Signals. New product and architecture language should prefer Content Signals.

## Product Rule

Huntter must never pretend shallow URL metadata is the full content. If content cannot be captured, the Saved Item should explain which Capture path is required next.
