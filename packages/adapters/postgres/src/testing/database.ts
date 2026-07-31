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

/** Create a throwaway database and return a pool on it. */
export const createDatabase = async (name: string): Promise<LiveDatabase> => {
  const admin = new Pool({ connectionString: adminUrl(), connectionTimeoutMillis: 2_000 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const url = databaseUrl(name);
  return {
    pool: new Pool({ connectionString: url }),
    url,
    drop: async () => {
      const a = new Pool({ connectionString: adminUrl(), connectionTimeoutMillis: 2_000 });
      try {
        await a.query(`DROP DATABASE IF EXISTS ${name}`);
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
