import pg from "pg";
import { readFile } from "node:fs/promises";

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
): AsyncGenerator<AptabaseEvent[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();

  let query = `SELECT * FROM events`;
  const params: string[] = [];
  if (since) {
    query += ` WHERE timestamp >= $1`;
    params.push(since);
  }
  query += ` ORDER BY timestamp ASC`;

  const cursor = client.query(new pg.Query(query, params));
  const rows: AptabaseEvent[] = [];

  for await (const row of cursor) {
    rows.push(row as unknown as AptabaseEvent);
    if (rows.length >= 50) {
      yield rows.splice(0);
    }
  }

  if (rows.length > 0) yield rows;

  await client.end();
}

async function* readFromCsv(
  csvPath: string,
  since?: string,
): AsyncGenerator<AptabaseEvent[]> {
  const content = await readFile(csvPath, "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",");

  const batch: AptabaseEvent[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h.trim()] = values[j]?.trim() ?? "";
    });

    if (since && row.timestamp < since) continue;

    batch.push(row as unknown as AptabaseEvent);
    if (batch.length >= 50) {
      yield batch.splice(0);
    }
  }

  if (batch.length > 0) yield batch;
}

export async function migrateAptabase(opts: MigrateOptions): Promise<void> {
  const source = opts.sourceDb
    ? readFromDb(opts.sourceDb, opts.since)
    : readFromCsv(opts.sourceCsv!, opts.since);

  let totalEvents = 0;
  let totalBatches = 0;

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

    await sendBatch(converted, opts.targetHost, opts.targetKey);
    console.log(
      `Batch ${totalBatches}: ${converted.length} events (total: ${totalEvents})`,
    );
  }

  console.log(
    `\n${opts.dryRun ? "[dry-run] " : ""}Migration complete: ${totalEvents} events in ${totalBatches} batches`,
  );
}
