/**
 * The analytics engine's copy of "which workspace does this project belong to".
 *
 * litics scopes every query through a closure table it maintains by trigger
 * from a host table of its own — `public.analytics_org`, one row per workspace
 * (no parent) and one per project (parent = its workspace). The tenant filter
 * it emits is
 *
 *     tenant_id IN (SELECT descendant FROM analytics.org_tree WHERE ancestor = $1)
 *
 * for a **project** scope as well as a workspace one. So a project with no row
 * in that table is not merely un-aggregatable at workspace level: every query
 * about it returns zero rows, successfully, forever. Events land, the ingest
 * route answers 202, and every chart reads nought.
 *
 * That is exactly the state this repository package shipped in — nothing wrote
 * the table at all — and it is invisible to unit tests, to `tsc` and to
 * dependency-cruiser, because the only thing that disagrees is a `SELECT` in
 * generated SQL.
 *
 * The statements are injected rather than written here for one reason: the
 * table's name and shape belong to `@counted/analytics-adapter-litics`, which
 * is the only package allowed to know litics exists. This is the same seam
 * `WorkspaceMemberships` uses — the composition root states the fact, the
 * repository runs it on the connection it is already holding, inside the
 * transaction that writes the aggregate.
 */

/** A statement with its parameters. Structurally litics' `SqlStatement`. */
export type TenancyStatement = {
  readonly sql: string;
  readonly parameters: readonly unknown[];
};

export type TenancyTree = {
  /** Put a workspace (`parent` null) or a project into the tree. Idempotent. */
  place(id: string, parent: string | null): TenancyStatement;
  /** Take one out, with its descendants. */
  remove(id: string): TenancyStatement;
};

/**
 * A tree that records nothing.
 *
 * For a deployment or a test with no analytics engine behind it. Naming it is
 * the point: choosing this is a decision somebody made, whereas an optional
 * field left off is a decision nobody noticed — and the symptom of the second
 * one is a product where every number is zero.
 */
export const noTenancyTree: TenancyTree = {
  place: () => ({ sql: "SELECT 1 WHERE false", parameters: [] }),
  remove: () => ({ sql: "SELECT 1 WHERE false", parameters: [] }),
};
