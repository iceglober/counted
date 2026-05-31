import pg from "pg";
import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";

type MigrateOptions = {
  sourceDb?: string;
  sourceCsv?: string;
  targetKey: string;
  targetHost: string;
  since?: string;
  dryRun: boolean;
  batchSize: number;
  concurrency: number;
};

type AptabaseEvent = {
  timestamp: string;
  session_id: string;
  event_name: string;
  os_name?: string;
  os_version?: string;
  locale?: string;
  app_version?: string;
  sdk_version?: string;
  props?: Record<string, unknown>;
};

function toCountedEvent(row: AptabaseEvent) {
  return {
    timestamp: row.timestamp,
    sessionId: row.session_id,
    eventName: row.event_name,
    systemProps: {
      osName: row.os_name ?? null,
      osVersion: row.os_version ?? null,
      locale: row.locale ?? null,
      appVersion: row.app_version ?? null,
      deviceModel: null,
      sdkVersion: row.sdk_version ?? "aptabase-import",
      isDebug: false,
    },
    props: row.props ?? {},
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

async function* readFromDb(
  connectionString: string,
  since?: string,
  batchSize = 50,
): AsyncGenerator<AptabaseEvent[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();

  let offset = 0;
  const params: string[] = [];
  let whereClause = "";
  if (since) {
    whereClause = ` WHERE timestamp >= $1`;
    params.push(since);
  }

  while (true) {
    const query = `SELECT * FROM events${whereClause} ORDER BY timestamp ASC LIMIT ${batchSize} OFFSET ${offset}`;
    const result = await client.query(query, params);

    if (result.rows.length === 0) break;

    yield result.rows as AptabaseEvent[];
    offset += result.rows.length;

    if (result.rows.length < batchSize) break;
  }

  await client.end();
}

async function* readFromCsv(
  csvPath: string,
  since?: string,
  batchSize = 50,
): AsyncGenerator<AptabaseEvent[]> {
  const content = await readFile(csvPath, "utf-8");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as AptabaseEvent[];

  const batch: AptabaseEvent[] = [];

  for (const row of records) {
    if (since && row.timestamp < since) continue;

    batch.push(row);
    if (batch.length >= batchSize) {
      yield batch.splice(0);
    }
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
  const source = opts.sourceDb
    ? readFromDb(opts.sourceDb, opts.since, opts.batchSize)
    : readFromCsv(opts.sourceCsv!, opts.since, opts.batchSize);

  let totalEvents = 0;
  let totalBatches = 0;
  const pendingTasks: (() => Promise<void>)[] = [];

  for await (const batch of source) {
    const converted = batch.map(toCountedEvent);
    totalEvents += converted.length;
    totalBatches++;

    if (opts.dryRun) {
      console.log(
        `[dry-run] Batch ${totalBatches}: ${converted.length} events`,
      );
      continue;
    }

    const batchNum = totalBatches;
    const eventCount = converted.length;
    pendingTasks.push(async () => {
      await sendBatch(converted, opts.targetHost, opts.targetKey);
      console.log(
        `Batch ${batchNum}: ${eventCount} events (total: ${totalEvents})`,
      );
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
