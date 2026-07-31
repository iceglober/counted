/**
 * What this store can do, and whether it can be trusted to bucket.
 *
 * Two things happen at boot, both of which v1 lacked.
 *
 * **The store is probed, not assumed.** v1 assumed TimescaleDB. On a plain
 * Postgres host, `CREATE EXTENSION timescaledb` failed, so migration 0004 was
 * never journalled and replayed its failure on *every* boot — while every
 * timeseries query threw `function time_bucket does not exist` at runtime.
 * The server started happily and users saw empty charts. A missing capability
 * should be a logged fact at startup, not a runtime surprise.
 *
 * **The bucket contract is verified against the live database.** The domain
 * computes bucket edges and the store assigns rows to them; if those two ever
 * disagree, every chart is subtly wrong in a way no error surfaces. So we ask
 * Postgres to bucket a set of awkward instants and compare its answers with
 * `TimeAxis.assign`. A mismatch refuses the boot.
 *
 * That check is cheap — one statement, no tables — and it catches real
 * failure modes: a driver serialising timestamps in local time, a session
 * TimeZone that is not UTC, or a Postgres whose `width_bucket` over an array
 * behaves differently from the one this was written against.
 */

import type { Pool } from "pg";
import { Instant, TimeAxis, Window, type Grain } from "@counted/domain";
import type { StoreCapabilities } from "@counted/ports";

export type Probe = StoreCapabilities & {
  readonly serverVersion: string;
  readonly timescale: boolean;
  readonly timeZone: string;
};

/** Ask the database what it is and what extensions it has. */
export const probeCapabilities = async (pool: Pool): Promise<Probe> => {
  const version = (await pool.query(`SHOW server_version`)).rows[0]?.server_version ?? "unknown";
  const timeZone = (await pool.query(`SHOW TimeZone`)).rows[0]?.TimeZone ?? "unknown";

  const extensions = (await pool.query(`SELECT extname FROM pg_extension`)).rows.map((r) =>
    String(r.extname),
  );
  const timescale = extensions.includes("timescaledb");
  const hll = extensions.includes("hll");

  // Is `events` a declaratively partitioned table, a hypertable, or neither?
  const partitioned = (
    await pool.query(
      `SELECT c.relkind FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = 'events' AND n.nspname = current_schema()`,
    )
  ).rows[0]?.relkind;

  const partitioning: StoreCapabilities["partitioning"] =
    partitioned === "p" ? "declarative" : timescale ? "hypertable" : "none";

  return {
    engine: `postgres ${String(version)}`,
    approximateDistinct: hll,
    partitioning,
    serverVersion: String(version),
    timescale,
    timeZone: String(timeZone),
  };
};

export type BucketMismatch = {
  readonly grain: Grain;
  readonly instant: string;
  readonly domainSays: number | null;
  readonly storeSays: number | null;
};

export type ContractCheck =
  | { readonly ok: true; readonly checked: number }
  | { readonly ok: false; readonly mismatches: readonly BucketMismatch[]; readonly checked: number };

const iso = (s: string) => Instant.fromEpochMillis(Date.parse(s));

/**
 * Instants chosen because they are where bucketing goes wrong: exact
 * boundaries, the last millisecond before one, a leap day, a month end, and
 * two inside a DST transition in populous zones. All UTC — the point is that a
 * local-time interpretation anywhere in the stack would move them.
 */
const SAMPLES: readonly Instant[] = [
  iso("2026-01-01T00:00:00.000Z"),
  iso("2026-01-31T23:59:59.999Z"),
  iso("2026-02-01T00:00:00.000Z"),
  iso("2026-02-28T23:59:59.999Z"),
  iso("2026-03-01T00:00:00.000Z"),
  iso("2026-03-16T00:00:00.000Z"), // a Monday
  iso("2026-03-15T23:59:59.999Z"), // the Sunday before it
  iso("2026-03-29T00:30:00.000Z"), // EU spring-forward window
  iso("2026-03-29T01:30:00.000Z"),
  iso("2026-11-01T05:30:00.000Z"), // US fall-back window
  iso("2028-02-29T12:00:00.000Z"), // leap day
  iso("2026-06-15T12:34:56.789Z"),
];

/**
 * Verify that the database assigns rows to the domain's edges exactly as the
 * domain would.
 *
 * Runs entirely in one statement over a VALUES list, so it needs no tables and
 * costs nothing at startup.
 */
export const verifyBucketContract = async (pool: Pool): Promise<ContractCheck> => {
  const grains: readonly Grain[] = ["hour", "day", "week", "month"];
  const mismatches: BucketMismatch[] = [];
  let checked = 0;

  for (const grain of grains) {
    const window = Window.between(iso("2026-01-01T00:00:00Z"), iso("2028-06-01T00:00:00Z"));
    const axis = TimeAxis.build(window, grain, iso("2028-06-01T00:00:00Z"));
    const edges = TimeAxis.edgeMillis(axis).map((ms) => new Date(ms));

    const rows = (
      await pool.query(
        `SELECT t, width_bucket(t, $1::timestamptz[]) - 1 AS ix
         FROM unnest($2::timestamptz[]) AS t`,
        [edges, SAMPLES.map((i) => Instant.toDate(i))],
      )
    ).rows;

    for (const row of rows) {
      const at = Instant.fromDate(row.t as Date);
      const domainSays = TimeAxis.assign(axis, at);
      const raw = Number(row.ix);
      // Postgres reports out-of-range as -1 (0 minus our offset) or the bucket
      // count; the domain reports null. Normalise before comparing.
      const storeSays = raw < 0 || raw >= TimeAxis.bucketCount(axis) ? null : raw;
      checked++;

      if (domainSays !== storeSays) {
        mismatches.push({
          grain,
          instant: Instant.toISO(at),
          domainSays,
          storeSays,
        });
      }
    }
  }

  return mismatches.length === 0 ? { ok: true, checked } : { ok: false, mismatches, checked };
};

export class BucketContractViolation extends Error {
  constructor(readonly mismatches: readonly BucketMismatch[]) {
    super(
      `The database does not assign rows to the edges the domain computes. ` +
        `Refusing to start rather than serve misaligned charts.\n` +
        mismatches
          .slice(0, 5)
          .map((m) => `  [${m.grain}] ${m.instant}: domain says ${m.domainSays}, store says ${m.storeSays}`)
          .join("\n"),
    );
    this.name = "BucketContractViolation";
  }
}

export type BootReport = {
  readonly capabilities: Probe;
  readonly bucketContract: ContractCheck;
};

/**
 * Probe, verify, and refuse to start on a mismatch.
 *
 * Call this once from the composition root. The returned report is what an app
 * should log — "postgres 17.2, declarative partitioning, no hll, bucket
 * contract verified over 48 samples" is a line worth having when someone asks
 * why a chart looks odd six months from now.
 */
export const bootStore = async (pool: Pool): Promise<BootReport> => {
  const capabilities = await probeCapabilities(pool);
  const bucketContract = await verifyBucketContract(pool);
  if (!bucketContract.ok) throw new BucketContractViolation(bucketContract.mismatches);
  return { capabilities, bucketContract };
};

/** One line, for a startup log. */
export const describeBoot = (report: BootReport): string => {
  const c = report.capabilities;
  return [
    c.engine,
    `partitioning=${c.partitioning}`,
    `timescale=${c.timescale ? "present" : "absent"}`,
    `approximateDistinct=${c.approximateDistinct}`,
    `tz=${c.timeZone}`,
    `bucketContract=verified(${report.bucketContract.checked})`,
  ].join(" ");
};
