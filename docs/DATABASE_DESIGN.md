# Database Design

## Current State

The app now has a Repository interface with two adapters:

- JSON adapter: default local development path, backed by `data/huntter-store.json`.
- SQLite adapter: opt-in with `HUNTTER_REPOSITORY=sqlite`, backed by `node:sqlite`.

The product database should support:

- Fast inbox filtering.
- URL/canonical URL dedupe.
- Full-text search over title, summary, excerpt, readable text, notes, and tags.
- Source-specific metadata and future connectors.
- Reprocessing content without losing user workflow state.
- Comparing recognition output across parser versions.
- Sync and background jobs.

## Recommended Production Shape

Use SQLite for a local-first desktop build and Postgres for hosted/team builds. The application now talks through a Repository interface so storage adapters can share the same domain behavior.

## Core Tables

```sql
create table saved_items (
  id text primary key,
  url text not null,
  canonical_url text not null,
  title text not null,
  source_name text not null,
  source_type text not null,
  status text not null default 'unread',
  favorite boolean not null default false,
  note text,
  summary text not null,
  excerpt text not null,
  readable_text text,
  content_html text,
  cover_image text,
  favicon text,
  author text,
  published_at timestamptz,
  language text,
  word_count integer,
  reading_minutes integer not null default 1,
  confidence real not null default 0,
  enrichment_state text not null,
  enrichment_error text,
  capture_method text,
  extractor text,
  source_access text,
  source_message text,
  required_connector text,
  recognition_version integer,
  recognized_at timestamptz,
  recognition_duration_ms integer,
  recognition_timing_json text,
  content_hash text,
  capture_input_json text,
  saved_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index saved_items_canonical_url_idx on saved_items (canonical_url);
create index saved_items_status_updated_idx on saved_items (status, updated_at desc);
create index saved_items_source_updated_idx on saved_items (source_type, updated_at desc);
create index saved_items_favorite_updated_idx on saved_items (favorite, updated_at desc);
create index saved_items_content_hash_idx on saved_items (content_hash);
```

The current SQLite adapter stores tags as JSON on `saved_items` and maintains an FTS table. Normalized tag tables remain the production target once server-side tag management and analytics are introduced.

`capture_input_json` stores a normalized and size-bounded copy of the original URL/snapshot for refresh and future parser upgrades. Recognition job payloads use the same capture budget while preserving user note/tags for merge semantics. This is internal storage data, not part of public item responses.

`canonical_url` is not just the raw URL without a fragment. The recognition layer strips known tracking parameters and sorts remaining meaningful parameters before storage, so duplicate captures from campaigns merge into one Saved Item while distinct query-addressed resources remain separate.

```sql
create table tags (
  id text primary key,
  name text not null unique,
  created_at timestamptz not null
);

create table saved_item_tags (
  item_id text not null references saved_items(id) on delete cascade,
  tag_id text not null references tags(id) on delete cascade,
  primary key (item_id, tag_id)
);
```

```sql
create table capture_events (
  id text primary key,
  item_id text references saved_items(id) on delete set null,
  source_url text not null,
  canonical_url text,
  source_type text,
  capture_method text not null,
  snapshot_bytes integer not null default 0,
  result_state text not null,
  recognition_version integer,
  recognition_duration_ms integer,
  content_hash text,
  error text,
  created_at timestamptz not null
);

create index capture_events_created_idx on capture_events (created_at desc);
create index capture_events_item_idx on capture_events (item_id, created_at desc);
```

SQLite Saved Item writes must use `insert ... on conflict(id) do update` instead of `insert or replace`. SQLite implements replace as delete-then-insert, which breaks `capture_events.item_id` foreign-key history by triggering `on delete set null` during ordinary recognition updates.

```sql
create table recognition_jobs (
  id text primary key,
  item_id text not null references saved_items(id) on delete cascade,
  input_json text not null,
  saved_at timestamptz not null,
  status text not null,
  attempt_count integer not null default 0,
  last_error text,
  run_after timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index recognition_jobs_due_idx on recognition_jobs (status, run_after);
```

```sql
create table connectors (
  provider text primary key,
  connection_state text not null,
  account_label text,
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  updated_at timestamptz not null
);
```

```sql
create table connector_credentials (
  provider text primary key,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  token_type text not null,
  scope text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  updated_at timestamptz not null
);
```

Connector definitions live in application code so planned providers can appear in the UI before OAuth is implemented. The `connectors` table stores only mutable public connection state. The `connector_credentials` table stores encrypted token material and is never returned by public API responses. API mutations update or clear local connector state; disconnect also deletes stored credentials. Connector sync requests remain explicit `409` or `501` failures until provider-specific import handlers exist.

## Search

SQLite:

```sql
create virtual table saved_items_fts using fts5(
  title,
  summary,
  excerpt,
  readable_text,
  note,
  tags,
  content='saved_items',
  content_rowid='rowid'
);
```

Postgres:

```sql
alter table saved_items
add column search_vector tsvector generated always as (
  setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(excerpt, '')), 'C') ||
  setweight(to_tsvector('simple', coalesce(readable_text, '')), 'D') ||
  setweight(to_tsvector('simple', coalesce(note, '')), 'D')
) stored;

create index saved_items_search_idx on saved_items using gin (search_vector);
```

## Repository Interface

The API should not depend on JSON file layout. The Repository interface should own:

- Listing items and stats.
- Finding by ID or canonical URL.
- Upserting queued items.
- Replacing recognition output while preserving user workflow state.
- Storing original capture input for deterministic refresh without returning large snapshots from public API responses.
- Listing and updating connector connection state.
- Storing, reading, and deleting encrypted connector credentials behind server-only methods.
- Tracking recognition version, recognized timestamp, and content hash.
- Recording and listing Capture Events for capture and recognition diagnostics without storing raw snapshot bodies in the event stream.
- Patching status, favorite, tags, and note.
- Deleting items.

The current JSON implementation can remain as one Adapter. SQLite/Postgres become later Adapters behind the same interface.

## Migration Plan

1. Introduce a Repository interface while keeping JSON persistence. Done in `server/repository.ts`.
2. Move merge, patch, and delete semantics out of HTTP handlers into the Repository. Done.
3. Add SQLite adapter and a one-shot JSON import. Done.
4. Add FTS search table. Done for SQLite maintenance.
5. Add server-side search and pagination. Done through `GET /api/items`.
6. Move background recognition into a durable job table. Done for JSON and SQLite adapters.
7. Add connector state storage and API definitions. Done for JSON and SQLite adapters.
8. Add recognition metadata columns, recognition duration, phase timing JSON, and content hash index. Done for SQLite adapter.
9. Add encrypted connector credential storage. Done for JSON and SQLite adapters.
10. Normalize canonical URLs by stripping tracking parameters before dedupe. Done for JSON and SQLite adapters through shared recognition code.
11. Store original capture input for refresh/reprocessing while stripping it from public API responses. Done for JSON and SQLite adapters.
12. Add Capture Events for queued captures, recognition completion, manual refresh, and recognition failure. Done for JSON and SQLite adapters.
13. Implement Feishu OAuth authorization against connector credentials. Done for authorization, token storage, direct docx import, and wiki-node-to-docx import; token refresh and block-level fidelity remain next.
