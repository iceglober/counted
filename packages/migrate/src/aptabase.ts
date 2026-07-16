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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry-After is either a delay in seconds or an HTTP-date. Return ms, or null
// if unparseable so the caller falls back to its own backoff.
function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(header);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return null;
}

async function sendBatch(
  events: ReturnType<typeof toCountedEvent>[],
  targetHost: string,
  targetKey: string,
  maxAttempts = 5,
): Promise<void> {
  let delay = 500;
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${targetHost}/api/v0/event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "App-Key": targetKey,
        },
        body: JSON.stringify(events),
      });
    } catch (err) {
      // Network / DNS / connection reset — transient, retry with backoff.
      if (attempt >= maxAttempts) throw err;
      await sleep(delay);
      delay *= 2;
      continue;
    }

    if (res.ok) return;

    // 429 and 5xx are transient; honor Retry-After when present.
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      const wait = retryAfterMs(res.headers.get("retry-after")) ?? delay;
      await sleep(wait);
      delay *= 2;
      continue;
    }

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
  // Keyset (seek) pagination: order by (timestamp, session_id) and page forward
  // past the last row we saw. OFFSET pagination ordered only by timestamp skips
  // or duplicates rows that share a timestamp; the (timestamp, session_id) tie
  // break is total, so pages never overlap or gap. It also resumes for free.
  let cursor: { ts: string; session: string } | null = null;

  while (true) {
    const params: Record<string, string> = { appId };
    let where = "WHERE app_id = {appId:String}";
    if (cursor) {
      where +=
        " AND (timestamp > parseDateTimeBestEffort({cursorTs:String})" +
        " OR (timestamp = parseDateTimeBestEffort({cursorTs:String})" +
        " AND session_id > {cursorSession:String}))";
      params.cursorTs = cursor.ts;
      params.cursorSession = cursor.session;
    } else if (since) {
      where += " AND timestamp >= parseDateTimeBestEffort({since:String})";
      params.since = since;
    }

    const sql =
      `SELECT ${CH_COLUMNS} FROM events ` +
      `${where} ` +
      `ORDER BY timestamp ASC, session_id ASC LIMIT ${batchSize} FORMAT JSONEachRow`;
    const body = await clickhouseQuery(sourceUrl, sql, params);
    const rows = body
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AptabaseRow);

    if (rows.length === 0) break;
    const last = rows[rows.length - 1];
    cursor = { ts: last.timestamp, session: last.session_id };
    yield rows;
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

  // Highest source timestamp we've confirmed delivered. On failure it becomes a
  // `--since` the user can resume from (ingestion has no dedup, so a resume may
  // re-send the events sharing that exact second — an accepted, small overlap).
  let checkpoint: string | undefined = opts.since;
  const advanceCheckpoint = (events: ReturnType<typeof toCountedEvent>[]) => {
    for (const e of events) {
      if (!checkpoint || e.timestamp > checkpoint) checkpoint = e.timestamp;
    }
  };

  try {
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
        advanceCheckpoint(converted);
        console.log(`Batch ${batchNum}: ${eventCount} events (total: ${totalEvents})`);
      });

      if (pendingTasks.length >= opts.concurrency) {
        await runWithConcurrency(pendingTasks.splice(0), opts.concurrency);
      }
    }

    if (pendingTasks.length > 0) {
      await runWithConcurrency(pendingTasks, opts.concurrency);
    }
  } catch (err) {
    if (checkpoint) {
      console.error(
        `\nMigration interrupted. Resume from the last confirmed batch with:\n` +
          `  --since "${checkpoint}"`,
      );
    }
    throw err;
  }

  console.log(
    `\n${opts.dryRun ? "[dry-run] " : ""}Migration complete: ${totalEvents} events in ${totalBatches} batches`,
  );
  if (!opts.dryRun) {
    console.log(`View your imported data: ${opts.targetHost}`);
  }
}
