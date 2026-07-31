/**
 * The event store schema.
 *
 * Plain PostgreSQL. No extension is required, which is a deliberate reversal:
 * v1 depended on TimescaleDB, and on a plain-Postgres host its migration
 * failed silently on every boot while every timeseries query threw
 * `function time_bucket does not exist` — surfacing to users as empty charts
 * rather than an error. Self-hosting is a growth channel; requiring a
 * source-available extension undercuts it.
 *
 * Partitioning is native declarative RANGE on `occurred_at`, one partition per
 * month, created ahead of need by the worker's `partitions.ensure` job.
 * Retention becomes `DROP TABLE` on an expired partition — instant, and it is
 * the feature the pricing page has advertised since launch without any code
 * behind it.
 */

/**
 * System columns mirror the closed `SystemField` set in the domain. They are
 * real columns rather than JSONB keys so a breakdown by OS is an index scan,
 * and — more importantly — so a *customer* property named `locale` can never
 * be mistaken for ours. v1 tested filter names against a system allowlist
 * first and silently returned our column's numbers for their property.
 */
export const SYSTEM_COLUMNS = [
  "os_name",
  "os_version",
  "locale",
  "app_version",
  "device_model",
  "country_code",
  "sdk_version",
] as const;

/**
 * Stored, but not queryable.
 *
 * `os_name` is a closed enum — anything unrecognised becomes `other`, which is
 * what stops one platform appearing under four spellings. `os_name_raw` keeps
 * whatever the SDK actually sent, so a platform we have never seen is
 * discoverable rather than lost and the fix is a line in a lookup table rather
 * than a migration.
 *
 * Deliberately absent from `SYSTEM_COLUMNS`: it is a diagnostic, not a
 * dimension. Letting it be filtered on would reintroduce exactly the
 * four-spellings problem in the query layer.
 */
export const DIAGNOSTIC_COLUMNS = ["os_name_raw"] as const;

/** Everything the writer sets. Queryable dimensions plus diagnostics. */
export const WRITE_SYSTEM_COLUMNS = [...SYSTEM_COLUMNS, ...DIAGNOSTIC_COLUMNS] as const;

export const EVENTS_TABLE = "events";

/**
 * The parent table. Holds no rows itself; every row lives in a monthly child.
 *
 * On dedup: PostgreSQL requires a unique constraint on a partitioned table to
 * include the partition key, so the key is
 * `(project_id, idempotency_key, occurred_at)` rather than the tidier
 * `(project_id, idempotency_key)`.
 *
 * That is sound for the case that matters. A retry re-sends the *same* event:
 * the SDK stamps `occurred_at` when `track()` is called and holds it in its
 * on-device queue, so the timestamp is identical across attempts and the
 * constraint fires. It is unsound only if the server were to assign the
 * timestamp itself, because two attempts would then land at different
 * instants — which is exactly why ingestion must never default
 * `occurred_at` to `now()` for an event carrying an idempotency key.
 */
export const CREATE_EVENTS = /* sql */ `
CREATE TABLE IF NOT EXISTS ${EVENTS_TABLE} (
  project_id      uuid        NOT NULL,
  occurred_at     timestamptz NOT NULL,
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  name            text        NOT NULL,
  visit_id        text        NOT NULL,
  person_id       text,
  idempotency_key text        NOT NULL,
  properties      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  os_name         text,
  os_version      text,
  locale          text,
  app_version     text,
  device_model    text,
  country_code    text,
  sdk_version     text,
  os_name_raw     text,
  CONSTRAINT events_dedup UNIQUE (project_id, idempotency_key, occurred_at)
) PARTITION BY RANGE (occurred_at);
`;

/**
 * A default partition catches anything outside the months we have created, so
 * an ingest at an unexpected instant is stored rather than rejected. The
 * worker reports rows landing here: it means partition creation has fallen
 * behind, or a client is sending timestamps from far outside the present.
 */
export const CREATE_DEFAULT_PARTITION = /* sql */ `
CREATE TABLE IF NOT EXISTS ${EVENTS_TABLE}_default PARTITION OF ${EVENTS_TABLE} DEFAULT;
`;

/**
 * The outbox. Domain events are written in the same transaction as the
 * aggregate that produced them, and dispatched later by the worker — so "the
 * change committed but the notification did not" is recoverable rather than
 * lost.
 */
export const CREATE_OUTBOX = /* sql */ `
CREATE TABLE IF NOT EXISTS outbox (
  id            uuid        PRIMARY KEY,
  type          text        NOT NULL,
  payload       jsonb       NOT NULL,
  occurred_at   timestamptz NOT NULL,
  dispatched_at timestamptz,
  attempts      integer     NOT NULL DEFAULT 0,
  -- Why the last attempt failed. Kept after a successful retry too: an event
  -- that took nine tries is worth knowing about even once it lands.
  last_error    text,
  last_error_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx
  ON outbox (occurred_at) WHERE dispatched_at IS NULL;
`;

/**
 * Daily rollups.
 *
 * A pre-aggregated view of the event table, refreshed by the worker. This is
 * the replacement for TimescaleDB's continuous aggregates, which are a
 * TSL-licensed feature — and it is a better fit anyway, because the refresh
 * rule can be exact rather than time-windowed.
 *
 * Being a second representation of the same data, the only thing that really
 * matters about it is that it cannot disagree with the source. Two things make
 * that hold: the refresh recomputes a whole bucket rather than incrementing
 * it, and which buckets to recompute is decided by `ingested_at` rather than
 * by "the last few days". An event backdated ninety days — which the ingest
 * contract allows — dirties the bucket it belongs to, not the bucket it
 * arrived in.
 */
export const CREATE_ROLLUPS = /* sql */ `
CREATE TABLE IF NOT EXISTS rollup_daily (
  project_id   uuid        NOT NULL,
  day          date        NOT NULL,
  name         text        NOT NULL,
  events       bigint      NOT NULL,
  visits       bigint      NOT NULL,
  people       bigint      NOT NULL,
  refreshed_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, day, name)
);

CREATE INDEX IF NOT EXISTS rollup_daily_project_day_idx ON rollup_daily (project_id, day);

-- Where the last refresh got to, by ingestion time. One row.
CREATE TABLE IF NOT EXISTS rollup_state (
  id        text        PRIMARY KEY,
  watermark timestamptz NOT NULL
);
`;

/** Statements that build an empty store, in order. */
export const SCHEMA_STATEMENTS: readonly string[] = [
  CREATE_EVENTS,
  CREATE_DEFAULT_PARTITION,
  CREATE_OUTBOX,
  CREATE_ROLLUPS,
];
