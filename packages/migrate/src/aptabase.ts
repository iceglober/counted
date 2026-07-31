/**
 * Reading Aptabase's export, and importing it into Counted.
 *
 * This file speaks their vocabulary — `session_id`, `event_name`,
 * `string_props` — because reading their export is its entire purpose. It is
 * the second sealed boundary in the system (the first is
 * `@counted/aptabase-compat`): their names appear here and in no layer beneath.
 *
 * What changed for v2 is the *target*. The v1 importer posted their envelope
 * to `/api/v0/event` and treated any 2xx as done. It now translates to the v1
 * ingest contract, carries a deterministic idempotency key, and reads the
 * receipt — see `target.ts` for why that last part matters more than it sounds.
 */

import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import {
  emptyTally,
  exhausted,
  importKey,
  record,
  sendBatch,
  summarize,
  type CountedEvent,
  type Tally,
} from "./target";

export type MigrateOptions = {
  sourceClickhouse?: string | undefined;
  sourceCsv?: string | undefined;
  appId?: string | undefined;
  targetKey: string;
  targetHost: string;
  since?: string | undefined;
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

/**
 * One of their rows, as one of our events.
 *
 * The mapping is the same one `@counted/aptabase-compat` makes at the edge, and
 * for the same reasons: their `session_id` is a visit, not an identity; fields
 * we have no column for become properties rather than vanishing.
 *
 * The difference is the key. A live SDK mints one per `track()`; an import has
 * to derive one from the row itself, so that re-running the same export — or
 * resuming a half-finished import — stores each event once. v1 had no key and
 * called the resulting overlap "accepted".
 */
function toCountedEvent(row: AptabaseRow): CountedEvent {
  // Aptabase splits props by type; recombine them. A CSV `props` column wins if
  // present (simple exports), otherwise merge string_props + numeric_props.
  const merged =
    row.props !== undefined
      ? parseJsonObject(row.props)
      : { ...parseJsonObject(row.string_props), ...parseJsonObject(row.numeric_props) };

  const properties: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      properties[key] = value;
    }
    // A nested value is dropped rather than stringified: "[object Object]"
    // looks like data.
  }

  const systemProperties: Record<string, string | null> = {
    os_name: row.os_name || null,
    os_version: row.os_version || null,
    locale: row.locale || null,
    app_version: row.app_version || null,
    device_model: row.device_model || null,
    // Says where these came from, so an imported event is distinguishable from
    // one a live SDK sent.
    sdk_version: row.sdk_version || "aptabase-import",
  };

  const occurredAt = normalizeTimestamp(row.timestamp);

  return {
    name: row.event_name,
    // Their session id is a visit: an ephemeral activity grouping, not an
    // identity, and Counted will not treat it as one.
    visitId: row.session_id,
    occurredAt,
    idempotencyKey: importKey([row.session_id, row.event_name, occurredAt]),
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    systemProperties,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send one batch, retrying what is worth retrying.
 *
 * Every event carries a deterministic key, so a resend cannot double-count —
 * which is what makes retrying safe rather than a trade-off.
 */
async function deliver(
  events: readonly CountedEvent[],
  opts: MigrateOptions,
  tally: Tally,
  maxAttempts = 5,
): Promise<void> {
  let delay = 500;
  for (let attempt = 1; ; attempt++) {
    const outcome = await sendBatch(events, {
      endpoint: `${opts.targetHost.replace(/\/+$/, "")}/v1/events`,
      key: opts.targetKey,
    });

    if (outcome.kind === "sent") {
      record(tally, outcome.receipt);
      return;
    }
    if (outcome.kind === "refused" || attempt >= maxAttempts) {
      throw new Error(`Ingestion failed: ${outcome.detail}`);
    }
    await sleep(outcome.retryAfterMs ?? delay);
    delay *= 2;
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

    const last = rows[rows.length - 1];
    // Both, because `rows.length === 0` and "the last row is somehow absent"
    // are the same stopping condition and the second is what the index
    // signature actually promises.
    if (last === undefined) break;
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
      const task = tasks[idx];
      // The bound makes this unreachable; reading the element rather than
      // calling it blind is what makes that true rather than assumed.
      if (task === undefined) return;
      results[idx] = await task();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

export async function migrateAptabase(opts: MigrateOptions): Promise<void> {
  const source = opts.sourceClickhouse
    ? readFromClickHouse(opts.sourceClickhouse, opts.appId!, opts.since, opts.batchSize)
    : readFromCsv(opts.sourceCsv!, opts.since, opts.batchSize);

  let totalRead = 0;
  let totalBatches = 0;
  const tally = emptyTally();
  const pendingTasks: (() => Promise<void>)[] = [];

  /**
   * The highest source timestamp confirmed delivered.
   *
   * On failure it becomes a `--since` to resume from. Under v1 that overlap
   * re-sent whatever shared the boundary second and was described as "an
   * accepted, small overlap"; every event now carries a deterministic key, so
   * the overlap is stored once and the resume is exact.
   */
  let checkpoint: string | undefined = opts.since;
  const advanceCheckpoint = (events: readonly CountedEvent[]) => {
    for (const e of events) {
      if (checkpoint === undefined || e.occurredAt > checkpoint) checkpoint = e.occurredAt;
    }
  };

  try {
    for await (const batch of source) {
      const converted = batch.map(toCountedEvent);
      totalRead += converted.length;
      totalBatches++;

      if (opts.dryRun) {
        console.log(`[dry-run] Batch ${totalBatches}: ${converted.length} events`);
        continue;
      }

      const batchNum = totalBatches;
      pendingTasks.push(async () => {
        await deliver(converted, opts, tally);
        advanceCheckpoint(converted);
        console.log(
          `Batch ${batchNum}: ${tally.accepted.toLocaleString("en-US")} imported, ` +
            `${tally.deduplicated.toLocaleString("en-US")} already there` +
            (tally.rejected > 0 ? `, ${tally.rejected.toLocaleString("en-US")} refused` : ""),
        );
      });

      if (pendingTasks.length >= opts.concurrency) {
        await runWithConcurrency(pendingTasks.splice(0), opts.concurrency);
      }

      // A workspace past its allowance refuses every remaining batch. Stopping
      // and saying so beats filling the terminal with the same message.
      if (exhausted(tally)) {
        console.error("\nStopped: this workspace is past its monthly event allowance.");
        break;
      }
    }

    if (pendingTasks.length > 0) {
      await runWithConcurrency(pendingTasks, opts.concurrency);
    }
  } catch (err) {
    if (checkpoint !== undefined) {
      console.error(
        `\nMigration interrupted. Resume with:\n  --since "${checkpoint}"\n` +
          `Events carry a deterministic key, so anything already imported will not be stored twice.`,
      );
    }
    throw err;
  }

  if (opts.dryRun) {
    console.log(`\n[dry-run] Read ${totalRead.toLocaleString("en-US")} events in ${totalBatches} batches. Nothing was sent.`);
    return;
  }

  console.log(`\n${summarize(tally)}`);

  // Reported as a failure, because it is one. An import that silently loses
  // history is the thing this tool exists to avoid, and exiting 0 over a
  // refusal is how it would happen.
  if (tally.rejected > 0) {
    console.error(
      `\n${tally.rejected.toLocaleString("en-US")} ${tally.rejected === 1 ? "event was" : "events were"} ` +
        `refused and ${tally.rejected === 1 ? "is" : "are"} NOT in Counted. The reasons are listed above.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nView your imported data: ${opts.targetHost}`);
}
