/**
 * Turning rows back into domain values, and refusing rows that are not.
 *
 * A row is untrusted input. It was written by some version of this code, but
 * not necessarily this one, and a column holding `"enterprise"` where the plan
 * catalogue has only `free` and `pro` is a fact about the database that the
 * type annotation on the row interface cannot make untrue. So every closed
 * union that comes out of storage is checked with the *domain's own* predicate
 * — `isPlanId`, `isTileView`, `TileWidth.isValid` — and a row that fails throws
 * `RowDecodeError` naming the table, the column and the id.
 *
 * Throwing, not `Result`. V3-SPEC §9 reserves `Result` for what a caller can
 * cause; nothing a customer types can produce a row this file rejects. What it
 * catches is a bad migration or a hand-edited row, and the useful response to
 * that is a loud failure with the primary key in it, not a `null` the caller
 * renders as "no data".
 */

import { Instant } from "@counted/kernel";

export class RowDecodeError extends Error {
  constructor(
    readonly table: string,
    readonly id: string,
    readonly column: string,
    readonly value: unknown,
  ) {
    super(
      `${table}.${column} holds ${JSON.stringify(value)}, which is not a value this ` +
        `version understands (row ${JSON.stringify(id)})`,
    );
    this.name = "RowDecodeError";
  }
}

/** Where a bad value was found. Every decode failure carries one. */
export type Column = { readonly table: string; readonly id: string; readonly column: string };

/**
 * Narrow a text column with the domain's own predicate.
 *
 * Deliberately the domain's and not a copy: `isPlanId` lives beside the plan
 * catalogue, so adding a plan makes this accept it with no second list to
 * update. A `CHECK` constraint in the DDL would have been that second list.
 */
export const decodeText = <T extends string>(
  raw: unknown,
  guard: (value: string) => value is T,
  where: Column,
): T => {
  if (typeof raw !== "string" || !guard(raw)) {
    throw new RowDecodeError(where.table, where.id, where.column, raw);
  }
  return raw;
};

export const decodeNumeric = <T extends number>(
  raw: unknown,
  guard: (value: number) => value is T,
  where: Column,
): T => {
  if (typeof raw !== "number" || !guard(raw)) {
    throw new RowDecodeError(where.table, where.id, where.column, raw);
  }
  return raw;
};

/**
 * `timestamptz` arrives from `pg` as a `Date`, which is the one conversion this
 * package does in both directions. Storing epoch millis in a bigint would avoid
 * it and make every timestamp unreadable in psql; a timestamp you cannot read
 * during an incident is a bad trade for a conversion the driver already does.
 */
export const instantOf = (value: Date): Instant => Instant.fromDate(value);

export const optionalInstant = (value: Date | null): Instant | null =>
  value === null ? null : Instant.fromDate(value);

export const timestampOf = (value: Instant): Date => Instant.toDate(value);

export const optionalTimestamp = (value: Instant | null): Date | null =>
  value === null ? null : Instant.toDate(value);

/**
 * `bigint` columns arrive as strings, because a Postgres bigint does not fit in
 * a JS number and `pg` refuses to lose the difference silently. Every bigint
 * this package writes is a duration in milliseconds, which is far inside the
 * safe range, so the parse is exact — but it has to be an explicit parse, and a
 * column that ever grows beyond `Number.MAX_SAFE_INTEGER` has to stop coming
 * through here.
 */
export const millisOf = (raw: string, where: { table: string; id: string; column: string }): number => {
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new RowDecodeError(where.table, where.id, where.column, raw);
  }
  return parsed;
};

/**
 * How an opaque analysis crosses the storage boundary.
 *
 * `Tile<A>` and `Monitor<A>` are generic in the analytics context's Analysis IR
 * because `no-cross-context-domain` forbids dashboarding from importing it
 * (V3-SPEC §7), and this package is below the composition root that closes `A`.
 * So the analysis arrives here as a value with a codec attached, which is also
 * the only honest place to *validate* it: the composition root has the Zod
 * schema, this package has the rows.
 */
export type AnalysisCodec<A> = {
  /** Must return something `JSON.stringify` round-trips. */
  encode(analysis: A): unknown;
  /** Throws if the stored JSON is not an analysis this version understands. */
  decode(raw: unknown): A;
};

/**
 * A codec that checks nothing.
 *
 * Useful in a test that treats the analysis as an opaque blob, and wrong in
 * production: it will hand the domain whatever JSON is in the column, including
 * a shape written by a version that had different fields. The composition root
 * should build a codec from `AnalysisSchema` in `@counted/contract` — that is
 * the layer that may import both, and the failure it prevents is a tile whose
 * analysis silently lost a field rendering as an empty chart instead of an
 * error.
 */
export const unvalidatedAnalysisCodec = <A>(): AnalysisCodec<A> => ({
  encode: (analysis) => analysis as unknown,
  decode: (raw) => raw as A,
});
