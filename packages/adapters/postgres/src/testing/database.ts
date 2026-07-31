/**
 * Test database plumbing, shared by every live suite.
 *
 * This exists because the first version hardcoded `localhost:5434` in each
 * file while taking the admin URL from an env var. Pointing the suite at a
 * different host then created the databases in one place and looked for them
 * in another — which surfaced only when the whole point was to run against a
 * *different* Postgres. One source for the host, derived per database.
 */

import { Pool } from "pg";

export const adminUrl = (): string =>
  process.env["TEST_ADMIN_URL"] ?? "postgres://counted:counted@localhost:5434/postgres";

/** The admin URL with its database swapped, so host and credentials cannot drift. */
export const databaseUrl = (name: string): string => {
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  return url.toString();
};

export type LiveDatabase = {
  readonly pool: Pool;
  readonly url: string;
  drop(): Promise<void>;
};

/**
 * `DROP DATABASE` blocks while any session is connected, and a live suite that
 * was interrupted — a timeout, a killed run — leaves one behind. So the drop
 * evicts whatever is still attached first.
 *
 * That matters more than tidiness, and the reason is worth recording because the
 * symptom does not name its own cause. The dev image used to be TimescaleDB,
 * which starts a background worker **per database**, so every undropped test
 * database permanently cost one of `max_connections` (25 by default). Eleven
 * leftovers had taken eleven of them, and what that looked like was not "out of
 * connections" — it was twenty-one live tests failing on a five-second
 * `beforeEach` timeout, which reads like a slow machine rather than a leak.
 *
 * `docker-compose.yml` is stock Postgres now, so the per-database worker is
 * gone. Evicting sessions before the drop is not: a run interrupted mid-test
 * still leaves a connected session behind, and `DROP DATABASE` waits on it
 * forever.
 */
const dropDatabase = async (admin: Pool, name: string): Promise<void> => {
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [name],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
};

/** Create a throwaway database and return a pool on it. */
export const createDatabase = async (name: string): Promise<LiveDatabase> => {
  const admin = new Pool({ connectionString: adminUrl(), connectionTimeoutMillis: 2_000 });
  try {
    await dropDatabase(admin, name);
    await admin.query(`CREATE DATABASE ${name}`);
  } catch (error) {
    // 53300 is `too_many_connections`. Left as-is it arrives as a hook timeout
    // in whichever test happened to run first, which points at that test rather
    // than at the server — the diagnosis that cost an hour the first time.
    if ((error as { code?: string }).code === "53300") {
      throw new Error(
        `Postgres refused a connection for test database "${name}": the server is out of connections. ` +
          `The suite runs its files concurrently and each one takes a database and a pool, so a server left ` +
          `at the built-in \`max_connections\` of 25 cannot hold a full run — docker-compose.yml sets 200. ` +
          `Check with \`show max_connections\`, and list leftover databases from interrupted runs with ` +
          `\`select datname from pg_database\`, dropping any that are not "counted".`,
      );
    }
    throw error;
  } finally {
    await admin.end();
  }

  const url = databaseUrl(name);
  return {
    // Bounded: bun runs test files concurrently and each file may hold one of
    // these, so the default (10 per pool) multiplies into the server's limit.
    // No live suite here needs more than a handful at once.
    pool: new Pool({ connectionString: url, max: 4 }),
    url,
    drop: async () => {
      const a = new Pool({ connectionString: adminUrl(), connectionTimeoutMillis: 2_000 });
      try {
        await dropDatabase(a, name);
      } catch {
        /* best effort */
      } finally {
        await a.end();
      }
    },
  };
};

/**
 * A test that needs a database: skips when none is reachable, fails loudly
 * when REQUIRE_DB=1. A guard that silently passes turns "the database was
 * unreachable in CI" into a green build.
 */
export const guard = (state: { reachable: boolean; reason: string }) =>
  async (fn: () => Promise<void>): Promise<void> => {
    if (!state.reachable) {
      if (process.env["REQUIRE_DB"] === "1") {
        throw new Error(`REQUIRE_DB=1 but no database was reachable: ${state.reason}`);
      }
      return;
    }
    await fn();
  };
