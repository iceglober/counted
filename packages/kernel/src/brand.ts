/**
 * Branded primitives — nominal typing over strings and numbers.
 *
 * The point is not tidiness. v1 had one `string` standing in for a login
 * session, an ephemeral visit, and a Stripe idempotency key, and the type
 * checker was happy to swap them. Branding makes that a compile error.
 *
 * The privacy invariant leans on this directly: `VisitId` and `PersonId` are
 * both strings underneath and are never interchangeable, so a visit id cannot
 * drift into a field that means identity.
 */

declare const BRAND: unique symbol;

export type Brand<T, B extends string> = T & { readonly [BRAND]: B };

/**
 * Strip the brand. Needed at serialization boundaries — a JSON body, a SQL
 * parameter — and nowhere else.
 *
 * Overloads rather than one generic, and this is not style. A brand is an
 * intersection, so with a signature like `<T>(value: Brand<T, B>) => T`
 * TypeScript happily infers `T` as the *whole* intersection: `unbrand` becomes
 * the identity at the type level, it compiles everywhere, and it strips
 * nothing. Constraining `T extends string | number` does not help either —
 * `string & { …brand }` satisfies `extends string`. Two concrete overloads
 * force the base type out.
 */
export function unbrand<B extends string>(value: Brand<string, B>): string;
export function unbrand<B extends string>(value: Brand<number, B>): number;
export function unbrand(value: string | number): string | number {
  return value;
}

/**
 * Exhaustiveness check. Put it in the default arm of a switch over a union and
 * adding a new variant becomes a compile error rather than a silent
 * fallthrough. The throw is unreachable when the compiler agrees.
 */
export const assertNever = (value: never, message?: string): never => {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(value)}`);
};
