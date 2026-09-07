/**
 * The ledger, and what it is for: generated DDL that is not idempotent.
 *
 * A database of its own rather than the shared one from `testing.ts`, because
 * these tests create the ledger in `public` and `schema.test.ts` asserts that
 * `public` holds exactly the domain's tables.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { Pool } from "pg";
import { applyMigrations, MIGRATION_LEDGER, MigrationFailed, withSchemaLock } from "./migrations";
import { applySchema, DOMAIN_MIGRATIONS } from "./schema";
import { SCHEMA_LOCK_KEY, SchemaLockTimeout } from "./schema-lock";
import { databaseAvailable, describeLive } from "./testing";

const ADMIN_URL =
  process.env["COUNTED_TEST_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgres://counted:counted@127.0.0.1:5434/counted";

const DATABASE = "counted_migrations_test";

const urlFor = (name: string): string => {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
};

describeLive("migrations", () => {
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${DATABASE}`);
      await admin.query(`CREATE DATABASE ${DATABASE}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: urlFor(DATABASE), max: 8 });
  });

  afterAll(async () => {
    if (databaseAvailable) await pool.end();
  });

  /**
   * The property the whole file exists for. `CREATE TABLE` without
   * `IF NOT EXISTS` is what `@litics/core` emits, so a runner that replayed it
   * would fail on the second boot — which is every boot after the first.
   */
  test("a step runs once; a second run is a no-op, not an error", async () => {
    const steps = [{ name: "0001_once", statements: [`CREATE TABLE only_once (id int)`] }];

    const first = await applyMigrations(pool, steps);
    expect(first.applied).toEqual(["0001_once"]);
    expect(first.skipped).toEqual([]);

    const second = await applyMigrations(pool, steps);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["0001_once"]);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'only_once'`,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  test("a step added later is applied without re-running the earlier ones", async () => {
    const outcome = await applyMigrations(pool, [
      { name: "0001_once", statements: [`CREATE TABLE only_once (id int)`] },
      { name: "0002_later", statements: [`CREATE TABLE added_later (id int)`] },
    ]);
    expect(outcome.skipped).toEqual(["0001_once"]);
    expect(outcome.applied).toEqual(["0002_later"]);
  });

  /**
   * Four appliers on a cold database. Three of them must wait rather than race:
   * without the lock they all find the ledger empty and three die inside
   * `pg_type` on a duplicate relation name.
   */
  test("concurrent runs serialise, and the step applies exactly once", async () => {
    const steps = [
      { name: "0003_raced", statements: [`CREATE TABLE raced (id int)`, `CREATE INDEX raced_id ON raced (id)`] },
    ];

    const outcomes = await Promise.all([
      applyMigrations(pool, steps),
      applyMigrations(pool, steps),
      applyMigrations(pool, steps),
      applyMigrations(pool, steps),
    ]);

    expect(outcomes.filter((outcome) => outcome.applied.includes("0003_raced"))).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.skipped.includes("0003_raced"))).toHaveLength(3);

    const { rows } = await pool.query<{ name: string }>(
      `SELECT name FROM ${MIGRATION_LEDGER} WHERE name = '0003_raced'`,
    );
    expect(rows).toHaveLength(1);
  });

  /**
   * A failing step must leave nothing behind — neither its own half-applied
   * objects nor a ledger row claiming it finished. The ledger being the only
   * record of where a run stopped is what makes the next boot resumable.
   */
  test("a failing step is not recorded, and its earlier statements roll back", async () => {
    const steps = [
      {
        name: "0004_broken",
        statements: [`CREATE TABLE half_made (id int)`, `CREATE TABLE half_made (id int)`],
      },
    ];

    await expect(applyMigrations(pool, steps)).rejects.toThrow(MigrationFailed);

    const ledger = await pool.query(`SELECT name FROM ${MIGRATION_LEDGER} WHERE name = '0004_broken'`);
    expect(ledger.rows).toHaveLength(0);

    const table = await pool.query(
      `SELECT to_regclass('public.half_made') IS NOT NULL AS present`,
    );
    expect(table.rows[0]).toEqual({ present: false });
  });

  test("the failure names the step and the statement that broke", async () => {
    const steps = [{ name: "0005_named", statements: [`SELECT 1`, `SELECT * FROM no_such_table`] }];
    const failure = await applyMigrations(pool, steps).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(MigrationFailed);
    const named = failure as MigrationFailed;
    expect(named.step).toBe("0005_named");
    expect(named.statementIndex).toBe(1);
    expect(named.statement).toContain("no_such_table");
  });

  /**
   * `withSchemaLock` covers DDL this repository does not generate — better-auth's,
   * which introspects and then creates with nothing in between. What has to be
   * true is that the second caller does not start until the first has finished.
   */
  test("withSchemaLock serialises callers", async () => {
    const order: string[] = [];
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    const slow = withSchemaLock(pool, async () => {
      order.push("slow:start");
      await sleep(150);
      order.push("slow:end");
    });
    // Long enough that `fast` is definitely queued behind `slow`'s lock rather
    // than merely scheduled after it.
    await sleep(30);
    const fast = withSchemaLock(pool, async () => {
      order.push("fast:start");
      order.push("fast:end");
    });

    await Promise.all([slow, fast]);
    expect(order).toEqual(["slow:start", "slow:end", "fast:start", "fast:end"]);
  });

  /**
   * A holder that never lets go. Without `lock_timeout` every applier behind
   * it waits forever, and from outside that looks like a replica that is
   * still starting. With it, each of the three appliers fails inside the
   * bound with an error that names the lock — the difference between an
   * operator reading "the schema lock is held" and guessing.
   */
  test("a wedged lock holder produces an error that names the schema lock, not a hang", async () => {
    const holder = await pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock($1::bigint)", [String(SCHEMA_LOCK_KEY)]);
      const options = { lockTimeoutMs: 200 };

      const failure = await applyMigrations(
        pool,
        [{ name: "0006_never", statements: [`SELECT 1`] }],
        options,
      ).catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(SchemaLockTimeout);
      expect((failure as Error).message).toContain(String(SCHEMA_LOCK_KEY));
      expect((failure as SchemaLockTimeout).timeoutMs).toBe(200);

      await expect(withSchemaLock(pool, async () => "unreached", options)).rejects.toThrow(
        SchemaLockTimeout,
      );
      await expect(applySchema(pool, options)).rejects.toThrow(SchemaLockTimeout);
    } finally {
      await holder.query("SELECT pg_advisory_unlock($1::bigint)", [String(SCHEMA_LOCK_KEY)]);
      holder.release();
    }

    // The failed attempt recorded nothing and, once the holder is gone, the
    // same step goes through on the next boot.
    const retried = await applyMigrations(pool, [{ name: "0006_never", statements: [`SELECT 1`] }]);
    expect(retried.applied).toEqual(["0006_never"]);
  });

  /**
   * The `IF NOT EXISTS` block can only ever create. This is the path by which a
   * domain table that already exists changes: a plain `ALTER`, appended as a
   * named step, applied once and recorded. The statement is deliberately not
   * idempotent — a second `ADD COLUMN` would fail — so the second run passing
   * proves the ledger, not the SQL, is what makes the replay safe.
   */
  test("a domain migration step is applied once through applySchema and recorded in the ledger", async () => {
    const step = {
      name: "0007_workspaces_note",
      statements: [`ALTER TABLE workspaces ADD COLUMN note text`],
    };

    const first = await applySchema(pool, { migrations: [step] });
    expect(first.applied).toEqual(["0007_workspaces_note"]);

    const second = await applySchema(pool, { migrations: [step] });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["0007_workspaces_note"]);

    const column = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'note'`,
    );
    expect(column.rows).toHaveLength(1);

    const ledger = await pool.query<{ name: string }>(
      `SELECT name FROM ${MIGRATION_LEDGER} WHERE name = '0007_workspaces_note'`,
    );
    expect(ledger.rows).toHaveLength(1);
  });

  /**
   * The production migration list evolves, while the ledger keeps repeat boots
   * idempotent. Assert the actual steps and that a second boot changes nothing.
   */
  test("production migrations apply once and a repeat boot leaves the ledger unchanged", async () => {
    expect(DOMAIN_MIGRATIONS.map((step) => step.name)).toEqual([
      "domain-001-insight-grid-layout", "domain-002-monitor-reliability", "domain-003-ingest-idempotency",
      "domain-004-monitor-delivery-upgrade",
    ]);
    expect(new Set(DOMAIN_MIGRATIONS.map((step) => step.name)).size).toBe(DOMAIN_MIGRATIONS.length);
    const outcome = await applySchema(pool);
    expect(outcome.applied).toEqual(DOMAIN_MIGRATIONS.map((step) => step.name));
    const repeated = await applySchema(pool);
    expect(repeated.applied).toEqual([]);
    expect(repeated.skipped).toEqual(DOMAIN_MIGRATIONS.map((step) => step.name));
    const ledger = await pool.query(`SELECT to_regclass('${MIGRATION_LEDGER}') IS NOT NULL AS present`);
    expect(ledger.rows[0]).toEqual({ present: true });
  });
});
