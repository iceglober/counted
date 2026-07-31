/**
 * Applying the schema.
 *
 * Every statement is `CREATE … IF NOT EXISTS`, so running this against an
 * up-to-date database is a no-op and running it twice concurrently is safe.
 * That is what lets it run at container start on every replica rather than in
 * a separate step somebody has to remember.
 *
 * **Why not a pre-deploy step.** v1 tried one and it could not resolve
 * `*.railway.internal` — the one-off container is not on the service network —
 * so migration failed with ENOTFOUND on every deploy and the schema was
 * applied by the app instead, silently. Running it in the process that will
 * serve traffic means it uses the same connection string it is about to query
 * with, and a failure stops the deploy rather than producing a container that
 * boots against a schema it does not have.
 *
 * **The advisory lock is what makes several replicas safe.** `IF NOT EXISTS`
 * is not enough on its own: two backends creating the same index concurrently
 * can deadlock, and `CREATE TABLE … IF NOT EXISTS` races produce a duplicate
 * key error on `pg_type`. One writer at a time, and the others wait and then
 * find there is nothing to do.
 */

import type { Pool } from "pg";
import { SCHEMA_STATEMENTS } from "./sql/schema";
import { CONTROL_PLANE_STATEMENTS } from "./sql/control-plane";
import { INDEX_STATEMENTS } from "./sql/indexes";

/**
 * A fixed key for the migration lock.
 *
 * Arbitrary but stable; it only has to be a number no other part of this
 * system uses with `pg_advisory_lock`. Nothing else here takes one.
 */
const MIGRATION_LOCK = 8_233_907_115_442_001n;

/**
 * What the running build expects the schema to be.
 *
 * Derived from the statements rather than hand-maintained, so it cannot say
 * "up to date" about a build whose statements changed. Readiness compares this
 * to what was last applied — a container serving traffic against a schema it
 * did not create is the failure this catches.
 */
export const schemaFingerprint = (): string => {
  const all = [...SCHEMA_STATEMENTS, ...CONTROL_PLANE_STATEMENTS, ...INDEX_STATEMENTS].join("\n");
  // A cheap, stable digest. Not security — this only has to change when the
  // statements change.
  let a = 0x811c9dc5;
  for (let i = 0; i < all.length; i++) a = Math.imul(a ^ all.charCodeAt(i), 0x01000193) >>> 0;
  return `${all.length.toString(36)}-${(a >>> 0).toString(16)}`;
};

const RECORD_TABLE = `
CREATE TABLE IF NOT EXISTS schema_state (
  id            integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  fingerprint   text        NOT NULL,
  applied_at    timestamptz NOT NULL,
  applied_by    text        NOT NULL,
  CONSTRAINT schema_state_singleton CHECK (id = 1)
);
`;

export type MigrationResult = {
  readonly fingerprint: string;
  /** False when the schema already matched — the common case on a redeploy. */
  readonly applied: boolean;
  readonly statements: number;
  readonly durationMs: number;
};

export type MigrateOptions = {
  /** Recorded, so `schema_state` says which release last touched it. */
  readonly release: string;
  readonly log?: (event: string, fields: Record<string, unknown>) => void;
};

export const migrate = async (pool: Pool, options: MigrateOptions): Promise<MigrationResult> => {
  const fingerprint = schemaFingerprint();
  const startedAt = Date.now();
  const log = options.log ?? (() => {});

  const client = await pool.connect();
  try {
    // Session-scoped, and released in `finally`. A transaction-scoped lock
    // would be released by the first COMMIT, and several of these statements
    // cannot run inside a transaction anyway.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK.toString()]);

    await client.query(RECORD_TABLE);

    const { rows } = await client.query<{ fingerprint: string }>("SELECT fingerprint FROM schema_state WHERE id = 1");
    if (rows[0]?.fingerprint === fingerprint) {
      // The common case on a redeploy: every replica but the first finds this.
      log("migrate.current", { fingerprint });
      return { fingerprint, applied: false, statements: 0, durationMs: Date.now() - startedAt };
    }

    const statements = [...SCHEMA_STATEMENTS, ...CONTROL_PLANE_STATEMENTS, ...INDEX_STATEMENTS];
    for (const [index, statement] of statements.entries()) {
      try {
        await client.query(statement);
      } catch (error) {
        // Named, with its position. A migration that fails halfway leaves a
        // partial schema, and "which statement" is the first thing anybody
        // needs to know.
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`schema statement ${index + 1}/${statements.length} failed: ${detail}`);
      }
    }

    await client.query(
      `INSERT INTO schema_state (id, fingerprint, applied_at, applied_by)
       VALUES (1, $1, now(), $2)
       ON CONFLICT (id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint,
                                      applied_at = EXCLUDED.applied_at,
                                      applied_by = EXCLUDED.applied_by`,
      [fingerprint, options.release],
    );

    log("migrate.applied", { fingerprint, statements: statements.length });
    return { fingerprint, applied: true, statements: statements.length, durationMs: Date.now() - startedAt };
  } finally {
    // Before releasing the client, and unconditionally — a lock left held by a
    // crashed migration would block every subsequent deploy until the session
    // ended.
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK.toString()]).catch(() => {});
    client.release();
  }
};

/**
 * What the database says was last applied.
 *
 * `null` when the table does not exist — an empty database, which readiness
 * reports as not ready rather than as an error.
 */
export const appliedFingerprint = async (pool: Pool): Promise<string | null> => {
  try {
    const { rows } = await pool.query<{ fingerprint: string }>("SELECT fingerprint FROM schema_state WHERE id = 1");
    return rows[0]?.fingerprint ?? null;
  } catch {
    return null;
  }
};
