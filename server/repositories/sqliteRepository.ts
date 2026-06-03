import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CaptureEvent,
  ConnectorProvider,
  ConnectorRecord,
  ConnectorConnectionState,
  CreateItemInput,
  LibraryItem,
  LibraryQuery,
  LibraryStats,
  SourceType,
  UpdateItemInput
} from "../../shared/types";
import { listConnectorViews } from "../connectors";
import { normalizeRecognitionTiming } from "../recognitionTiming";
import { readItems } from "../store";
import { markRecognitionFailedItem, mergeQueuedItem, mergeRecognitionResult, patchItem } from "./itemMerges";
import { buildPage, normalizeLibraryQuery, type NormalizedLibraryQuery } from "./listQuery";
import type { ConnectorCredentialRecord, LibraryRepository, RecognitionJob, RecognitionJobStatus } from "./types";

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
  capture_method: LibraryItem["captureMethod"] | null;
  extractor: string | null;
  source_access: LibraryItem["sourceAccess"] | null;
  source_message: string | null;
  required_connector: ConnectorProvider | null;
  recognition_version: number | null;
  recognized_at: string | null;
  recognition_duration_ms: number | null;
  recognition_timing_json: string | null;
  content_hash: string | null;
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

type ConnectorRow = {
  provider: ConnectorProvider;
  connection_state: ConnectorConnectionState;
  account_label: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  updated_at: string;
};

type ConnectorCredentialRow = {
  provider: ConnectorProvider;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  token_type: string;
  scope: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  updated_at: string;
};

type CaptureEventRow = {
  id: string;
  item_id: string | null;
  source_url: string;
  canonical_url: string | null;
  source_type: SourceType | null;
  capture_method: CaptureEvent["captureMethod"];
  snapshot_bytes: number;
  result_state: CaptureEvent["resultState"];
  recognition_version: number | null;
  recognition_duration_ms: number | null;
  content_hash: string | null;
  error: string | null;
  created_at: string;
};

const dataDir = path.resolve("data");
const defaultDatabasePath = path.join(dataDir, "huntter.sqlite");

export async function createSqliteRepository(options: SqliteRepositoryOptions = {}): Promise<LibraryRepository> {
  const repository = new SqliteRepository(options.databasePath ?? process.env.HUNTTER_SQLITE_PATH ?? defaultDatabasePath);
  const shouldImportJson = options.importJson ?? process.env.HUNTTER_SQLITE_IMPORT_JSON !== "false";
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
  }

  async list(query?: LibraryQuery) {
    const normalizedQuery = normalizeLibraryQuery(query);
    const where = buildWhereClause(normalizedQuery);
    const total = (this.db.prepare(`select count(*) as count from saved_items ${where.sql}`).get(...where.params) as { count: number })
      .count;
    const rows = this.db
      .prepare(`select * from saved_items ${where.sql} order by saved_at desc limit ? offset ?`)
      .all(...where.params, normalizedQuery.limit, normalizedQuery.offset) as ItemRow[];

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
    return event;
  }

  async listCaptureEvents(limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, limit));
    const rows = this.db.prepare("select * from capture_events order by created_at desc limit ?").all(safeLimit) as CaptureEventRow[];
    return rows.map(rowToCaptureEvent);
  }

  async listConnectors() {
    const rows = this.db.prepare("select * from connectors").all() as ConnectorRow[];
    return listConnectorViews(rows.map(rowToConnector));
  }

  async upsertConnector(record: ConnectorRecord) {
    this.db
      .prepare(
        `
        insert or replace into connectors (
          provider,
          connection_state,
          account_label,
          connected_at,
          last_sync_at,
          last_error,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        record.provider,
        record.connectionState,
        record.accountLabel ?? null,
        record.connectedAt ?? null,
        record.lastSyncAt ?? null,
        record.lastError ?? null,
        record.updatedAt
      );

    return record;
  }

  async getConnectorCredential(provider: ConnectorProvider) {
    const row = this.db.prepare("select * from connector_credentials where provider = ?").get(provider) as
      | ConnectorCredentialRow
      | undefined;
    return row ? rowToConnectorCredential(row) : undefined;
  }

  async upsertConnectorCredential(record: ConnectorCredentialRecord) {
    this.db
      .prepare(
        `
        insert or replace into connector_credentials (
          provider,
          access_token_ciphertext,
          refresh_token_ciphertext,
          token_type,
          scope,
          access_token_expires_at,
          refresh_token_expires_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        record.provider,
        record.accessTokenCiphertext,
        record.refreshTokenCiphertext ?? null,
        record.tokenType,
        record.scope ?? null,
        record.accessTokenExpiresAt ?? null,
        record.refreshTokenExpiresAt ?? null,
        record.updatedAt
      );

    return record;
  }

  async deleteConnectorCredential(provider: ConnectorProvider) {
    const result = this.db.prepare("delete from connector_credentials where provider = ?").run(provider) as { changes: number };
    return result.changes > 0;
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
        capture_method text,
        extractor text,
        source_access text,
        source_message text,
        required_connector text,
        recognition_version integer,
        recognized_at text,
        recognition_duration_ms integer,
        recognition_timing_json text,
        content_hash text,
        capture_input_json text
      );

      create unique index if not exists saved_items_canonical_url_idx on saved_items (canonical_url);
      create index if not exists saved_items_status_updated_idx on saved_items (status, updated_at desc);
      create index if not exists saved_items_source_updated_idx on saved_items (source_type, updated_at desc);
      create index if not exists saved_items_favorite_updated_idx on saved_items (favorite, updated_at desc);
      create index if not exists saved_items_content_hash_idx on saved_items (content_hash);

      create virtual table if not exists saved_items_fts using fts5(
        item_id unindexed,
        title,
        summary,
        excerpt,
        readable_text,
        note,
        tags
      );

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
        capture_method text not null,
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

      create table if not exists connectors (
        provider text primary key,
        connection_state text not null,
        account_label text,
        connected_at text,
        last_sync_at text,
        last_error text,
        updated_at text not null
      );

      create table if not exists connector_credentials (
        provider text primary key,
        access_token_ciphertext text not null,
        refresh_token_ciphertext text,
        token_type text not null,
        scope text,
        access_token_expires_at text,
        refresh_token_expires_at text,
        updated_at text not null
      );
    `);
    this.ensureColumn("saved_items", "required_connector", "text");
    this.ensureColumn("saved_items", "recognition_version", "integer");
    this.ensureColumn("saved_items", "recognized_at", "text");
    this.ensureColumn("saved_items", "recognition_duration_ms", "integer");
    this.ensureColumn("saved_items", "recognition_timing_json", "text");
    this.ensureColumn("saved_items", "content_hash", "text");
    this.ensureColumn("saved_items", "capture_input_json", "text");
  }

  private ensureColumn(table: string, column: string, type: string): void {
    try {
      this.db.exec(`alter table ${table} add column ${column} ${type}`);
    } catch (error) {
      if (error instanceof Error && /duplicate column/i.test(error.message)) return;
      throw error;
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
      sources
    };
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
          capture_method,
          extractor,
          source_access,
          source_message,
          required_connector,
          recognition_version,
          recognized_at,
          recognition_duration_ms,
          recognition_timing_json,
          content_hash,
          capture_input_json
        ) values (${Array.from({ length: 37 }, () => "?").join(",")})
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
          capture_method = excluded.capture_method,
          extractor = excluded.extractor,
          source_access = excluded.source_access,
          source_message = excluded.source_message,
          required_connector = excluded.required_connector,
          recognition_version = excluded.recognition_version,
          recognized_at = excluded.recognized_at,
          recognition_duration_ms = excluded.recognition_duration_ms,
          recognition_timing_json = excluded.recognition_timing_json,
          content_hash = excluded.content_hash,
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
          note,
          tags
        ) values (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(item.id, item.title, item.summary, item.excerpt, item.readableText ?? "", item.note ?? "", item.tags.join(" "));
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
          capture_method,
          snapshot_bytes,
          result_state,
          recognition_version,
          recognition_duration_ms,
          content_hash,
          error,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        event.id,
        event.itemId ?? null,
        event.sourceUrl,
        event.canonicalUrl ?? null,
        event.sourceType ?? null,
        event.captureMethod,
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
    item.captureMethod ?? null,
    item.extractor ?? null,
    item.sourceAccess ?? null,
    item.sourceMessage ?? null,
    item.requiredConnector ?? null,
    item.recognitionVersion ?? null,
    item.recognizedAt ?? null,
    item.recognitionDurationMs ?? null,
    item.recognitionTiming ? JSON.stringify(item.recognitionTiming) : null,
    item.contentHash ?? null,
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
    captureMethod: row.capture_method ?? undefined,
    extractor: optionalString(row.extractor),
    sourceAccess: row.source_access ?? undefined,
    sourceMessage: optionalString(row.source_message),
    requiredConnector: row.required_connector ?? undefined,
    recognitionVersion: optionalNumber(row.recognition_version),
    recognizedAt: optionalString(row.recognized_at),
    recognitionDurationMs: optionalNumber(row.recognition_duration_ms),
    recognitionTiming: parseRecognitionTiming(row.recognition_timing_json),
    contentHash: optionalString(row.content_hash),
    captureInput: parseCaptureInput(row.capture_input_json)
  };
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

function buildWhereClause(query: NormalizedLibraryQuery): { sql: string; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const ftsQuery = buildFtsQuery(query.q);

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

  if (ftsQuery) {
    clauses.push("id in (select item_id from saved_items_fts where saved_items_fts match ?)");
    params.push(ftsQuery);
  }

  return {
    sql: clauses.length ? `where ${clauses.join(" and ")}` : "",
    params
  };
}

function buildFtsQuery(value: string | undefined): string | undefined {
  const tokens = value?.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8);
  if (!tokens?.length) return undefined;
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(" AND ");
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

function rowToConnector(row: ConnectorRow): ConnectorRecord {
  return {
    provider: row.provider,
    connectionState: row.connection_state,
    accountLabel: optionalString(row.account_label),
    connectedAt: optionalString(row.connected_at),
    lastSyncAt: optionalString(row.last_sync_at),
    lastError: optionalString(row.last_error),
    updatedAt: row.updated_at
  };
}

function rowToConnectorCredential(row: ConnectorCredentialRow): ConnectorCredentialRecord {
  return {
    provider: row.provider,
    accessTokenCiphertext: row.access_token_ciphertext,
    refreshTokenCiphertext: optionalString(row.refresh_token_ciphertext),
    tokenType: row.token_type,
    scope: optionalString(row.scope),
    accessTokenExpiresAt: optionalString(row.access_token_expires_at),
    refreshTokenExpiresAt: optionalString(row.refresh_token_expires_at),
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
    captureMethod: row.capture_method,
    snapshotBytes: row.snapshot_bytes,
    resultState: row.result_state,
    recognitionVersion: optionalNumber(row.recognition_version),
    recognitionDurationMs: optionalNumber(row.recognition_duration_ms),
    contentHash: optionalString(row.content_hash),
    error: optionalString(row.error),
    createdAt: row.created_at
  };
}
