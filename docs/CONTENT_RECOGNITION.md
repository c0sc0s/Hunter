# Content Recognition Design

## Goal

Hunter should capture what the user actually meant to save, not merely store a URL preview. The recognition pipeline must be deterministic, fast enough for background processing, and honest about capture quality.

AI is intentionally out of scope for content recognition. Summary, tags, reading time, cover image, and confidence are Content Signals derived from captured content. The optional agent module can run local LLM classification after an item exists, but that result must not decide extraction state or replace deterministic recognition output.

## Library Decision

Primary parser: Defuddle.

- It is designed for web-clipper style use cases.
- It extracts cleaned content, title, author, site, favicon, image, language, publication date, schema.org data, and word count.
- It can run in Node with a DOM implementation, which fits the current JSDOM-based API.
- Current review: Defuddle's own documentation positions it for extracting main content from local HTML/URLs and notes it was created for Obsidian Web Clipper, which matches Hunter's extension-first model.

Fallback parser: Mozilla Readability.

- It is stable and widely used for reader-mode extraction.
- It remains valuable when Defuddle fails or returns low-signal output.
- Current review: Mozilla Readability remains a small, well-understood fallback that accepts a DOM document and works with JSDOM.

Sanitizer: DOMPurify.

- Parser output is still untrusted markup.
- DOMPurify officially supports server-side Node usage with jsdom and can restrict output to the HTML profile.
- Hunter sanitizes `contentHtml` before storage, forbids style tags/attributes, and enables named property isolation.

PDF text: snapshot only.

- The browser extension already extracts visible text from the rendered PDF viewer; Hunter reuses that snapshot text instead of fetching and parsing the binary again.
- Scanned/image-heavy PDFs remain a future OCR adapter.

Video metadata: snapshot only.

- Hunter relies on the YouTube/Vimeo watch-page snapshot for title, author, and thumbnail data; saved videos stay `partial` until snapshot-based transcript support exists.
- No oEmbed or other server-side fetch is involved.

Avoid for now: Postlight/Mercury parser.

- It has useful custom-parser ideas, but adds more legacy surface area than the current product needs.
- If Hunter later needs source-specific CSS selectors, implement them as Source Adapters rather than adopting a broad parser framework.

## Pipeline

```mermaid
flowchart TD
  Input["Browser Snapshot"] --> Router["Source Adapter Registry"]
  Router --> Source["Source Adapter"]
  Source --> SnapshotHtml["Snapshot HTML/Text"]
  Source --> SnapshotPdf["Snapshot PDF Text"]
  Source --> SnapshotVideo["Snapshot Video Metadata"]
  SnapshotHtml --> Defuddle["Defuddle"]
  Defuddle --> Quality["Quality Gate"]
  SnapshotPdf --> Quality
  SnapshotVideo --> Quality
  Quality -->|good| Canonical["Canonical Content"]
  Quality -->|weak| Readability["Readability Fallback"]
  Readability --> Canonical
  SnapshotHtml --> SnapshotFallback["Snapshot Text Fallback"]
  SnapshotFallback --> Canonical
  Canonical --> Sanitizer["DOMPurify HTML Sanitizer"]
  Sanitizer --> Signals["Content Signals"]
  Signals --> Item["Saved Item"]
```

## Canonical Content

Canonical Content is the normalized extraction output:

- URL and canonical URL.
- Title and source name.
- Source type.
- Excerpt and readable text.
- Sanitized content HTML when available.
- For browser selection, Canonical Content HTML is generated from the selected passage instead of a parser's guessed full page.
- For browser snapshot fallback, Canonical Content HTML uses sanitized focused snapshot HTML when it contains substantial text, otherwise it falls back to escaped readable text.
- Cover image, favicon, author, publication time, language, and word count.
- Extractor provenance: `defuddle`, `readability`, `browser_selection`, `browser_snapshot`, `unpdf`, or `metadata`.
- Confidence and Extraction State.
- Recognition Version, recognized timestamp, and Content Hash for parser upgrades and reprocessing comparisons.

## URL Identity Rules

Canonical URLs remove hash fragments and known tracking parameters such as `utm_*`, `fbclid`, `gclid`, `msclkid`, and newsletter campaign IDs. Meaningful query parameters such as `id`, `page`, and `q` are preserved and sorted. This keeps duplicate captures from marketing links together without collapsing distinct resources.

## Quality Rules

- Prefer user-selected text when it is substantial, and skip expensive full-page parser work for that capture.
- Prefer Defuddle text over Readability text when it contains meaningful content.
- Prefer Readability over raw snapshot text to avoid navigation and sidebar noise.
- Use snapshot text when logged-in content cannot be fetched publicly.
- Use metadata only as a shallow fallback and mark the item as `partial`.
- Validate Source Adapter output before item building so invalid URLs, unsafe `contentHtml`, fake `ready` states, and fake `failed` states fail loudly.
- Parse all JSON-LD scripts and `@graph` structures by selecting Article-like nodes before generic WebSite/Breadcrumb nodes.
- Prefer structured titles and images from Open Graph, Twitter Card, and Article JSON-LD before generic document titles.
- Score cover images through the shared Cover Image module so logos, favicons, sprites, placeholders, known platform-default Open Graph images, and avatars do not beat structured-data thumbnails, source-specific media, or strong in-content article images. Site-level metadata is a candidate, not an unconditional winner.
- Keep the quality gate pure and tested in `server/sources/contentQuality.ts`.
- Run Mozilla Readability only when selected text and Defuddle output are below quality thresholds.

## Content Form Detection

Source Adapter routing is by host so each Source can apply the right recognition rules to the browser snapshot. Content shape ("this page is primarily a video / article / discussion / product") is a separate concern and must not be inferred from host.

`server/sources/contentForm.ts` is a pure detector that reads only structural signals from the captured document:

- Open Graph `og:type` (e.g., `video.other`, `music.song`, `article`, `product`).
- Twitter card `twitter:card=player`.
- JSON-LD `@type` across all scripts and `@graph` nodes (e.g., `VideoObject`, `PodcastEpisode`, `NewsArticle`, `DiscussionForumPosting`, `Product`, `ImageObject`).
- oEmbed discovery `<link rel="alternate" type="application/json+oembed">`.
- `<video>` element count, used only as a tiebreaker so articles that embed a video are not misclassified.

Each signal contributes a deterministic score per Content Form (`video`, `audio`, `article`, `discussion`, `product`, `image`, or `unknown`). A form is committed only when its score crosses the decide threshold, so weak signals leave the form as `unknown` and downstream code does not act.

Generic Web extraction calls the detector after JSDOM parsing. It promotes `sourceType` to `video` only when:

1. URL-based routing fell into the generic `article` bucket (so host-specific adapters such as Feishu, X, PDF, and Video stay authoritative), and
2. the detector commits to `video`.

When a page is promoted to video, extraction state remains controlled by the quality gate; metadata-only captures stay `partial`. Other Content Forms (`audio`, `discussion`, `product`, `image`) are still produced by the detector for future use, but they are not yet mapped to additional `SourceType` values.

This split keeps host routing simple and access-aware while making content-shape recognition deterministic, local, free of per-host code, and free of third-party runtime dependencies.

## Video Metadata From Snapshot JSON-LD

Once the Content Form Detector commits to `video` (or `audio`), Generic Web extraction reads the form-shaped JSON-LD node directly through `pickJsonLdNodeForForm` in `server/sources/jsonLd.ts`. This is the page's own declaration of its primary resource, so its fields are preferred over page-wide fallbacks:

- `VideoObject.author.name` (or `AudioObject.author.name`) → `author`, ahead of Defuddle's site-level `<meta name="author">`.
- `VideoObject.uploadDate` (or `datePublished` / `dateModified` as fallbacks) → `publishedAt`, ahead of `article:published_time` and Defuddle's parsed date.
- `VideoObject.thumbnailUrl` (or `image.url` / `image.contentUrl`) → preferred cover image, ahead of `og:image` and structural cover heuristics.

The Article-shaped picker remains the fallback when no form-shaped node exists or when the page is not video/audio. `parseIsoDurationSeconds` is in place to expose video duration once a future slice extends `SourceType`/`LibraryItem` to carry it.

This change stays inside the snapshot the extension already provides — no extra network calls, no third-party APIs, no per-host adapter code.

## Browser Snapshot Rules

The extension does not blindly store the first chunk of the full page DOM. It chooses a focused content root first:

- Prefer the selected text's nearest `article`, `main`, or `[role=main]` ancestor.
- Otherwise score common article containers by text, paragraphs, and images.
- Fall back to `body` only when no useful content root exists.
- Serialize metadata-rich `<head>` elements plus the focused root HTML, capped by size.
- Preserve a bounded `contentCandidates` list containing the focused root, alternate high-scoring roots, and a text-only body fallback so the server can choose stronger text for parsing, snapshot fallback, and later classification.
- Collect structured image candidates from metadata, focused-root images, `srcset`/lazy-loading attributes, and inline `background-image` declarations.
- Keep each image candidate's URL, score, source kind, dimensions, alt/context text, and focused-root membership where available.
- Rank candidates before applying the fixed candidate cap so source-specific media and focused-root article images are not displaced by avatars, icons, default platform previews, or sidebar images.
- Let the server re-score the bounded candidate pool together with JSON-LD preferred thumbnails and HTML-derived candidates, so a strong body/figure image can beat a generic site-level `og:image`. If every candidate is weak or unusable, the item has no cover.

This gives private, logged-in, and dynamic pages better Canonical Content while keeping the extra payload bounded.

## Source Rules

- Generic public pages: selected text fast path -> Defuddle on snapshot HTML -> Readability fallback -> snapshot text -> metadata.
- Feishu/Lark: browser snapshot can produce `ready` when substantial visible content is captured, or `partial` when limited.
- X/Twitter: selected text or visible browser snapshot content. The X adapter prefers attached tweet media (`pbs.twimg.com/media`) over X's default site Open Graph image, while private bookmarks, full author fidelity, and thread expansion stay out of scope until a future snapshot-based approach exists.
- PDFs: snapshot text from the rendered PDF viewer; text PDFs can become `ready`, limited/scanned PDFs remain `partial` or `failed` until OCR exists.
- Videos: snapshot text and metadata from the watch page; transcripts remain future work. Pages on hosts without a dedicated video adapter (for example Bilibili) are recognized as video via the Content Form Detector when their structural signals declare a video form.
- Other structured tools should become first-class Source Adapters instead of being forced into generic web parsing.

## Performance

- API save returns a queued item quickly.
- Recognition runs in the background.
- The web client does not poll; the user refreshes with Reload.
- Extension snapshots are capped before being posted to the local API.
- The server never fetches the source URL: recognition uses only the snapshot the extension delivered.
- Defuddle runs with `useAsync: false` so recognition does not trigger hidden third-party fetches.
- Strong browser selections skip Defuddle and Readability for generic web pages. Readability fallback is lazy; strong Defuddle results also skip the extra parse.

## HTML Safety

Canonical Content stores sanitized `contentHtml` when parser HTML, browser selection, or browser snapshot content is available. The sanitizer uses DOMPurify with the HTML profile, forbids `style`, and isolates named properties. Browser-selected text is converted to escaped paragraph HTML. Browser snapshot HTML is stored only when its body text is substantial enough; otherwise Hunter falls back to escaped readable text so logged-in app shells do not become empty Canonical Content. The web client renders `contentHtml` inside a sandboxed reader iframe, without script, form, popup, or same-origin privileges.

## Content Signals

Content Signals are built in `server/contentSignals.ts`. The module uses Sanitized Content HTML structure when available, so summaries prefer the first real paragraph instead of nav/sidebar text. Tags are deterministic weighted keywords from source type, domain, title, headings, paragraphs, and readable text, with low-signal UI words filtered out. Reading time is derived from captured content word count and stays independent from user notes or workflow fields.

## Reprocessing Metadata

Every queued or recognized Saved Item carries the current `recognitionVersion` and a SHA-256 `contentHash` over Canonical Content fields. Completed recognition also records `recognizedAt`, `recognitionDurationMs`, and `recognitionTiming` with Source Adapter, Content Signals, and item-build phase timing. The repository stores internal, size-bounded `captureInput`, and recognition jobs use the same bounded snapshot input, so manual refresh and future parser upgrades can re-run against the original URL/snapshot without exposing large snapshots through the API or bloating transient job storage. These fields let future migrations answer:

- Which items were produced by an old recognition pipeline.
- Whether a parser or sanitizer change actually changed Canonical Content.
- Whether reprocessing can preserve user workflow fields while replacing only recognition output.
- Whether browser-snapshot captures can be refreshed using the stored snapshot input.
- Whether duplicate saves preserved the strongest available capture input for future refresh.
- Which parser paths are becoming slow enough to require thresholds, queue tuning, or Source Adapter optimization.
- Whether latency comes from Source Adapter work, Content Signals, or item assembly.

Capture Events provide the operational audit trail around those fields. They record queued captures, recognition outcomes, manual refresh outcomes, snapshot byte size, result state, timing, content hash, and error context without storing raw browser snapshot HTML or text in the event stream.

## Test Fixtures To Add

- Static public article HTML with Open Graph image. Done.
- Article with JSON-LD `@graph` and multi-script title, image, author, and date selection. Done.
- Noisy page with nav/sidebar where Defuddle should beat raw snapshot text. Done.
- URL normalization and canonical dedupe for tracking parameters. Done.
- Browser extension focused content-root snapshot extraction. Done.
- Logged-in style page where snapshot text is the only useful content. Done.
- PDF snapshot text extraction through the PDF Source Adapter. Done.
- YouTube/Vimeo snapshot metadata through the Video Source Adapter. Done.
- Feishu/Lark snapshot with limited text -> `partial`; substantial snapshot -> `ready`. Done.
- X selected-text and browser snapshot fallbacks. Done.
- Refresh recognition using stored capture input while preserving status, favorite, note, and user tags. Done.
- Capture input storage budget for large snapshots. Done.
- `POST /api/items` without a snapshot returns 400. Done.
- Recognition metadata tests for stable SHA-256 content hashes and pipeline version. Done.
- Recognition timing tests for total, Source Adapter, Content Signals, and item-build phase durations. Done.
- Quality gate tests for selected-text fast path, parser selection, lazy Readability fallback, metadata-only partial state, and browser snapshot fallback. Done.
- Content HTML sanitizer test for scripts, event handlers, JavaScript URLs, style attributes, SVG, and named property isolation. Done.
- Cover Image scoring tests for structured data, Open Graph/oEmbed/source-specific images, and low-quality logo/avatar/sprite rejection. Done.
- Browser golden reader assertion for sandboxed Canonical Content HTML display. Done.
- Installed Chrome extension golden for real MV3 background capture, visible popup Save, manual Reload, Capture Events, and no public snapshot leakage. Done.
- Desktop/mobile visual golden for seeded ready snapshot items, reader content, Capture Events, screenshot artifacts, and no horizontal overflow. Done.
- Content Signals tests for HTML-structured summary, low-signal tag filtering, CJK text, and reading time. Done.
- Extracted Content contract tests for required fields, state invariants, confidence, URL fields, and `contentHtml` safety. Done.
- Capture Event tests for event shape, snapshot byte accounting, SQLite persistence, API exposure, and no raw snapshot text leakage. Done.
