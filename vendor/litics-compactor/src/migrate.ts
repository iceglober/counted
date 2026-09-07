/**
 * The ledgered migrator: applies every generated step once, in order,
 * under litics' own schema lock, and tells you whether the live schema
 * matches the config afterwards.
 *
 * One transaction per step. The ledger row is written in the same
 * transaction as the step's DDL (Postgres DDL is transactional), so a
 * crash mid-step leaves nothing applied and nothing recorded. Concurrent
 * appliers — several replicas booting at once — serialise on the advisory
 * lock and each sees the ledger the previous one wrote.
 */

import { diffSchema, generateMigrations, LITICS_SCHEMA_LOCK_KEY, type ColumnSpec, type ResolvedConfig } from "@litics/core";
import type { Pool } from "pg";
import type { Logger } from "./logger.js";
import { silentLogger } from "./logger.js";

export type MigrateResult = { applied: string[]; skipped: string[] };

export const LEDGER = "litics_migrations";

export const migrate = async (pool: Pool, cfg: ResolvedConfig, opts: { logger?: Logger } = {}): Promise<MigrateResult> => {
  const logger = opts.logger ?? silentLogger;
  const ledger = `${cfg.schema}.${LEDGER}`;
  const lock = "SELECT pg_advisory_xact_lock($1::bigint)";
  const key = [String(LITICS_SCHEMA_LOCK_KEY)];
  const result: MigrateResult = { applied: [], skipped: [] };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(lock, key);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${cfg.schema}`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${ledger} (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query("COMMIT");
    for (const step of generateMigrations(cfg)) {
      await client.query("BEGIN");
      try {
        await client.query(lock, key);
        const seen = await client.query(`SELECT 1 FROM ${ledger} WHERE name = $1`, [step.name]);
        if (seen.rows.length > 0) {
          await client.query("COMMIT");
          result.skipped.push(step.name);
          continue;
        }
        for (const statement of step.statements) await client.query(statement);
        await client.query(`INSERT INTO ${ledger} (name) VALUES ($1)`, [step.name]);
        await client.query("COMMIT");
        result.applied.push(step.name);
        logger.info("migration.applied", { step: step.name, statements: step.statements.length });
      } catch (cause) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(`litics: migration step ${step.name} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
      }
    }
  } finally {
    client.release();
  }
  return result;
};

/** Every column of every table in the litics schema, as `diffSchema` wants it. */
export const liveColumns = async (pool: Pool, cfg: ResolvedConfig): Promise<ColumnSpec[]> => {
  const { rows } = await pool.query<ColumnSpec>(
    `SELECT table_name AS "table", column_name AS "column", udt_name AS udt
       FROM information_schema.columns WHERE table_schema = $1`,
    [cfg.schema],
  );
  return rows;
};

/** Human-readable drift between the config and the live schema; empty means none. */
export const schemaDrift = async (pool: Pool, cfg: ResolvedConfig): Promise<string[]> => diffSchema(cfg, await liveColumns(pool, cfg));

/** Throw unless the live schema matches the config exactly. */
export const assertSchema = async (pool: Pool, cfg: ResolvedConfig): Promise<void> => {
  const issues = await schemaDrift(pool, cfg);
  if (issues.length > 0) throw new Error(`litics: schema drift:\n  ${issues.join("\n  ")}`);
};
