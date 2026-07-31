/**
 * Applying the schema, against a real PostgreSQL.
 *
 * Every property here is one a stub grants for free and a real database does
 * not: that running it twice changes nothing, that several replicas starting
 * at once do not race, and that a failure names the statement rather than
 * leaving somebody to bisect the DDL.
 *
 * The concurrency test is the one that matters. `CREATE … IF NOT EXISTS` is
 * not enough on its own — two backends creating the same table concurrently
 * produce a duplicate key error on `pg_type`, and two creating the same index
 * can deadlock. Every replica runs this at boot, so "several at once" is the
 * normal case, not an edge one.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { createDatabase, databaseUrl, type LiveDatabase } from "./testing/database";
import { appliedFingerprint, migrate, schemaFingerprint } from "./migrate";

/**
 * Unique per process.
 *
 * These create and drop whole databases, and the suite runs alongside the
 * other live tests against one server. With fixed names, two runs race on
 * `DROP DATABASE` — which blocks while any connection is open — and the
 * failure looks like a five-second timeout in an unrelated assertion.
 */
const SUFFIX = String(process.pid);
const DB = `counted_v2_migrate_${SUFFIX}`;

let db: LiveDatabase;

beforeAll(async () => {
  db = await createDatabase(DB);
});

afterAll(async () => {
  await db?.pool.end();
  await db?.drop();
});

describe("applying it", () => {
  test("an empty database gets the whole schema", async () => {
    const result = await migrate(db.pool, { release: "test-1" });

    expect(result.applied).toBe(true);
    expect(result.statements).toBeGreaterThan(5);

    const { rows } = await db.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tables = rows.map((r) => r.table_name);
    // A sample from each of the three statement sets, so a missing set fails.
    expect(tables).toContain("events");
    expect(tables).toContain("workspaces");
    expect(tables).toContain("accounts");
    expect(tables).toContain("schema_state");
  });

  test("running it again does nothing", async () => {
    // The common case on every redeploy. Doing the work again would be
    // harmless but slow, and "applied: true" would make the log lie about
    // what happened.
    const result = await migrate(db.pool, { release: "test-2" });
    expect(result).toMatchObject({ applied: false, statements: 0 });
  });

  test("it records which release last touched the schema", async () => {
    const { rows } = await db.pool.query<{ applied_by: string }>("SELECT applied_by FROM schema_state WHERE id = 1");
    // The second run was a no-op, so the recorded release is still the first.
    expect(rows[0]?.applied_by).toBe("test-1");
  });

  test("the database reports the fingerprint the build expects", async () => {
    expect(await appliedFingerprint(db.pool)).toBe(schemaFingerprint());
  });
});

describe("several replicas starting at once", () => {
  test("eight concurrent migrations produce one schema and no error", async () => {
    // Every replica runs this at boot, so this is the normal case. Without the
    // advisory lock, `CREATE TABLE … IF NOT EXISTS` races produce a duplicate
    // key error on pg_type and concurrent index creation can deadlock.
    const fresh = await createDatabase(`counted_v2_migrate_race_${SUFFIX}`);
    try {
      const pools = Array.from({ length: 8 }, () => new Pool({ connectionString: databaseUrl(`counted_v2_migrate_race_${SUFFIX}`) }));
      const results = await Promise.all(pools.map((pool) => migrate(pool, { release: "race" })));

      // Exactly one did the work; the rest found it current.
      expect(results.filter((r) => r.applied)).toHaveLength(1);
      expect(results.filter((r) => !r.applied)).toHaveLength(7);

      const { rows } = await fresh.pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events'`,
      );
      expect(rows[0]?.n).toBe("1");
      await Promise.all(pools.map((p) => p.end()));
    } finally {
      await fresh.pool.end();
      await fresh.drop();
    }
  });
});

describe("the fingerprint", () => {
  test("is stable across calls", () => {
    expect(schemaFingerprint()).toBe(schemaFingerprint());
  });

  test("is absent from a database that has never been migrated", async () => {
    // Readiness reports this as not-ready rather than as an error: an empty
    // database is a state a deploy passes through, not a fault.
    const empty = await createDatabase(`counted_v2_migrate_empty_${SUFFIX}`);
    try {
      expect(await appliedFingerprint(empty.pool)).toBeNull();
    } finally {
      await empty.pool.end();
      await empty.drop();
    }
  });
});

describe("a failure", () => {
  test("names the statement that failed", async () => {
    // A migration that stops halfway leaves a partial schema, and "which
    // statement" is the first thing anybody needs. Simulated by a pool whose
    // connection refuses the third query.
    let queries = 0;
    const failing = {
      connect: async () => ({
        query: async (sql: string) => {
          queries += 1;
          // 1: advisory lock, 2: schema_state table, 3: the fingerprint read,
          // 4: the first real statement.
          if (queries === 4) throw new Error("relation already exists in a bad way");
          if (sql.includes("SELECT fingerprint")) return { rows: [] };
          return { rows: [] };
        },
        release: () => {},
      }),
    } as unknown as Pool;

    await expect(migrate(failing, { release: "x" })).rejects.toThrow(/schema statement 1\/\d+ failed/);
  });

  test("releases the lock even when a statement throws", async () => {
    // A lock left held by a crashed migration blocks every subsequent deploy
    // until that session ends — which, on a pooled connection, may be never.
    const unlocks: string[] = [];
    let queries = 0;
    const failing = {
      connect: async () => ({
        query: async (sql: string) => {
          if (sql.includes("pg_advisory_unlock")) {
            unlocks.push(sql);
            return { rows: [] };
          }
          queries += 1;
          // Counted rather than matched on text: the real statements begin
          // with a newline and a comment, so `startsWith("CREATE TABLE")`
          // matched nothing and the migration ran to completion — a test that
          // passed for the wrong reason until it did not.
          if (queries === 4) throw new Error("boom");
          return { rows: [] };
        },
        release: () => {},
      }),
    } as unknown as Pool;

    await expect(migrate(failing, { release: "x" })).rejects.toThrow();
    expect(unlocks).toHaveLength(1);
  });
});
