import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";

type MigrateOptions = {
  sourceClickhouse?: string;
  sourceCsv?: string;
  appId?: string;
  targetKey: string;
  targetHost: string;
  since?: string;
  dryRun: boolean;
  batchSize: number;
  concurrency: number;
};

// A row as it comes off Aptabase's ClickHouse `events` table (etc/clickhouse/
// 0001-events.sql + 0004 device_model). Props are two JSON-string columns.
type AptabaseRow = {
  timestamp: string;
  session_id: string;
  event_name: string;
  os_name?: string;
  os_version?: string;
  locale?: string;
  app_version?: string;
  sdk_version?: string;
  device_model?: string;
  string_props?: string;
  numeric_props?: string;
  // CSV exports may carry a single merged props column instead.
  props?: string | Record<string, unknown>;
};

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "{}") return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

// ClickHouse DateTime over HTTP comes back as "2026-01-01 10:00:00" (UTC, no
// zone). Counted wants an ISO-8601 instant.
function normalizeTimestamp(ts: string): string {
  if (!ts) return ts;
  if (ts.includes("T")) return ts; // already ISO (CSV)
  return `${ts.replace(" ", "T")}Z`;
}

function toCountedEvent(row: AptabaseRow) {
  // Aptabase splits props by type; recombine them. A CSV `props` column wins if
  // present (simple exports), otherwise merge string_props + numeric_props.
  const props =
    row.props !== undefined
      ? parseJsonObject(row.props)
      : { ...parseJsonObject(row.string_props), ...parseJsonObject(row.numeric_props) };

  return {
    timestamp: normalizeTimestamp(row.timestamp),
    sessionId: row.session_id,
    eventName: row.event_name,
    systemProps: {
      osName: row.os_name || null,
      osVersion: row.os_version || null,
      locale: row.locale || null,
      appVersion: row.app_version || null,
      deviceModel: row.device_model || null,
      sdkVersion: row.sdk_version || "aptabase-import",
      isDebug: false,
    },
    props,
  };
}

async function sendBatch(
  events: ReturnType<typeof toCountedEvent>[],
  targetHost: string,
  targetKey: string,
): Promise<void> {
  const res = await fetch(`${targetHost}/api/v0/event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "App-Key": targetKey,
    },
    body: JSON.stringify(events),
  });

  if (!res.ok) {
    throw new Error(`Ingestion failed: ${res.status} ${res.statusText}`);
  }
}

// ─── ClickHouse source (real self-hosted Aptabase) ──────────────────────────

const CH_COLUMNS =
  "timestamp, session_id, event_name, os_name, os_version, locale, app_version, sdk_version, device_model, string_props, numeric_props";

async function clickhouseQuery(
  sourceUrl: string,
  sql: string,
  params: Record<string, string>,
): Promise<string> {
  // Split credentials out of the URL into HTTP basic auth; ClickHouse's HTTP
  // interface takes the SQL as the request body and named params as query args.
  const url = new URL(sourceUrl);
  const user = decodeURIComponent(url.username) || "default";
  const password = decodeURIComponent(url.password);
  url.username = "";
  url.password = "";
  for (const [k, v] of Object.entries(params)) url.searchParams.set(`param_${k}`, v);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Authorization: `Basic ${btoa(`${user}:${password}`)}`,
    },
    body: sql,
  });
  if (!res.ok) {
    throw new Error(`ClickHouse query failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return res.text();
}

async function* readFromClickHouse(
  sourceUrl: string,
  appId: string,
  since: string | undefined,
  batchSize: number,
): AsyncGenerator<AptabaseRow[]> {
  let offset = 0;
  const params: Record<string, string> = { appId };
  let whereSince = "";
  if (since) {
    whereSince = " AND timestamp >= parseDateTimeBestEffort({since:String})";
    params.since = since;
  }

  while (true) {
    const sql =
      `SELECT ${CH_COLUMNS} FROM events ` +
      `WHERE app_id = {appId:String}${whereSince} ` +
      `ORDER BY timestamp ASC LIMIT ${batchSize} OFFSET ${offset} FORMAT JSONEachRow`;
    const body = await clickhouseQuery(sourceUrl, sql, params);
    const rows = body
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AptabaseRow);

    if (rows.length === 0) break;
    yield rows;
    offset += rows.length;
    if (rows.length < batchSize) break;
  }
}

// ─── CSV source (exported data fallback) ────────────────────────────────────

async function* readFromCsv(
  csvPath: string,
  since: string | undefined,
  batchSize: number,
): AsyncGenerator<AptabaseRow[]> {
  const content = await readFile(csvPath, "utf-8");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as AptabaseRow[];

  const batch: AptabaseRow[] = [];
  for (const row of records) {
    if (since && row.timestamp < since) continue;
    batch.push(row);
    if (batch.length >= batchSize) yield batch.splice(0);
  }
  if (batch.length > 0) yield batch;
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let i = 0;

  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

export async function migrateAptabase(opts: MigrateOptions): Promise<void> {
  const source = opts.sourceClickhouse
    ? readFromClickHouse(opts.sourceClickhouse, opts.appId!, opts.since, opts.batchSize)
    : readFromCsv(opts.sourceCsv!, opts.since, opts.batchSize);

  let totalEvents = 0;
  let totalBatches = 0;
  const pendingTasks: (() => Promise<void>)[] = [];

  for await (const batch of source) {
    const converted = batch.map(toCountedEvent);
    totalEvents += converted.length;
    totalBatches++;

    if (opts.dryRun) {
      console.log(`[dry-run] Batch ${totalBatches}: ${converted.length} events`);
      continue;
    }

    const batchNum = totalBatches;
    const eventCount = converted.length;
    pendingTasks.push(async () => {
      await sendBatch(converted, opts.targetHost, opts.targetKey);
      console.log(`Batch ${batchNum}: ${eventCount} events (total: ${totalEvents})`);
    });

    if (pendingTasks.length >= opts.concurrency) {
      await runWithConcurrency(pendingTasks.splice(0), opts.concurrency);
    }
  }

  if (pendingTasks.length > 0) {
    await runWithConcurrency(pendingTasks, opts.concurrency);
  }

  console.log(
    `\n${opts.dryRun ? "[dry-run] " : ""}Migration complete: ${totalEvents} events in ${totalBatches} batches`,
  );
}
