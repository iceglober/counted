/**
 * Standing a real Postgres up for the suites in this package.
 *
 * These tests run against a database, deliberately. An in-memory fake of a
 * repository proves the fake works; every defect this package exists to prevent
 * — an `UPDATE` that matches nothing and reports success, two `CREATE TABLE IF
 * NOT EXISTS` racing, a partial unique index that disagrees with the query
 * beside it — lives in the part a fake replaces.
 *
 * The database is the one `docker-compose.yml` starts. When it is not running
 * the suites **skip rather than fail**, because a contributor without Docker
 * should still be able to run `bun test` and get a useful answer about
 * everything else. `describeLive` is the switch, and it says which it did.
 */

import { describe } from "bun:test";
import { Pool } from "pg";
import { applySchema, DOMAIN_TABLES } from "./schema";

// The local compose database unless COUNTED_TEST_DATABASE_URL says otherwise.
// Deliberately not DATABASE_URL: Bun loads .env.local for anything run from
// the repository root, and a hosted URL left there must never be the one a
// live suite creates and drops databases in.
const ADMIN_URL = process.env["COUNTED_TEST_DATABASE_URL"] ?? "postgres://counted:counted@127.0.0.1:5434/counted";

/**
 * A database of its own, so a run cannot truncate a developer's dev data. The
 * name is fixed rather than random: a crashed run leaves it behind, and the
 * next run reuses it instead of accumulating one database per crash.
 */
const TEST_DATABASE = "counted_adapter_test";

const testUrl = (): string => {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DATABASE}`;
  return url.toString();
};

const reachable = async (): Promise<boolean> => {
  const pool = new Pool({ connectionString: ADMIN_URL, connectionTimeoutMillis: 1_500, max: 1 });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
};

export const databaseAvailable = await reachable();

// A live suite that skips because the database was unreachable turns "CI's
// database was down" into a green build. CI sets REQUIRE_DB=1 so that outcome
// is a failure with a reason, never a skip.
if (!databaseAvailable && process.env["REQUIRE_DB"] === "1") {
  throw new Error(
    `REQUIRE_DB=1 but no database is reachable at ${ADMIN_URL.replace(/:[^:@/]+@/, ":***@")}`,
  );
}

/**
 * `describe` when a database is there, `describe.skip` when it is not. Import
 * this instead of `describe` in every suite below.
 */
export const describeLive = databaseAvailable ? describe : describe.skip;

let shared: Pool | null = null;

/**
 * The pool every suite shares, with the schema applied. Created once per
 * process — Bun runs test files one at a time, so a single database with the
 * tables truncated between tests is both safe and much faster than a database
 * per file.
 */
export const liveDatabase = async (): Promise<Pool> => {
  if (shared !== null) return shared;

  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  try {
    await admin.query(`CREATE DATABASE ${TEST_DATABASE}`);
  } catch (cause) {
    // 42P04 is duplicate_database: someone got here first, or a previous run
    // did. Anything else is a real problem and must not be swallowed.
    if ((cause as { code?: string }).code !== "42P04") throw cause;
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: testUrl(), max: 8 });
  await applySchema(pool);
  await pool.query(TENANCY_HOST_TABLE);
  shared = pool;
  return pool;
};

/**
 * The analytics tenancy host table, as litics' migration would create it.
 *
 * Restated rather than imported: `@counted/analytics-adapter-litics` owns the
 * real one and this package may not know litics exists. What the suites here
 * need is a table for the injected `TenancyTree` to write into, so that the
 * statements are proven to run on the transaction's connection and to roll
 * back with it — which is the part `noTenancyTree` would silently skip.
 */
const TENANCY_HOST_TABLE = `CREATE TABLE IF NOT EXISTS analytics_org (
  id        text PRIMARY KEY,
  parent_id text REFERENCES analytics_org(id) ON DELETE CASCADE
)`;

/** Empty every table this package owns, in one statement so order is Postgres'. */
export const resetDatabase = async (pool: Pool): Promise<void> => {
  await pool.query(
    `TRUNCATE ${[...DOMAIN_TABLES, "analytics_org"].join(", ")} RESTART IDENTITY CASCADE`,
  );
};

export const closeDatabase = async (): Promise<void> => {
  if (shared === null) return;
  const pool = shared;
  shared = null;
  await pool.end();
};
