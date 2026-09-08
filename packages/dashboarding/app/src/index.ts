/**
 * @counted/dashboarding-app — dashboard and monitor use cases.
 *
 * Includes the write surfaces v2 never had: the whole tile lifecycle, monitor
 * create/update/delete, and workspace-scoped listing. v2's aggregate could
 * already do most of this; no route could reach it, so every dashboard a
 * customer made stayed empty.
 *
 * The Analysis type parameter is NOT closed here, and cannot be: closing it
 * means naming `@counted/analytics-domain`, which rule 2 forbids this layer.
 * It stays open to the composition root. See `ports.ts`.
 */

export * from "./ports";
export * from "./dashboards";
export * from "./monitors";
export * from "./readouts";
