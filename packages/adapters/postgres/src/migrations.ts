/**
 * A ledgered migration runner, for the DDL this repository does not own.
 *
 * `applySchema` in `schema.ts` is idempotent statement by statement — every
 * one of its statements is an `IF NOT EXISTS` — so it can be replayed on every
 * boot and re-derive the same schema. **Generated migrations are not like
 * that.** `generateMigrations` from `@litics/core` emits plain
 * `CREATE TABLE analytics.dims (…)`, `CREATE POLICY litics_tenant_read …` and
 * `SELECT cron.schedule(…)`; the first two fail outright on a second run, and
 * the third would keep working only by accident. A generator that emits a
 * migration *sequence* is telling you it expects a ledger, and this is that
 * ledger.
 *
 * So: each step runs once, its name is recorded, and a boot that finds every
 * name recorded does nothing. That is what makes "run it twice" a no-op rather
 * than an error, and it is the same property `applySchema` gets for free from
 * `IF NOT EXISTS`.
 *
 * **The same advisory lock as `applySchema`, deliberately.** Two API replicas
 * rolling at once would otherwise both find the ledger empty and both start
 * creating `analytics.dims`; the loser fails inside `pg_type` with an error
 * that names a catalogue index and mentions neither the table nor the fact
 * that another process was starting. One lock across all schema work — domain,
 * identity and analytics — means the second replica waits and then finds
 * everything already made. It is transaction-scoped, so a crashed applier
 * cannot leave it held, and the wait is bounded (`schema-lock.ts`), so a
 * replica queued behind a wedged holder fails by name rather than hanging.
 *
 * **One transaction per step, not one for the whole run.** Postgres DDL is
 * transactional, so a step either fully applies and is recorded or does
 * neither — the ledger can never claim a step that did not finish. A single
 * transaction around every step would be stricter and is not available:
 * `cron.schedule` and partman's `create_parent` do their own bookkeeping, and
 * a step that fails after them leaves the ledger the only usable record of
 * where the run stopped.
 */

import type { Pool, PoolClient } from "pg";

import { acquireSchemaLock, type SchemaLockOptions } from "./schema-lock";

/**
 * A named, ordered group of statements. Structural on purpose: `@litics/core`'s
 * `MigrationStep` satisfies it, and this package must not import that library
 * — only `@counted/analytics-adapter-litics` may (`.dependency-cruiser.cjs`,
 * rule 5).
 */
export type MigrationStep = {
  readonly name: string;
  readonly statements: readonly string[];
};

/** Where applied step names are recorded. Created on first use. */
export const MIGRATION_LEDGER = "public.schema_migrations";

const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS ${MIGRATION_LEDGER} (
   name       text PRIMARY KEY,
   applied_at timestamptz NOT NULL DEFAULT now()
 )`;

/**
 * Hold the schema lock for the duration of `work`.
 *
 * For DDL this repository neither writes nor generates — better-auth's, which
 * it applies through the library's own `getMigrations`. That function
 * introspects the live database, works out what is missing, and creates it,
 * with nothing in between: three replicas booting at once all see an empty
 * `auth` schema, all decide sixteen tables are missing, and two die with
 * `relation "session" already exists`. The database survives, because the
 * winner's work is complete and correct — but two replicas are gone, and on a
 * platform that restarts them that is a boot loop on a cold database.
 *
 * The same key as `applySchema` and `applyMigrations`, so all three phases
 * serialise against each other rather than only against themselves. **Do not
 * nest**: `work` must not itself take the lock on a different connection, which
 * is a deadlock rather than a wait.
 *
 * The lock may be taken on a different pool from the one `work` uses.
 * Advisory locks are database-wide, not connection-scoped, which is what makes
 * it possible to hold the lock on the domain's pool while better-auth migrates
 * on its own.
 */
export const withSchemaLock = async <T>(
  pool: Pool,
  work: () => Promise<T>,
  options: SchemaLockOptions = {},
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await acquireSchemaLock(client, options);
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (cause) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw cause;
  } finally {
    client.release();
  }
};

/** What a run did. Returned rather than logged so the caller decides the words. */
export type MigrationOutcome = {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
};

/**
 * A step failed, and the message says which statement.
 *
 * Generated SQL is long, and a driver error alone reads like a syntax error in
 * a string nobody wrote. Naming the step and the statement index is what turns
 * it into something an operator can look at.
 */
export class MigrationFailed extends Error {
  readonly step: string;
  readonly statementIndex: number;
  readonly statement: string;

  constructor(step: string, statementIndex: number, statement: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`migration ${step} failed at statement ${statementIndex}: ${detail}`);
    this.name = "MigrationFailed";
    this.step = step;
    this.statementIndex = statementIndex;
    this.statement = statement;
    this.cause = cause;
  }
}

const appliedNames = async (client: PoolClient): Promise<ReadonlySet<string>> => {
  const rows = await client.query<{ name: string }>(`SELECT name FROM ${MIGRATION_LEDGER}`);
  return new Set(rows.rows.map((row) => row.name));
};

/**
 * Apply every step that has not been applied before.
 *
 * Takes a `Pool` rather than a `Queryable` for the same reason `applySchema`
 * does: the lock and the DDL have to share one connection, and a pool-level
 * `query` would spread them across several and drop the lock between them.
 */
export const applyMigrations = async (
  pool: Pool,
  steps: readonly MigrationStep[],
  options: SchemaLockOptions = {},
): Promise<MigrationOutcome> => {
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    // The ledger gets a transaction of its own, under the lock, so every
    // per-step transaction below starts from a ledger that exists — and so a
    // run with no steps still leaves one behind, which is what lets the first
    // step ever added be recorded.
    await client.query("BEGIN");
    await acquireSchemaLock(client, options);
    await client.query(LEDGER_DDL);
    await client.query("COMMIT");

    for (const step of steps) {
      await client.query("BEGIN");
      await acquireSchemaLock(client, options);
      // Read inside the lock, not once up front: another replica may have
      // applied a step while this one waited.
      const done = await appliedNames(client);
      if (done.has(step.name)) {
        await client.query("COMMIT");
        skipped.push(step.name);
        continue;
      }

      for (const [index, statement] of step.statements.entries()) {
        try {
          await client.query(statement);
        } catch (cause) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw new MigrationFailed(step.name, index, statement, cause);
        }
      }
      await client.query(`INSERT INTO ${MIGRATION_LEDGER} (name) VALUES ($1)`, [step.name]);
      await client.query("COMMIT");
      applied.push(step.name);
    }
    return { applied, skipped };
  } catch (cause) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw cause;
  } finally {
    client.release();
  }
};
