/**
 * Connection pools.
 *
 * Two of them, deliberately.
 *
 * v1 ran everything through a single `pg.Pool` with `max: 20` and **no
 * `statement_timeout`**. One pathological breakdown — a high-cardinality JSONB
 * group-by over a year, say — could hold a connection indefinitely, and twenty
 * of them stalled the whole process. Ingestion used that same pool, so a slow
 * dashboard could stop a customer's events being written. A read is allowed to
 * be slow; a write that accepts telemetry is not allowed to be blocked by one.
 *
 * So: writes get their own small pool with a short timeout, reads get a larger
 * one with a longer timeout, and neither can exhaust the other.
 */

export type PoolRole = "ingest" | "analytics";

export type PoolSettings = {
  readonly max: number;
  /** Server-side cap. A query past this is cancelled by Postgres, not by us. */
  readonly statementTimeoutMs: number;
  /** How long to wait for a free connection before giving up. */
  readonly connectionTimeoutMs: number;
  readonly idleTimeoutMs: number;
  /**
   * Belt and braces: Postgres also cancels anything idle inside a transaction,
   * so a client that dies mid-transaction cannot pin a connection forever.
   */
  readonly idleInTransactionTimeoutMs: number;
};

/**
 * Ingest: many short writes. The timeout is aggressive on purpose — an insert
 * that takes more than a couple of seconds is a symptom, and failing fast lets
 * the API return 503 with Retry-After so the SDK's on-device queue absorbs it.
 * That is a better outcome than a request hanging until the client gives up.
 */
export const INGEST_POOL: PoolSettings = {
  max: 10,
  statementTimeoutMs: 3_000,
  connectionTimeoutMs: 2_000,
  idleTimeoutMs: 30_000,
  idleInTransactionTimeoutMs: 5_000,
};

/**
 * Analytics: fewer, heavier reads. Generous enough for a real dashboard,
 * bounded so one query cannot camp on a connection. The batch deadline in
 * `ExecOptions` should always be lower than this, so the application gives up
 * before the server does and can report a `timeout` outcome with a budget.
 */
export const ANALYTICS_POOL: PoolSettings = {
  max: 20,
  statementTimeoutMs: 30_000,
  connectionTimeoutMs: 5_000,
  idleTimeoutMs: 30_000,
  idleInTransactionTimeoutMs: 15_000,
};

export const settingsFor = (role: PoolRole): PoolSettings =>
  role === "ingest" ? INGEST_POOL : ANALYTICS_POOL;

/**
 * Session parameters applied to every connection as it is handed out.
 *
 * Set per-connection rather than per-query: a query that forgets to set its
 * own timeout is exactly the query that will run away, so the safe value has
 * to be the default rather than something a caller opts into.
 */
export const sessionOptions = (settings: PoolSettings): string =>
  [
    `-c statement_timeout=${settings.statementTimeoutMs}`,
    `-c idle_in_transaction_session_timeout=${settings.idleInTransactionTimeoutMs}`,
    // Analytical queries read; nothing they do should ever wait on a lock.
    `-c lock_timeout=1000`,
  ].join(" ");

/** The shape `pg.Pool` is constructed with. Kept plain so it is testable. */
export type PoolConfig = {
  readonly connectionString: string;
  readonly max: number;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
  readonly options: string;
  readonly application_name: string;
};

export const poolConfig = (connectionString: string, role: PoolRole): PoolConfig => {
  const settings = settingsFor(role);
  return {
    connectionString,
    max: settings.max,
    connectionTimeoutMillis: settings.connectionTimeoutMs,
    idleTimeoutMillis: settings.idleTimeoutMs,
    options: sessionOptions(settings),
    // Shows up in pg_stat_activity, so "what is holding this connection?" has
    // an answer without guessing.
    application_name: `counted-${role}`,
  };
};

/**
 * The deadline an application should pass for a batch, given its pool. Always
 * under the server-side cap, so the application reports a `timeout` outcome
 * with a stated budget rather than surfacing a raw driver error.
 */
export const batchDeadlineFor = (role: PoolRole): number =>
  Math.floor(settingsFor(role).statementTimeoutMs * 0.8);
