/**
 * @counted/tenancy-domain — Workspace as a business aggregate.
 *
 * Owns the plan catalog, the entitlements a plan confers, the project cap and
 * the quota bands. The plan catalog lives here and not in the Stripe adapter:
 * v1 put `PLANS` inside `lib/stripe.ts` with lazy env getters for price ids, so
 * the vendor effectively defined what a customer was allowed to do, and "is
 * this customer on Pro?" had three answers in three files. A price id is a
 * vendor reference TO a plan; it is not part of the plan.
 *
 * A better-auth `organization` row and a `Workspace` share an id and mean
 * different things. Membership is not here — it is read through
 * `MembershipDirectory` and never written by the domain.
 */

export * from "./limits";
export * from "./plan";
export * from "./entitlement";
export * from "./project-count";
export * from "./errors";
export * from "./events";
export * from "./workspace";
export * from "./subscription";
export * from "./quota";
export * from "./retention";
export * from "./usage";
