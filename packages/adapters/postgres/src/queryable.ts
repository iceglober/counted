/**
 * The one seam between this package and `pg`.
 *
 * Every repository here takes a `Queryable` rather than a `Pool`, which is what
 * lets the same class serve a pooled read and a transactional write. A
 * `PoolClient` inside `BEGIN … COMMIT` and the `Pool` itself both satisfy it,
 * so `UnitOfWork.transact` builds the identical repositories bound to a
 * checked-out client and nothing else changes.
 *
 * The failure this prevents is the one v1 shipped: `pool.query("DELETE FROM
 * events …")` inside a use case that was already holding a transaction on a
 * different connection, so the delete committed on its own and the rollback
 * around it rolled back nothing. If a repository cannot reach a pool, it cannot
 * escape the transaction it was handed.
 */

import type { QueryResult, QueryResultRow } from "pg";

export type Queryable = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

/** Rows of a query, typed. Shorthand used by every repository below. */
export const rows = async <R extends QueryResultRow>(
  db: Queryable,
  text: string,
  values: unknown[] = [],
): Promise<R[]> => (await db.query<R>(text, values)).rows;

/** The first row, or null. `find` never throws for absence (V3-SPEC §9). */
export const firstRow = async <R extends QueryResultRow>(
  db: Queryable,
  text: string,
  values: unknown[] = [],
): Promise<R | null> => (await rows<R>(db, text, values))[0] ?? null;

/** A statement run for its effect. Returns how many rows it touched. */
export const exec = async (
  db: Queryable,
  text: string,
  values: unknown[] = [],
): Promise<number> => (await db.query(text, values)).rowCount ?? 0;
