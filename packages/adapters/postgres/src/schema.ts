/**
 * The schema, applied at boot, idempotent, and serialised across replicas.
 *
 * **The advisory lock is the point.** `CREATE TABLE IF NOT EXISTS` is not safe
 * to run concurrently: two connections that both find the table missing both
 * proceed, and the loser fails inside `pg_type` with
 * `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`
 * — an error that names a catalogue index and mentions neither the table nor
 * the fact that another process was starting. v2 applied its DDL at boot with
 * no lock at all, so two API replicas rolling at once could take each other
 * down at start-up and the log said nothing useful. Here every applier takes
 * one transaction-scoped advisory lock first, so the second one waits and then
 * finds everything already made.
 *
 * The lock is transaction-scoped (`pg_advisory_xact_lock`) rather than
 * session-scoped so a crashed applier cannot leave it held. Postgres DDL is
 * transactional, so the whole migration is one atomic unit as well: it either
 * fully applies or leaves the database exactly as it was.
 *
 * **Two phases, one lock key.** First the statements below, `IF NOT EXISTS`
 * throughout, in one transaction. Then `DOMAIN_MIGRATIONS` through the
 * ledgered runner in `migrations.ts` — the path by which a table that already
 * exists can change, since `IF NOT EXISTS` can only ever create. Both phases
 * take the lock defined in `schema-lock.ts`, which also bounds the wait so a
 * replica queued behind a wedged holder fails by name instead of hanging.
 *
 * **One database, three schemas.** `public` is the domain's — every table
 * below. `auth` is better-auth's and `analytics` is litics'. A schema is a
 * namespace, not isolation: all three live in one database precisely so a
 * single transaction can span them.
 *
 * Exactly one of the two foreign namespaces is created here, and the asymmetry
 * is a fact about the tools rather than a preference. better-auth 1.7 creates
 * its tables unqualified into whatever `search_path` names and never creates a
 * schema — point it at a missing one and it logs
 * `Schema 'auth' does not exist` and writes into `public` instead, which
 * succeeds, works, and puts every identity table in the wrong place. So `auth`
 * has to exist first. litics generates `CREATE SCHEMA IF NOT EXISTS analytics`
 * (and `partman`) as the first statements of its own first migration, so
 * creating it here as well would be a second opinion about a namespace
 * somebody else owns — and the earlier version of this file named `events`,
 * litics' *default* schema rather than the one `@counted/analytics-adapter-litics`
 * configures, leaving a schema that was created on every boot and never held a
 * table.
 *
 * **What is a database constraint and what is not.** Constraints here are the
 * relational facts storage owns: keys, references, and the exclusivity of the
 * two ownership states a project can be in. What a *plan* may be called, what
 * widths a tile may have, which comparisons a threshold supports — those are
 * the domain's vocabulary and are checked when a row is decoded, not by a
 * `CHECK` that would be a second copy of the catalogue drifting behind the
 * first. v1 kept `PLANS` in the Stripe adapter and answered "is this customer
 * on Pro?" three ways; a CHECK constraint listing plan ids would be a fourth.
 */

import type { Pool } from "pg";

import { applyMigrations, type MigrationOutcome, type MigrationStep } from "./migrations";
import { acquireSchemaLock, type SchemaLockOptions } from "./schema-lock";
import { assertCompatibleSchema } from "./schema-compatibility";

/**
 * Ordered, idempotent, and one statement per entry so a failure names the
 * statement that failed rather than a 200-line string.
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE SCHEMA IF NOT EXISTS auth`,

  `CREATE TABLE IF NOT EXISTS workspaces (
     id            text PRIMARY KEY,
     name          text NOT NULL,
     plan          text NOT NULL,
     payment_state text NOT NULL,
     created_at    timestamptz NOT NULL DEFAULT now(),
     updated_at    timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
     workspace_id     text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
     plan             text NOT NULL,
     payment_state    text NOT NULL,
     customer_ref     text UNIQUE,
     subscription_ref text UNIQUE,
     renews_at        timestamptz,
     updated_at       timestamptz NOT NULL
   )`,

  /*
   * A project is either claimed by a workspace or holds an unexpired claim
   * grant. The CHECK writes that exclusivity down, because "unclaimed" is a
   * lifecycle state with rules and not the absence of a workspace id — v1
   * modelled it as a nullable claim token and the link then never expired for
   * any project that had events.
   */
  `CREATE TABLE IF NOT EXISTS projects (
     id               text PRIMARY KEY,
     workspace_id     text REFERENCES workspaces(id) ON DELETE CASCADE,
     name             text NOT NULL,
     archived         boolean NOT NULL DEFAULT false,
     claimed_at       timestamptz,
     claim_digest     text,
     claim_expires_at timestamptz,
     retention_days   integer,
     created_at       timestamptz NOT NULL DEFAULT now(),
     updated_at       timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT projects_ownership_is_exclusive CHECK (
       (workspace_id IS NOT NULL AND claimed_at IS NOT NULL
          AND claim_digest IS NULL AND claim_expires_at IS NULL)
       OR
       (workspace_id IS NULL AND claimed_at IS NULL
          AND claim_digest IS NOT NULL AND claim_expires_at IS NOT NULL)
     ),
     CONSTRAINT projects_retention_is_whole_days CHECK (retention_days IS NULL OR retention_days >= 1)
   )`,
  `CREATE INDEX IF NOT EXISTS projects_by_workspace ON projects (workspace_id) WHERE workspace_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS projects_claim_digest ON projects (claim_digest) WHERE claim_digest IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS dashboards (
     id                 text PRIMARY KEY,
     workspace_id       text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     name               text NOT NULL,
     is_default         boolean NOT NULL DEFAULT false,
     share_digest       text,
     share_expires_at   timestamptz,
     created_at         timestamptz NOT NULL DEFAULT now(),
     updated_at         timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT dashboards_share_is_whole CHECK ((share_digest IS NULL) = (share_expires_at IS NULL))
   )`,
  /*
   * At most one default per WORKSPACE. v1 had a partial unique index enforcing
   * one default per *user* while the loader resolved the default per *project*,
   * so the constraint and the query disagreed about what "default" meant. This
   * index and `findDefault` below read the same column with the same scope.
   */
  `CREATE UNIQUE INDEX IF NOT EXISTS dashboards_one_default_per_workspace
     ON dashboards (workspace_id) WHERE is_default`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dashboards_share_digest
     ON dashboards (share_digest) WHERE share_digest IS NOT NULL`,

  /*
   * Tiles are rows, not a JSON blob on the dashboard, for one reason:
   * `projectsReadBy` is a `SELECT DISTINCT project_id` over this table, and a
   * share grant's binding is derived from exactly that set. A blob would make
   * the authorization boundary something the application has to parse before it
   * can check it.
   *
   * `position` is the flow order — tiles pack left to right and wrap. Deleting
   * the project a tile reads deletes the tile: a tile whose project is gone can
   * never render, and the alternative is v1's dangling `dashboard.projectId ??
   * ""` reaching a uuid parameter.
   */
  `CREATE TABLE IF NOT EXISTS dashboard_tiles (
     dashboard_id text NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
     id           text NOT NULL,
     position     integer NOT NULL,
     title        text NOT NULL,
     project_id   text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     analysis     jsonb NOT NULL,
     view         text NOT NULL,
     width        smallint NOT NULL,
     PRIMARY KEY (dashboard_id, id),
     CONSTRAINT dashboard_tiles_position_is_unique UNIQUE (dashboard_id, position)
   )`,
  `CREATE INDEX IF NOT EXISTS dashboard_tiles_by_project ON dashboard_tiles (project_id)`,

  `CREATE TABLE IF NOT EXISTS monitors (
     id                   text PRIMARY KEY,
     workspace_id         text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     project_id           text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     name                 text NOT NULL,
     analysis             jsonb NOT NULL,
     threshold_comparison text NOT NULL,
     threshold_value      double precision NOT NULL,
     cooldown_ms          bigint NOT NULL,
     channels             jsonb NOT NULL DEFAULT '[]'::jsonb,
     enabled              boolean NOT NULL,
     state                text NOT NULL,
     last_notified_at     timestamptz,
     last_value           double precision,
     created_at           timestamptz NOT NULL DEFAULT now(),
     updated_at           timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT monitors_cooldown_is_not_negative CHECK (cooldown_ms >= 0)
   )`,
  `CREATE INDEX IF NOT EXISTS monitors_by_project ON monitors (project_id)`,
  `CREATE INDEX IF NOT EXISTS monitors_by_workspace ON monitors (workspace_id)`,
  /*
   * The worker's sweep is `listEnabled`, ordered by who has waited longest.
   * Indexing the ordering columns and not just `enabled` is what stops that
   * sweep degrading into a sort of every monitor in the system.
   */
  `CREATE INDEX IF NOT EXISTS monitors_due ON monitors (last_notified_at NULLS FIRST, id) WHERE enabled`,

  /*
   * The outbox. Written in the same transaction as the aggregate that produced
   * the event, dispatched later — which is what makes "the change happened but
   * the email did not" recoverable rather than lost.
   *
   * `claimed_at` is a lease, not a flag: a worker that dies mid-dispatch leaves
   * a row claimed forever unless the claim can time out, and a dead worker's
   * events are exactly the ones nobody notices are missing.
   */
  `CREATE TABLE IF NOT EXISTS outbox (
     id            text PRIMARY KEY,
     type          text NOT NULL,
     occurred_at   timestamptz NOT NULL,
     payload       jsonb NOT NULL,
     enqueued_at   timestamptz NOT NULL DEFAULT now(),
     claimed_at    timestamptz,
     dispatched_at timestamptz,
     attempts      integer NOT NULL DEFAULT 0,
     last_error    text,
     last_failed_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (occurred_at, id) WHERE dispatched_at IS NULL`,

  /*
   * Webhook receipts. The primary key IS the deduplication: `claim` is an
   * INSERT … ON CONFLICT DO NOTHING, so a redelivered provider event loses the
   * race in the database rather than in a check-then-act the application does
   * a moment before it writes.
   */
  `CREATE TABLE IF NOT EXISTS webhook_receipts (
     id           text PRIMARY KEY,
     type         text NOT NULL,
     received_at  timestamptz NOT NULL,
     processed_at timestamptz
   )`,
];

/**
 * Changes to domain tables that already exist.
 *
 * `SCHEMA_STATEMENTS` is `IF NOT EXISTS` throughout, which is what lets it
 * replay on every boot — and is also why it can never change a table that is
 * already there. A column added to a `CREATE TABLE` above appears on a fresh
 * database and is silently absent from every existing one, and the first sign
 * is a query failing in production against a schema the tests never saw.
 *
 * So any change to an existing domain table is appended here as a named step
 * and applied once, in order, through the same ledger litics' steps use
 * (`public.schema_migrations`). Name a step `NNNN_what_it_does`, write the
 * `ALTER` plainly (no `IF NOT EXISTS` — the ledger is the idempotency), and
 * update the `CREATE TABLE` above to match so a fresh database and a migrated
 * one end up identical. Never edit or reorder a step that has shipped: the
 * ledger records names, not contents, so a changed step is a step that will
 * never run where it matters.
 */
export const DOMAIN_MIGRATIONS: readonly MigrationStep[] = [{
  name: "domain-001-insight-grid-layout",
  statements: ["ALTER TABLE dashboard_tiles ADD COLUMN grid_layout jsonb"],
}, {
  name: "domain-002-monitor-reliability",
  statements: [
    `ALTER TABLE monitors
       ADD COLUMN last_attempt_at timestamptz,
       ADD COLUMN last_measured_at timestamptz,
       ADD COLUMN evaluation_error text,
       ADD COLUMN evaluation_claimed_until timestamptz`,
    `DROP INDEX IF EXISTS monitors_due`,
    `CREATE INDEX monitors_due ON monitors (last_attempt_at NULLS FIRST, id) WHERE enabled`,
    `CREATE TABLE monitor_deliveries (
       id text PRIMARY KEY,
       monitor_id text NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
       alert jsonb NOT NULL,
       occurred_at timestamptz NOT NULL,
       next_attempt_at timestamptz NOT NULL,
       claimed_at timestamptz,
       delivered_at timestamptz,
       canceled_at timestamptz,
       attempts integer NOT NULL DEFAULT 0,
       last_error text
     )`,
    `CREATE INDEX monitor_deliveries_due ON monitor_deliveries (next_attempt_at, occurred_at, id)
       WHERE delivered_at IS NULL`,
    `CREATE INDEX monitor_deliveries_by_monitor ON monitor_deliveries (monitor_id, occurred_at)`,
  ],
}, {
  name: "domain-003-ingest-idempotency",
  statements: [
    `CREATE TABLE ingest_receipts (
       project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       key_digest bytea NOT NULL,
       PRIMARY KEY (project_id, key_digest)
     )`,
  ],
}, {
  name: "domain-004-monitor-delivery-upgrade",
  // Some installations applied the initial monitor queue before cancellation
  // and lease fencing were added. The ledger records names, not DDL content:
  // repair those installations with a new step, without replaying domain-002.
  // IF NOT EXISTS also admits databases created with its complete definition.
  statements: [
    `ALTER TABLE monitors
       ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
       ADD COLUMN IF NOT EXISTS last_measured_at timestamptz,
       ADD COLUMN IF NOT EXISTS evaluation_error text,
       ADD COLUMN IF NOT EXISTS evaluation_claimed_until timestamptz`,
    `ALTER TABLE monitor_deliveries
       ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
       ADD COLUMN IF NOT EXISTS canceled_at timestamptz`,
    `DROP INDEX IF EXISTS monitors_due`,
    `CREATE INDEX monitors_due ON monitors (last_attempt_at NULLS FIRST, id) WHERE enabled`,
    `DROP INDEX IF EXISTS monitor_deliveries_due`,
    `CREATE INDEX monitor_deliveries_due ON monitor_deliveries (next_attempt_at, occurred_at, id)
       WHERE delivered_at IS NULL AND canceled_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS monitor_deliveries_by_monitor ON monitor_deliveries (monitor_id, occurred_at)`,
  ],
}];

export type ApplySchemaOptions = SchemaLockOptions & {
  /** The steps to run after the `IF NOT EXISTS` block. `DOMAIN_MIGRATIONS` unless a test says otherwise. */
  readonly migrations?: readonly MigrationStep[];
};

/**
 * Create everything that is missing, then apply any domain migration not yet
 * recorded. Safe to run on every boot, on every replica, at the same time.
 *
 * Takes a `Pool` rather than a `Queryable` on purpose: this needs one dedicated
 * connection for the whole transaction, and handing it a pool-level `query`
 * would spread the statements across connections and drop the lock between
 * them.
 *
 * The lock is released between the two phases rather than held across them,
 * because the runner takes it per step on a connection of its own and an
 * applier that held it here as well would deadlock against itself. Nothing is
 * lost by that: a replica that slips in between finds the `IF NOT EXISTS`
 * phase complete and the ledger telling it what is left.
 */
export const applySchema = async (
  pool: Pool,
  options: ApplySchemaOptions = {},
): Promise<MigrationOutcome> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Everything after this waits for whoever got here first, and is released
    // by COMMIT or ROLLBACK — including the ROLLBACK an unhandled crash causes
    // when the connection drops.
    await acquireSchemaLock(client, options);
    await assertCompatibleSchema(client);
    for (const statement of SCHEMA_STATEMENTS) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (cause) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw cause;
  } finally {
    client.release();
  }

  return applyMigrations(pool, options.migrations ?? DOMAIN_MIGRATIONS, options);
};

/** Every table this package owns, child tables first. Used by tests to reset. */
export const DOMAIN_TABLES: readonly string[] = [
  "ingest_receipts",
  "dashboard_tiles",
  "dashboards",
  "monitor_deliveries",
  "monitors",
  "outbox",
  "webhook_receipts",
  "subscriptions",
  "projects",
  "workspaces",
];
