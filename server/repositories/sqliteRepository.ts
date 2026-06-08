import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentClassificationResult,
  AgentContentCategorySummary,
  CaptureEvent,
  CreateItemInput,
  LibraryItem,
  LibraryQuery,
  LibraryStats,
  SourceType,
  UpdateItemInput
} from "../../shared/types";
import { resolveDataDir } from "../dataDir";
import { collectAgentContentCategories, needsAgentClassification } from "../agents/contentCategories";
import { normalizeRecognitionTiming } from "../recognitionTiming";
import { readItems } from "../store";
import { markRecognitionFailedItem, mergeQueuedItem, mergeRecognitionResult, patchItem } from "./itemMerges";
import { buildPage, normalizeLibraryQuery, type NormalizedLibraryQuery } from "./listQuery";
import type { LibraryRepository, RecognitionJob, RecognitionJobStatus } from "./types";

type SqliteRepositoryOptions = {
  databasePath?: string;
  importJson?: boolean;
};

type ItemRow = {
  id: string;
  url: string;
  canonical_url: string;
  title: string;
  source_name: string;
  source_type: LibraryItem["sourceType"];
  status: LibraryItem["status"];
  favorite: number;
  tags_json: string;
  note: string | null;
  summary: string;
  excerpt: string;
  readable_text: string | null;
  content_html: string | null;
  cover_image: string | null;
  favicon: string | null;
  author: string | null;
  published_at: string | null;
  language: string | null;
  word_count: number | null;
  saved_at: string;
  updated_at: string;
  reading_minutes: number;
  confidence: number;
  enrichment_state: LibraryItem["enrichmentState"];
  enrichment_error: string | null;
  extractor: string | null;
  source_message: string | null;
  recognition_version: number | null;
  recognized_at: string | null;
  recognition_duration_ms: number | null;
  recognition_timing_json: string | null;
  content_hash: string | null;
  agent_classification_json: string | null;
  capture_input_json: string | null;
};

type RecognitionJobRow = {
  id: string;
  item_id: string;
  input_json: string;
  saved_at: string;
  status: RecognitionJobStatus;
  attempt_count: number;
  run_after: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type CaptureEventRow = {
  id: string;
  item_id: string | null;
  source_url: string;
  canonical_url: string | null;
  source_type: SourceType | null;
  snapshot_bytes: number;
  result_state: CaptureEvent["resultState"];
  recognition_version: number | null;
  recognition_duration_ms: number | null;
  content_hash: string | null;
  error: string | null;
  created_at: string;
};

const defaultDatabasePath = path.join(resolveDataDir(), "hunter.sqlite");
const captureEventRetentionLimit = 1000;

export async function createSqliteRepository(options: SqliteRepositoryOptions = {}): Promise<LibraryRepository> {
  const repository = new SqliteRepository(options.databasePath ?? process.env.HUNTER_SQLITE_PATH ?? defaultDatabasePath);
  const shouldImportJson = options.importJson ?? process.env.HUNTER_SQLITE_IMPORT_JSON !== "false";
  if (shouldImportJson) {
    await repository.importJsonIfEmpty();
  }
  return repository;
}

export class SqliteRepository implements LibraryRepository {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
    `);
    this.ensureSchema();
    this.migrateLegacySchema();
  }

  async list(query?: LibraryQuery) {
    const normalizedQuery = normalizeLibraryQuery(query);
    const search = buildSearchQuery(normalizedQuery.q);
    const from = buildListFrom(search);
    const where = buildWhereClause(normalizedQuery, search);
    const total = (
      this.db
        .prepare(`${from.withSql} select count(*) as count from saved_items ${from.joinSql} ${where.sql}`)
        .get(...from.params, ...where.params) as {
        count: number;
      }
    ).count;
    const rows = this.db
      .prepare(
        `${from.withSql} select saved_items.* from saved_items ${from.joinSql} ${where.sql} ${buildOrderBy(search)} limit ? offset ?`
      )
      .all(...from.params, ...where.params, normalizedQuery.limit, normalizedQuery.offset) as ItemRow[];

    return {
      items: rows.map(rowToItem),
      stats: this.getStats(),
      page: buildPage(normalizedQuery, total)
    };
  }

  async findById(id: string) {
    const row = this.db.prepare("select * from saved_items where id = ?").get(id) as ItemRow | undefined;
    return row ? rowToItem(row) : undefined;
  }

  async listAgentCategories() {
    return this.getAgentCategories();
  }

  async listAgentClassificationCandidates(limit: number) {
    const rows = this.db
      .prepare("select * from saved_items where enrichment_state in ('ready', 'partial') order by saved_at desc")
      .all() as ItemRow[];
    return rows
      .map(rowToItem)
      .filter(needsAgentClassification)
      .slice(0, Math.max(0, Math.trunc(limit)));
  }

  async upsertQueued(item: LibraryItem, input: CreateItemInput) {
    return this.transaction(() => {
      const existing = this.findByCanonicalUrlOrUrl(item.canonicalUrl, input.url);
      const queued = existing ? mergeQueuedItem(existing, item, input) : item;
      this.putItem(queued);
      return queued;
    });
  }

  async patch(id: string, input: UpdateItemInput) {
    return this.transaction(() => {
      const previous = this.findItemById(id);
      if (!previous) return undefined;

      const updated = patchItem(previous, input);
      this.putItem(updated);
      return updated;
    });
  }

  async setAgentClassification(id: string, result: AgentClassificationResult) {
    return this.transaction(() => {
      const previous = this.findItemById(id);
      if (!previous) return undefined;

      const updated = {
        ...previous,
        agentClassification: result,
        updatedAt: new Date().toISOString()
      };
      this.putItem(updated);
      return updated;
    });
  }

  async delete(id: string) {
    return this.transaction(() => {
      this.db.prepare("delete from saved_items_fts where item_id = ?").run(id);
      const result = this.db.prepare("delete from saved_items where id = ?").run(id) as { changes: number };
      return result.changes > 0;
    });
  }

  async replaceRecognitionResult(id: string, enriched: LibraryItem, input: Pick<CreateItemInput, "note" | "tags">) {
    return this.transaction(() => {
      const previous = this.findItemById(id);
      if (!previous) return undefined;

      const updated = mergeRecognitionResult(previous, enriched, input);
      this.putItem(updated);
      return updated;
    });
  }

  async markRecognitionFailed(id: string, error: unknown) {
    this.transaction(() => {
      const previous = this.findItemById(id);
      if (!previous) return undefined;

      this.putItem(markRecognitionFailedItem(previous, error));
      return undefined;
    });
  }

  async enqueueRecognitionJob(job: RecognitionJob) {
    return this.transaction(() => {
      this.db.prepare("delete from recognition_jobs where item_id = ? or id = ?").run(job.itemId, job.id);
      this.putRecognitionJob(job);
      return job;
    });
  }

  async claimRecognitionJobs(limit: number) {
    return this.transaction(() => {
      const now = new Date();
      const staleRunningBefore = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
      const rows = this.db
        .prepare(
          `
          select *
          from recognition_jobs
          where
            ((status in ('queued', 'failed') and run_after <= ?)
            or (status = 'running' and updated_at <= ?))
          order by run_after asc, created_at asc
          limit ?
          `
        )
        .all(now.toISOString(), staleRunningBefore, limit) as RecognitionJobRow[];
      const claimed = rows.map(rowToRecognitionJob);

      for (const job of claimed) {
        this.db
          .prepare("update recognition_jobs set status = 'running', attempt_count = attempt_count + 1, updated_at = ? where id = ?")
          .run(now.toISOString(), job.id);
        job.status = "running";
        job.attemptCount += 1;
        job.updatedAt = now.toISOString();
      }

      return claimed;
    });
  }

  async completeRecognitionJob(id: string) {
    this.db.prepare("delete from recognition_jobs where id = ?").run(id);
  }

  async failRecognitionJob(id: string, error: unknown, runAfter: string) {
    this.db
      .prepare("update recognition_jobs set status = 'failed', last_error = ?, run_after = ?, updated_at = ? where id = ?")
      .run(error instanceof Error ? error.message : "Unknown recognition job error", runAfter, new Date().toISOString(), id);
  }

  async recordCaptureEvent(event: CaptureEvent) {
    this.putCaptureEvent(event);
    this.trimCaptureEvents();
    return event;
  }

  async listCaptureEvents(limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, limit));
    const rows = this.db.prepare("select * from capture_events order by created_at desc limit ?").all(safeLimit) as CaptureEventRow[];
    return rows.map(rowToCaptureEvent);
  }

  close(): void {
    this.db.close();
  }

  async importJsonIfEmpty(): Promise<void> {
    const row = this.db.prepare("select count(*) as count from saved_items").get() as { count: number };
    if (row.count > 0) return;

    const items = await readItems();
    this.transaction(() => {
      for (const item of items) {
        this.putItem(item);
      }
      return undefined;
    });
  }

  private ensureSchema(): void {
    this.db.exec(`
      create table if not exists saved_items (
        id text primary key,
        url text not null,
        canonical_url text not null,
        title text not null,
        source_name text not null,
        source_type text not null,
        status text not null,
        favorite integer not null default 0,
        tags_json text not null default '[]',
        note text,
        summary text not null,
        excerpt text not null,
        readable_text text,
        content_html text,
        cover_image text,
        favicon text,
        author text,
        published_at text,
        language text,
        word_count integer,
        saved_at text not null,
        updated_at text not null,
        reading_minutes integer not null default 1,
        confidence real not null default 0,
        enrichment_state text not null,
        enrichment_error text,
        extractor text,
        source_message text,
        recognition_version integer,
        recognized_at text,
        recognition_duration_ms integer,
        recognition_timing_json text,
        content_hash text,
        agent_classification_json text,
        capture_input_json text
      );

      create unique index if not exists saved_items_canonical_url_idx on saved_items (canonical_url);
      create index if not exists saved_items_status_updated_idx on saved_items (status, updated_at desc);
      create index if not exists saved_items_source_updated_idx on saved_items (source_type, updated_at desc);
      create index if not exists saved_items_favorite_updated_idx on saved_items (favorite, updated_at desc);
      create index if not exists saved_items_content_hash_idx on saved_items (content_hash);

      create table if not exists recognition_jobs (
        id text primary key,
        item_id text not null,
        input_json text not null,
        saved_at text not null,
        status text not null,
        attempt_count integer not null default 0,
        run_after text not null,
        last_error text,
        created_at text not null,
        updated_at text not null
      );

      create unique index if not exists recognition_jobs_item_idx on recognition_jobs (item_id);
      create index if not exists recognition_jobs_due_idx on recognition_jobs (status, run_after, updated_at);

      create table if not exists capture_events (
        id text primary key,
        item_id text references saved_items(id) on delete set null,
        source_url text not null,
        canonical_url text,
        source_type text,
        snapshot_bytes integer not null default 0,
        result_state text not null,
        recognition_version integer,
        recognition_duration_ms integer,
        content_hash text,
        error text,
        created_at text not null
      );

      create index if not exists capture_events_created_idx on capture_events (created_at desc);
      create index if not exists capture_events_item_idx on capture_events (item_id, created_at desc);
    `);
    this.createFtsTable();
  }

  private migrateLegacySchema(): void {
    const itemColumns = this.columnNames("saved_items");
    if (itemColumns.has("required_connector")) this.dropColumn("saved_items", "required_connector");
    if (itemColumns.has("capture_method")) this.dropColumn("saved_items", "capture_method");
    if (itemColumns.has("source_access")) this.dropColumn("saved_items", "source_access");
    if (!itemColumns.has("agent_classification_json")) {
      this.db.exec("alter table saved_items add column agent_classification_json text");
    }

    const captureEventColumns = this.columnNames("capture_events");
    if (captureEventColumns.has("capture_method")) this.dropColumn("capture_events", "capture_method");

    this.db.exec(`update saved_items set enrichment_state = 'failed' where enrichment_state = 'needs_connector'`);
    this.db.exec(`update capture_events set result_state = 'failed' where result_state = 'needs_connector'`);

    this.db.exec("drop table if exists connector_credentials");
    this.db.exec("drop table if exists connectors");
    this.migrateFtsSchema();
  }

  private createFtsTable(): void {
    this.db.exec(`
      create virtual table if not exists saved_items_fts using fts5(
        item_id unindexed,
        title,
        summary,
        excerpt,
        readable_text,
        source_name,
        author,
        url,
        canonical_url,
        note,
        tags
      );
    `);
  }

  private migrateFtsSchema(): void {
    const expectedColumns = new Set([
      "item_id",
      "title",
      "summary",
      "excerpt",
      "readable_text",
      "source_name",
      "author",
      "url",
      "canonical_url",
      "note",
      "tags"
    ]);
    const columns = this.columnNames("saved_items_fts");
    if ([...expectedColumns].every((column) => columns.has(column))) {
      return;
    }

    this.db.exec("drop table if exists saved_items_fts");
    this.createFtsTable();
    this.rebuildFtsIndex();
  }

  private rebuildFtsIndex(): void {
    const rows = this.db.prepare("select * from saved_items").all() as ItemRow[];
    for (const row of rows) {
      this.replaceFts(rowToItem(row));
    }
  }

  private columnNames(table: string): Set<string> {
    const rows = this.db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
  }

  private dropColumn(table: string, column: string): void {
    try {
      this.db.exec(`alter table ${table} drop column ${column}`);
    } catch (error) {
      // node:sqlite ships SQLite >= 3.45 which supports DROP COLUMN; tolerate older builds by leaving the column in place.
      if (!(error instanceof Error && /near "drop"/i.test(error.message))) throw error;
    }
  }

  private findItemById(id: string): LibraryItem | undefined {
    const row = this.db.prepare("select * from saved_items where id = ?").get(id) as ItemRow | undefined;
    return row ? rowToItem(row) : undefined;
  }

  private findByCanonicalUrlOrUrl(canonicalUrl: string, url: string): LibraryItem | undefined {
    const row = this.db
      .prepare("select * from saved_items where canonical_url = ? or url = ? order by saved_at desc limit 1")
      .get(canonicalUrl, url) as ItemRow | undefined;
    return row ? rowToItem(row) : undefined;
  }

  private getStats(): LibraryStats {
    const count = (where: string) =>
      (this.db.prepare(`select count(*) as count from saved_items ${where}`).get() as { count: number }).count;
    const sources = emptySourceCounts();
    const sourceRows = this.db.prepare("select source_type, count(*) as count from saved_items group by source_type").all() as Array<{
      source_type: SourceType;
      count: number;
    }>;

    for (const row of sourceRows) {
      sources[row.source_type] = row.count;
    }

    return {
      total: count(""),
      unread: count("where status = 'unread'"),
      reading: count("where status = 'reading'"),
      read: count("where status = 'read'"),
      archived: count("where status = 'archived'"),
      favorite: count("where favorite = 1"),
      sources,
      agentCategories: this.getAgentCategories()
    };
  }

  private getAgentCategories(): AgentContentCategorySummary[] {
    const rows = this.db
      .prepare("select agent_classification_json from saved_items where agent_classification_json is not null")
      .all() as Array<{
      agent_classification_json: string | null;
    }>;
    return collectAgentContentCategories(
      rows.map((row) => ({ agentClassification: parseAgentClassification(row.agent_classification_json) }))
    );
  }

  private putItem(item: LibraryItem): void {
    this.db
      .prepare(
        `
        insert into saved_items (
          id,
          url,
          canonical_url,
          title,
          source_name,
          source_type,
          status,
          favorite,
          tags_json,
          note,
          summary,
          excerpt,
          readable_text,
          content_html,
          cover_image,
          favicon,
          author,
          published_at,
          language,
          word_count,
          saved_at,
          updated_at,
          reading_minutes,
          confidence,
          enrichment_state,
          enrichment_error,
          extractor,
          source_message,
          recognition_version,
          recognized_at,
          recognition_duration_ms,
          recognition_timing_json,
          content_hash,
          agent_classification_json,
          capture_input_json
        ) values (${Array.from({ length: 35 }, () => "?").join(",")})
        on conflict(id) do update set
          url = excluded.url,
          canonical_url = excluded.canonical_url,
          title = excluded.title,
          source_name = excluded.source_name,
          source_type = excluded.source_type,
          status = excluded.status,
          favorite = excluded.favorite,
          tags_json = excluded.tags_json,
          note = excluded.note,
          summary = excluded.summary,
          excerpt = excluded.excerpt,
          readable_text = excluded.readable_text,
          content_html = excluded.content_html,
          cover_image = excluded.cover_image,
          favicon = excluded.favicon,
          author = excluded.author,
          published_at = excluded.published_at,
          language = excluded.language,
          word_count = excluded.word_count,
          saved_at = excluded.saved_at,
          updated_at = excluded.updated_at,
          reading_minutes = excluded.reading_minutes,
          confidence = excluded.confidence,
          enrichment_state = excluded.enrichment_state,
          enrichment_error = excluded.enrichment_error,
          extractor = excluded.extractor,
          source_message = excluded.source_message,
          recognition_version = excluded.recognition_version,
          recognized_at = excluded.recognized_at,
          recognition_duration_ms = excluded.recognition_duration_ms,
          recognition_timing_json = excluded.recognition_timing_json,
          content_hash = excluded.content_hash,
          agent_classification_json = excluded.agent_classification_json,
          capture_input_json = excluded.capture_input_json
        `
      )
      .run(...itemToParams(item));

    this.replaceFts(item);
  }

  private replaceFts(item: LibraryItem): void {
    this.db.prepare("delete from saved_items_fts where item_id = ?").run(item.id);
    this.db
      .prepare(
        `
        insert into saved_items_fts (
          item_id,
          title,
          summary,
          excerpt,
          readable_text,
          source_name,
          author,
          url,
          canonical_url,
          note,
          tags
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        item.id,
        item.title,
        item.summary,
        item.excerpt,
        item.readableText ?? "",
        item.sourceName,
        item.author ?? "",
        item.url,
        item.canonicalUrl,
        item.note ?? "",
        item.tags.join(" ")
      );
  }

  private putRecognitionJob(job: RecognitionJob): void {
    this.db
      .prepare(
        `
        insert or replace into recognition_jobs (
          id,
          item_id,
          input_json,
          saved_at,
          status,
          attempt_count,
          run_after,
          last_error,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        job.id,
        job.itemId,
        JSON.stringify(job.input),
        job.savedAt,
        job.status,
        job.attemptCount,
        job.runAfter,
        job.lastError ?? null,
        job.createdAt,
        job.updatedAt
      );
  }

  // Keep capture-event retention aligned with the JSON adapter so diagnostics
  // do not grow unbounded on long-running SQLite installs.
  private trimCaptureEvents(): void {
    this.db
      .prepare(
        `delete from capture_events where id in (
           select id from capture_events order by created_at desc, id desc limit -1 offset ?
         )`
      )
      .run(captureEventRetentionLimit);
  }

  private putCaptureEvent(event: CaptureEvent): void {
    this.db
      .prepare(
        `
        insert into capture_events (
          id,
          item_id,
          source_url,
          canonical_url,
          source_type,
          snapshot_bytes,
          result_state,
          recognition_version,
          recognition_duration_ms,
          content_hash,
          error,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        event.id,
        event.itemId ?? null,
        event.sourceUrl,
        event.canonicalUrl ?? null,
        event.sourceType ?? null,
        event.snapshotBytes,
        event.resultState,
        event.recognitionVersion ?? null,
        event.recognitionDurationMs ?? null,
        event.contentHash ?? null,
        event.error ?? null,
        event.createdAt
      );
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("begin immediate");
    try {
      const result = operation();
      this.db.exec("commit");
      return result;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }
}

function itemToParams(item: LibraryItem): Array<string | number | null> {
  return [
    item.id,
    item.url,
    item.canonicalUrl,
    item.title,
    item.sourceName,
    item.sourceType,
    item.status,
    item.favorite ? 1 : 0,
    JSON.stringify(item.tags),
    item.note ?? null,
    item.summary,
    item.excerpt,
    item.readableText ?? null,
    item.contentHtml ?? null,
    item.coverImage ?? null,
    item.favicon ?? null,
    item.author ?? null,
    item.publishedAt ?? null,
    item.language ?? null,
    item.wordCount ?? null,
    item.savedAt,
    item.updatedAt,
    item.readingMinutes,
    item.confidence,
    item.enrichmentState,
    item.enrichmentError ?? null,
    item.extractor ?? null,
    item.sourceMessage ?? null,
    item.recognitionVersion ?? null,
    item.recognizedAt ?? null,
    item.recognitionDurationMs ?? null,
    item.recognitionTiming ? JSON.stringify(item.recognitionTiming) : null,
    item.contentHash ?? null,
    item.agentClassification ? JSON.stringify(item.agentClassification) : null,
    item.captureInput ? JSON.stringify(item.captureInput) : null
  ];
}

function rowToItem(row: ItemRow): LibraryItem {
  return {
    id: row.id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    sourceName: row.source_name,
    sourceType: row.source_type,
    status: row.status,
    favorite: Boolean(row.favorite),
    tags: parseTags(row.tags_json),
    note: optionalString(row.note),
    summary: row.summary,
    excerpt: row.excerpt,
    readableText: optionalString(row.readable_text),
    contentHtml: optionalString(row.content_html),
    coverImage: optionalString(row.cover_image),
    favicon: optionalString(row.favicon),
    author: optionalString(row.author),
    publishedAt: optionalString(row.published_at),
    language: optionalString(row.language),
    wordCount: optionalNumber(row.word_count),
    savedAt: row.saved_at,
    updatedAt: row.updated_at,
    readingMinutes: row.reading_minutes,
    confidence: row.confidence,
    enrichmentState: row.enrichment_state,
    enrichmentError: optionalString(row.enrichment_error),
    extractor: optionalString(row.extractor),
    sourceMessage: optionalString(row.source_message),
    recognitionVersion: optionalNumber(row.recognition_version),
    recognizedAt: optionalString(row.recognized_at),
    recognitionDurationMs: optionalNumber(row.recognition_duration_ms),
    recognitionTiming: parseRecognitionTiming(row.recognition_timing_json),
    contentHash: optionalString(row.content_hash),
    agentClassification: parseAgentClassification(row.agent_classification_json),
    captureInput: parseCaptureInput(row.capture_input_json)
  };
}

function parseAgentClassification(value: string | null): LibraryItem["agentClassification"] {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as LibraryItem["agentClassification"];
  } catch {
    return undefined;
  }
}

function parseRecognitionTiming(value: string | null): LibraryItem["recognitionTiming"] {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<NonNullable<LibraryItem["recognitionTiming"]>>;
    return normalizeRecognitionTiming(parsed);
  } catch {
    return undefined;
  }
}

function parseCaptureInput(value: string | null): LibraryItem["captureInput"] {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as LibraryItem["captureInput"];
  } catch {
    return undefined;
  }
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function optionalString(value: string | null): string | undefined {
  return value ?? undefined;
}

function optionalNumber(value: number | null): number | undefined {
  return value ?? undefined;
}

type SearchQuery = {
  ftsQuery: string;
  likePattern?: string;
};

function buildListFrom(search: SearchQuery | undefined): { withSql: string; joinSql: string; params: string[] } {
  if (!search) {
    return { withSql: "", joinSql: "", params: [] };
  }

  return {
    withSql: `
      with fts_matches as (
        select item_id, bm25(saved_items_fts, 0.0, 8.0, 4.0, 3.0, 1.0, 5.0, 5.0, 2.0, 2.0, 3.0, 4.0) as rank
        from saved_items_fts
        where saved_items_fts match ?
      )
    `,
    joinSql: "left join fts_matches on fts_matches.item_id = saved_items.id",
    params: [search.ftsQuery]
  };
}

function buildWhereClause(query: NormalizedLibraryQuery, search: SearchQuery | undefined): { sql: string; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (query.filter === "favorite") {
    clauses.push("favorite = 1");
  } else if (query.filter) {
    clauses.push("status = ?");
    params.push(query.filter);
  }

  if (query.sourceType) {
    clauses.push("source_type = ?");
    params.push(query.sourceType);
  }

  if (query.agentCategoryId) {
    clauses.push(
      `(json_valid(agent_classification_json) and (json_extract(agent_classification_json, '$.classification.contentCategory.id') = ? or 'legacy-' || json_extract(agent_classification_json, '$.classification.primaryCategory') = ?))`
    );
    params.push(query.agentCategoryId, query.agentCategoryId);
  }

  if (search) {
    const searchClauses = ["fts_matches.item_id is not null"];
    if (search.likePattern) {
      const likeColumns = [
        "title",
        "summary",
        "excerpt",
        "readable_text",
        "source_name",
        "author",
        "url",
        "canonical_url",
        "note",
        "tags_json",
        "agent_classification_json"
      ];
      searchClauses.push(...likeColumns.map((column) => `${column} like ? escape '\\'`));
      params.push(...likeColumns.map(() => search.likePattern!));
    }
    clauses.push(`(${searchClauses.join(" or ")})`);
  }

  return {
    sql: clauses.length ? `where ${clauses.join(" and ")}` : "",
    params
  };
}

function buildOrderBy(search: SearchQuery | undefined): string {
  if (!search) {
    return "order by saved_items.saved_at desc";
  }

  return "order by case when fts_matches.item_id is null then 1 else 0 end, fts_matches.rank, saved_items.saved_at desc";
}

function buildSearchQuery(value: string | undefined): SearchQuery | undefined {
  const tokens = value?.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8);
  if (!tokens?.length) return undefined;
  return {
    ftsQuery: tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(" AND "),
    likePattern: shouldUseLikeFallback(value, tokens) ? `%${escapeLikePattern(value ?? "")}%` : undefined
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function shouldUseLikeFallback(value: string | undefined, tokens: string[]): boolean {
  const normalized = value?.trim() ?? "";
  return hasNonAsciiCharacter(normalized) || (tokens.length === 1 && normalized.length >= 4);
}

function hasNonAsciiCharacter(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) > 127);
}

function emptySourceCounts(): Record<SourceType, number> {
  return {
    article: 0,
    post: 0,
    tweet: 0,
    feishu: 0,
    video: 0,
    pdf: 0,
    other: 0
  };
}

function rowToRecognitionJob(row: RecognitionJobRow): RecognitionJob {
  return {
    id: row.id,
    itemId: row.item_id,
    input: JSON.parse(row.input_json) as CreateItemInput,
    savedAt: row.saved_at,
    status: row.status,
    attemptCount: row.attempt_count,
    runAfter: row.run_after,
    lastError: optionalString(row.last_error),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToCaptureEvent(row: CaptureEventRow): CaptureEvent {
  return {
    id: row.id,
    itemId: optionalString(row.item_id),
    sourceUrl: row.source_url,
    canonicalUrl: optionalString(row.canonical_url),
    sourceType: row.source_type ?? undefined,
    snapshotBytes: row.snapshot_bytes,
    resultState: row.result_state,
    recognitionVersion: optionalNumber(row.recognition_version),
    recognitionDurationMs: optionalNumber(row.recognition_duration_ms),
    contentHash: optionalString(row.content_hash),
    error: optionalString(row.error),
    createdAt: row.created_at
  };
}
