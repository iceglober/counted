/**
 * @counted/domain — the innermost hexagon.
 *
 * Rules this package holds to, enforced by CI rather than by review:
 *   1. Zero runtime dependencies. No `pg`, no `hono`, no `next`, no `zod`.
 *   2. No I/O of any kind. No fetch, no fs, no database.
 *   3. No ambient clock. Time arrives as a value from the Clock port.
 *
 * See ARCHITECTURE.md in the private planning repo for the canonical design.
 */

export * from "./shared";
export * from "./workspace";
export * from "./project";
export * from "./identity";
export * from "./analytics";
