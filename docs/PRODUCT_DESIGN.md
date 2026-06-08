# Hunter Product Design

## Product Promise

Hunter is an information-flow inbox for things worth reading later: articles, forum posts, X posts, research notes, newsletters, and any URL a user meets while browsing.

The product is not a prettier bookmarks folder. It is a calm workspace for turning saved links into understood, organized, and revisitable knowledge.

## Target User

- People who save a lot of links but rarely return to them.
- Researchers, builders, investors, writers, and product people who collect signals across many websites.
- Users who want the capture action to be instant, but the later review experience to feel curated.

## Core Workflow

1. User clicks the browser extension on a page.
2. Hunter captures URL, title, favicon, readable text, image candidates, selected text, and optional note/tags.
3. Backend stores the item immediately and recognizes content asynchronously.
4. Web client shows the item in an inbox with cover image, summary, tags, source, and read state.
5. User triages the item: read, keep unread, archive, favorite, tag, or delete.

## MVP Features

- Save current page from Chrome extension.
- Save arbitrary URL from the web app.
- Extract metadata and readable article text.
- Pick a cover from Open Graph, Twitter metadata, structured data, oEmbed thumbnails, article images, or extension-provided candidates while filtering logos, favicons, sprites, placeholders, and avatars.
- Generate summary, suggested tags, reading time, and confidence with deterministic local rules.
- Inbox, unread, read, archived, favorite filters.
- Search title, summary, tags, source, and notes.
- Detail drawer with summary, extracted excerpt, metadata, notes, and quick actions.
- Local JSON persistence for a development MVP.

## UX Direction

The interface should feel like an editorial command center:

- Dense enough for repeated use.
- Visual enough that saved content has memory and identity.
- Low-friction actions near every card.
- No marketing landing screen; the app opens directly into the library.

## Key Screens

- Library: side navigation, quick save, filters, saved content grid.
- Detail: selected item with cover, extracted summary, source metadata, actions.
- Extension popup: current page preview, tags, note, save button, API base setting.

## Product Risks

- X, Reddit, and other platforms have API and anti-scraping restrictions. Official API integration should be added per platform instead of broad scraping.
- Some pages block server-side fetches or render content only after login. The extension capture path mitigates this by sending visible page metadata and DOM-derived text.
- Summaries are derived hints, not source of truth. UI should preserve source links, excerpts, and extraction state.
