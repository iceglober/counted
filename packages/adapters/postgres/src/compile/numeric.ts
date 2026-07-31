/**
 * The one numeric-safety helper.
 *
 * v1 had this guard in the aggregate path and *not* in the comparison path:
 * `gt`/`lt` compiled to a bare `(col)::numeric > $n`, so a single row whose
 * property held a non-numeric value raised 22P02 and failed the entire
 * insight — which then rendered as a blank card, because the loader turned
 * every rejection into empty data. One helper, used by both, is the fix.
 *
 * JSONB carries its own types, so the common case needs no regex at all: a
 * property the SDK sent as a number is stored as a JSON number and
 * `jsonb_typeof` says so. The string branch exists because a customer may
 * legitimately send "100", and refusing to read that would be a surprising
 * silent zero.
 */

/** A numeric expression over a JSONB property, or NULL where it is not a number. */
export const numericFromJsonb = (container: string, keyParam: string): string =>
  `CASE
     WHEN jsonb_typeof(${container} -> ${keyParam}) = 'number'
       THEN (${container} ->> ${keyParam})::numeric
     WHEN jsonb_typeof(${container} -> ${keyParam}) = 'string'
      AND (${container} ->> ${keyParam}) ~ '^-?[0-9]+(\\.[0-9]+)?$'
       THEN (${container} ->> ${keyParam})::numeric
   END`;

/** The same guard for a text column, which carries no type information. */
export const numericFromText = (column: string): string =>
  `CASE WHEN ${column} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${column}::numeric END`;
