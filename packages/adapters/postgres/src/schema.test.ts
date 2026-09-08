/**
 * The schema, and the lock that lets two replicas boot at the same time.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Pool } from "pg";
import { MIGRATION_LEDGER } from "./migrations";
import { applySchema, DOMAIN_TABLES } from "./schema";
import { SCHEMA_LOCK_KEY } from "./schema-lock";
import { closeDatabase, describeLive, liveDatabase } from "./testing";

/** The ledger's bare name, for `information_schema` queries that take one. */
const LEDGER_TABLE = MIGRATION_LEDGER.replace(/^public\./, "");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describeLive("schema", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await liveDatabase();
  });
  afterAll(closeDatabase);

  test("every table it claims to own exists after it runs", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const present = new Set(rows.map((row) => row.table_name));
    for (const table of DOMAIN_TABLES) expect(present).toContain(table);
  });

  test("better-auth's namespace exists and is empty", async () => {
    // Created here because better-auth never creates a schema: pointed at a
    // missing one it logs `Schema 'auth' does not exist` and writes into
    // `public` instead, which succeeds and puts every identity table in the
    // wrong place. Nothing of ours goes inside it — better-auth generates and
    // migrates its own tables, and a table of ours in there would be a second
    // opinion about a schema somebody else owns.
    //
    // litics' namespace is deliberately NOT here: `generateMigrations` emits
    // `CREATE SCHEMA IF NOT EXISTS analytics` itself.
    const { rows } = await pool.query<{ nspname: string; tables: string }>(
      `SELECT n.nspname, count(c.oid) AS tables
       FROM pg_namespace n
       LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind = 'r'
       WHERE n.nspname IN ('auth', 'events', 'analytics')
       GROUP BY n.nspname ORDER BY n.nspname`,
    );
    expect(rows.map((row) => row.nspname)).toEqual(["auth"]);
    expect(rows.every((row) => Number(row.tables) === 0)).toBe(true);
  });

  test("running it again is a no-op, not an error", async () => {
    await applySchema(pool);
    await applySchema(pool);
    // Named rather than counted. `public` also holds the analytics tenancy
    // host table, which litics' migration creates in production and
    // `testing.ts` creates here — so a count would be asserting who else has
    // written to the schema rather than what `applySchema` did.
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
        ORDER BY table_name`,
      [[...DOMAIN_TABLES]],
    );
    expect(rows.map((row) => row.table_name)).toEqual([...DOMAIN_TABLES].sort());
  });

  test("four replicas booting at once do not race each other", async () => {
    // Without the advisory lock this is the failure: two connections both find
    // a table missing, both issue CREATE TABLE, and the loser gets
    // `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`
    // — an error naming a catalogue index, mentioning neither the table nor the
    // fact that another process was starting.
    await pool.query(`DROP SCHEMA public CASCADE`);
    await pool.query(`CREATE SCHEMA public`);

    await Promise.all([applySchema(pool), applySchema(pool), applySchema(pool), applySchema(pool)]);

    // Named, not counted: `public` holds the domain tables and the migration
    // ledger `applySchema` now creates for `DOMAIN_MIGRATIONS`, and nothing
    // else — a duplicate from a race would show up as an error above, an
    // extra table would show up here.
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(rows.map((row) => row.table_name).sort()).toEqual(
      [...DOMAIN_TABLES, LEDGER_TABLE].sort(),
    );
  });

  test("an applier waits while somebody else holds the lock", async () => {
    // The previous test proves concurrent appliers agree; this proves *why*. If
    // `applySchema` stopped taking the lock, it would finish here regardless of
    // who was holding it and this test would fail while the one above still
    // passed by luck.
    const holder = await pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock($1::bigint)", [String(SCHEMA_LOCK_KEY)]);

      let finished = false;
      const applying = applySchema(pool).then(() => {
        finished = true;
      });

      await sleep(250);
      expect(finished).toBe(false);

      await holder.query("SELECT pg_advisory_unlock($1::bigint)", [String(SCHEMA_LOCK_KEY)]);
      await applying;
      expect(finished).toBe(true);
    } finally {
      holder.release();
    }
  });
});
