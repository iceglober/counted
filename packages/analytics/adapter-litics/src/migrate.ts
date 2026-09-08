/**
 * The migration set, and the one table litics needs to exist before it runs.
 *
 * `generateMigrations` emits ordered steps from the config: the schema, the
 * dictionary and the KMV aggregate, the staging table, the segments and
 * summary tables, and — because tenancy has a hierarchy — the closure table
 * plus the triggers that keep it in step with the host table. No extension
 * anywhere: it applies to a stock Postgres.
 *
 * That last part is why step zero exists. litics builds `analytics.org_tree`
 * *from* a table it does not own, and its first migration reads and attaches a
 * trigger to it. If `public.analytics_org` is not there yet, migration one
 * fails on a table that does not exist, which reads like a litics bug and is
 * not one.
 *
 * **Rows in that table are somebody else's job.** A workspace is a root
 * (`parent_id` null); a project is a child of its workspace. Whoever creates
 * one has to write the row in the same transaction, or the project's events
 * arrive with a `tenant_id` the closure table has never heard of and every
 * query for them returns nothing — successfully. `orgUpsert` and `orgRemove`
 * are here so that statement is written once, in the package that owns the
 * table name.
 */

import { diffSchema, expectedSchema, generateMigrations, type ColumnSpec, type MigrationStep } from "@litics/core";
import type { SqlStatement } from "@litics/core";

import { ORG_TABLE, resolved } from "./config";

/**
 * The tenancy host table.
 *
 * Deliberately its own table rather than a view over `workspace` and
 * `project`: litics attaches an `AFTER INSERT/UPDATE/DELETE` trigger to
 * maintain the closure table incrementally, and a view cannot carry one. Ids
 * are `text` because `WorkspaceId` and `ProjectId` are branded strings, not
 * uuids.
 *
 * `ON DELETE CASCADE` on the self-reference means deleting a workspace's row
 * removes its projects' rows, which fires the trigger for each and leaves the
 * closure table consistent.
 */
export const ORG_TABLE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ${ORG_TABLE} (
    id        text PRIMARY KEY,
    parent_id text REFERENCES ${ORG_TABLE}(id) ON DELETE CASCADE
)`,
  `CREATE INDEX IF NOT EXISTS analytics_org_parent ON ${ORG_TABLE} (parent_id)`,
];

/** Every step, in order, including the prerequisite litics does not generate. */
export const analyticsMigrations = (): readonly MigrationStep[] => [
  { name: "0000_counted_analytics_org", statements: [...ORG_TABLE_STATEMENTS] },
  ...generateMigrations(resolved),
];

/**
 * Read every column in the litics schema.
 *
 * Feeds `analyticsSchemaDrift`. Partition children and anything unexpected are
 * ignored by the comparison, so this deliberately selects everything rather
 * than trying to be clever about which tables matter.
 */
export const INTROSPECTION: SqlStatement = {
  sql: `SELECT table_name AS "table", column_name AS "column", udt_name AS udt
          FROM information_schema.columns
         WHERE table_schema = $1`,
  parameters: [resolved.schema],
};

/**
 * Config-versus-database drift, as a list of sentences. Empty means none.
 *
 * Worth running at startup. Migrations do not re-run once executed, so editing
 * the dimension list after the fact leaves the engine reading columns that
 * were never created — and the symptom is a query error on one filter
 * combination rather than anything that looks like a schema problem.
 */
export const analyticsSchemaDrift = (actual: readonly ColumnSpec[]): readonly string[] =>
  diffSchema(resolved, [...actual]);

/** What the config says the schema should contain. */
export const expectedAnalyticsSchema = (): readonly ColumnSpec[] => expectedSchema(resolved);

/**
 * Put a workspace or project into the tenancy tree.
 *
 * Idempotent, and re-parenting is handled: litics' trigger detaches the subtree
 * from its old ancestors and re-attaches it when `parent_id` changes.
 */
export const orgUpsert = (id: string, parent: string | null): SqlStatement => ({
  sql: `INSERT INTO ${ORG_TABLE} (id, parent_id) VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET parent_id = excluded.parent_id`,
  parameters: [id, parent],
});

/** Remove a workspace or project (and, by cascade, its descendants). */
export const orgRemove = (id: string): SqlStatement => ({
  sql: `DELETE FROM ${ORG_TABLE} WHERE id = $1`,
  parameters: [id],
});
