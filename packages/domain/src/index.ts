/**
 * @counted/domain — the innermost hexagon.
 *
 * Rules this package holds to, enforced by CI rather than by review:
 *   1. Zero runtime dependencies. No `pg`, no `hono`, no `next`, no `zod`.
 *   2. No I/O of any kind. No fetch, no fs, no database.
 *   3. No ambient clock. Time arrives as a value from a Clock port.
 *
 * See ARCHITECTURE.md in the private planning repo for the canonical design.
 */

/** Placeholder so the package has a real export while the model is built out. */
export const DOMAIN_LAYER = "counted-domain" as const;
