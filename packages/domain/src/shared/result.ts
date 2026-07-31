/**
 * Result — an explicit success-or-failure value.
 *
 * The domain does not throw for expected failures. A rule that can be broken
 * returns `Result`, so the caller has to say what happens when it is.
 *
 * This type is also the reason `emptyData()` cannot come back. A `Result` has
 * no zero value: there is no way to "render nothing" without first deciding,
 * in code, that you are looking at an `Err`.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

/** Transform the success value; an Err passes through untouched. */
export const map = <T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> =>
  r.ok ? ok(f(r.value)) : r;

/** Transform the error; an Ok passes through untouched. */
export const mapErr = <T, E, F>(r: Result<T, E>, f: (error: E) => F): Result<T, F> =>
  r.ok ? r : err(f(r.error));

/** Chain a fallible step. The first Err short-circuits. */
export const flatMap = <T, U, E>(
  r: Result<T, E>,
  f: (value: T) => Result<U, E>,
): Result<U, E> => (r.ok ? f(r.value) : r);

/** Read the value, supplying a fallback for the Err case. */
export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T =>
  r.ok ? r.value : fallback;

/**
 * Collect many Results into one. Returns the first Err, or all the values in
 * order. Useful for validating a batch where any single failure fails the whole.
 */
export const all = <T, E>(results: readonly Result<T, E>[]): Result<T[], E> => {
  const values: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
};

/**
 * Partition Results into successes and failures, keeping both. Use when a
 * partial outcome is meaningful — an ingest batch, for instance, where some
 * events are accepted and some rejected.
 */
export const partition = <T, E>(
  results: readonly Result<T, E>[],
): { readonly values: T[]; readonly errors: E[] } => {
  const values: T[] = [];
  const errors: E[] = [];
  for (const r of results) {
    if (r.ok) values.push(r.value);
    else errors.push(r.error);
  }
  return { values, errors };
};
