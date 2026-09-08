/**
 * The one lock every schema phase takes, and the bound on how long it waits.
 *
 * **The advisory lock is the point.** `CREATE TABLE IF NOT EXISTS` is not safe
 * to run concurrently: two connections that both find the table missing both
 * proceed, and the loser fails inside `pg_type` with an error that names a
 * catalogue index and mentions neither the table nor the fact that another
 * process was starting. Every applier in this package — the domain schema, the
 * ledgered runner, and `withSchemaLock` around better-auth's — takes this one
 * transaction-scoped lock first, so the second one waits and then finds
 * everything already made. Transaction-scoped (`pg_advisory_xact_lock`) rather
 * than session-scoped so a crashed applier cannot leave it held.
 *
 * **The wait is bounded.** Without `lock_timeout`, a replica queued behind a
 * wedged holder — a migration stalled on a long query, a session that took the
 * lock and hung — waits forever, and from outside that is indistinguishable
 * from a replica that is still starting: no log line, no error, a health check
 * that never turns green. With it, the wait fails at thirty seconds with an
 * error that names this lock, so the operator reads "the schema lock is held"
 * rather than guessing. Thirty seconds is longer than any schema phase has
 * taken and shorter than the deploy's health-check timeout
 * (`deploy/api.railway.json`), so the replica fails with a reason while the
 * previous deployment is still serving.
 *
 * `SET LOCAL` scopes the timeout to the open transaction, where it also bounds
 * the DDL that follows — a `CREATE INDEX` queued behind a long-running writer
 * gives up rather than holding every later writer behind it. That failure
 * surfaces through the caller's own error (a `MigrationFailed` naming the
 * statement); only the advisory lock itself is translated here.
 */

import type { PoolClient } from "pg";

/**
 * The advisory lock key. Arbitrary, fixed, and documented so nothing else in
 * this system picks it by accident — advisory locks share one 64-bit keyspace
 * across the whole database, so a collision would make two unrelated things
 * queue behind each other for no reason.
 */
export const SCHEMA_LOCK_KEY = 6_284_197_305_412;

export const SCHEMA_LOCK_TIMEOUT_MS = 30_000;

/** Postgres' `lock_not_available`, which is what an expired `lock_timeout` raises. */
const LOCK_NOT_AVAILABLE = "55P03";

export type SchemaLockOptions = {
  /** How long to wait for the lock. Tests shorten it; production takes the default. */
  readonly lockTimeoutMs?: number;
};

/** Somebody else held the schema lock for the whole wait. */
export class SchemaLockTimeout extends Error {
  readonly key = SCHEMA_LOCK_KEY;
  readonly timeoutMs: number;

  constructor(timeoutMs: number, cause: unknown) {
    super(
      `schema lock ${SCHEMA_LOCK_KEY} was not acquired within ${timeoutMs}ms: another ` +
        `schema applier is holding it. Find the holder in pg_locks (locktype = 'advisory') ` +
        `joined to pg_stat_activity; a replica that stops here retries on its next boot.`,
    );
    this.name = "SchemaLockTimeout";
    this.timeoutMs = timeoutMs;
    this.cause = cause;
  }
}

/**
 * Take the schema lock on `client`'s open transaction, or fail by name.
 *
 * Call it after `BEGIN`: `SET LOCAL` outside a transaction is a warning and a
 * no-op, and an advisory *xact* lock outside one is released at once. The
 * timeout is interpolated rather than bound because `SET` takes no parameters;
 * it is an integer this module produced, never input.
 */
export const acquireSchemaLock = async (
  client: PoolClient,
  options: SchemaLockOptions = {},
): Promise<void> => {
  const timeoutMs = Math.max(1, Math.floor(options.lockTimeoutMs ?? SCHEMA_LOCK_TIMEOUT_MS));
  await client.query(`SET LOCAL lock_timeout = '${timeoutMs}ms'`);
  try {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [String(SCHEMA_LOCK_KEY)]);
  } catch (cause) {
    if ((cause as { code?: string }).code === LOCK_NOT_AVAILABLE) {
      throw new SchemaLockTimeout(timeoutMs, cause);
    }
    throw cause;
  }
};
