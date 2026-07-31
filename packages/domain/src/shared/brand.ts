/**
 * Branded primitives — nominal typing over strings and numbers.
 *
 * The point is not tidiness. The old system had one `string` standing in for a
 * login session, an ephemeral visit, and a Stripe idempotency key, and the type
 * checker was happy to swap them. Branding makes that a compile error.
 *
 * The privacy invariant leans on this directly: `VisitId` and `PersonId` are
 * both strings underneath and are never interchangeable, so a visit id cannot
 * drift into a field that means identity.
 */

declare const BRAND: unique symbol;

export type Brand<T, B extends string> = T & { readonly [BRAND]: B };

/**
 * Assert a raw value into a branded type. Deliberately verbose to call: every
 * use is a place where an unvalidated value crosses into the domain, and those
 * places should be easy to grep for.
 */
export const brand = <B extends string>() => <T>(value: T): Brand<T, B> =>
  value as Brand<T, B>;

/** Strip the brand. Needed at serialization boundaries. */
export const unbrand = <T, B extends string>(value: Brand<T, B>): T => value as T;

/**
 * Exhaustiveness check. Put it in the default arm of a switch over a union and
 * adding a new variant becomes a compile error rather than a silent fallthrough.
 */
export const assertNever = (value: never, message?: string): never => {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(value)}`);
};
