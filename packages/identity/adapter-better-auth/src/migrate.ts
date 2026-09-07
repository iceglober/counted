/**
 * better-auth's own schema, applied from better-auth's own generator.
 *
 * The configured tables — `user`, `session`, `account`, `verification`, plus
 * `organization`/`member`/`invitation` from the organization plugin, `apikey`,
 * `jwks` and the OAuth provider tables — and not one of them is written down
 * in this repository. That is the point: hand-writing DDL for a library that
 * generates its own is a second description of the same tables, and the copy
 * drifts the first time the library adds a column.
 *
 * `getMigrations` diffs the live database against the schema the *configured
 * instance* implies, so plugins, additional fields and `countedPlacement`'s
 * extra columns are all included, and a second run finds nothing to do.
 *
 * ### The schema is chosen by `search_path`, and nothing else
 *
 * better-auth 1.7's Kysely path builds `db.schema.createTable("user")` —
 * unqualified — and reads the target schema back with `SHOW search_path`
 * (`getPostgresSchema`, `dist/db/get-migration.mjs`). There is no schema
 * option. So `auth.user` versus `public.user` is decided entirely by the
 * connection the pool hands out, which means the composition root has to
 * configure the pool it passes in `IdentityDatabase` with
 * `options: "-c search_path=auth,public"` — see `apps/api/src/main.ts`.
 *
 * Getting that wrong is silent in the worst way: the tables are created in
 * `public`, better-auth finds them there afterwards, everything works, and the
 * one query that reads the member table by its qualified name comes back
 * empty. `migrateIdentity` therefore reports the schema it actually wrote to,
 * so the caller can refuse rather than discover it later.
 *
 * ### Why this refuses an unsafe change instead of making it
 *
 * `throwOnUnsafe` is left on. better-auth calls a change unsafe when it cannot
 * add a column without a rewrite that could lose data — narrowing a type,
 * making an existing nullable column `NOT NULL` over rows that hold nulls. At
 * boot, on a database with customers in it, the honest answer is to stop and
 * say so; the alternative is a start-up that silently truncates.
 */

import { getMigrations } from "better-auth/db/migration";
import type { IdentityConfig } from "./config";
import { createIdentityAuth } from "./auth";

export type IdentityMigrationOutcome = {
  /** The Postgres schema the tables were created in, read from `search_path`. */
  readonly schema: string;
  /** Tables created by this run. Empty on a second run — that is the no-op. */
  readonly created: readonly string[];
  /** `<table>.<column>` for each column added to a table that already existed. */
  readonly altered: readonly string[];
};

/**
 * `memory` is not a deployment mode (see `IdentityDatabase`), and better-auth's
 * memory adapter has no migrations — its tables are seeded from
 * `getSchema(options)` when the instance is built. Calling this against one is
 * a wiring mistake, not a runtime condition, so it says so.
 */
export class IdentityMigrationUnsupported extends Error {
  constructor() {
    super("migrateIdentity needs a postgres IdentityDatabase; the memory adapter has no migrations");
    this.name = "IdentityMigrationUnsupported";
  }
}

export const migrateIdentity = async (
  config: IdentityConfig,
): Promise<IdentityMigrationOutcome> => {
  if (config.database.kind !== "postgres") throw new IdentityMigrationUnsupported();

  const auth = createIdentityAuth(config);
  const context = await auth.auth.$context;
  const plan = await getMigrations(context.options);
  await plan.runMigrations();

  // Earlier v3 builds used the vendor's request metadata defaults. Remove
  // those values without ending sessions; new writes are cleared by the
  // session hooks. The obsolete auth limiter table may not exist on fresh
  // installs now that its address keys live only in process memory.
  await config.database.pool.query(`
    DO $$ DECLARE identity_schema text := current_schema(); BEGIN
      EXECUTE format(
        'UPDATE %I.%I SET "ipAddress" = NULL, "userAgent" = NULL
         WHERE "ipAddress" IS NOT NULL OR "userAgent" IS NOT NULL',
        identity_schema, 'session'
      );
      IF to_regclass(format('%I.%I', identity_schema, 'rateLimit')) IS NOT NULL THEN
        EXECUTE format('DELETE FROM %I.%I', identity_schema, 'rateLimit');
      END IF;
    END $$;
  `);

  const schemaRow = await config.database.pool.query<{ schema: string }>(
    "SELECT current_schema() AS schema",
  );

  return {
    schema: schemaRow.rows[0]?.schema ?? "public",
    created: plan.toBeCreated.map((table: { table: string }) => table.table),
    altered: plan.toBeAdded.flatMap((table: { table: string; fields: Record<string, unknown> }) =>
      Object.keys(table.fields).map((field) => `${table.table}.${field}`),
    ),
  };
};
