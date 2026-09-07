/**
 * @counted/dashboarding-domain — Dashboard, Tile, ShareGrant, Monitor.
 *
 * Three concepts v1 tangled into two near-duplicate types:
 *
 *   Analysis  what to measure          (analytics)
 *   Tile      placement + presentation (here, persisted)
 *   Readout   the computed answer      (transient)
 *
 * One width vocabulary: twelfths, 1 to 12. v1 had three, which is how every
 * template tile collapsed to one column on the public share view. And a tile
 * names its own project — v1 inherited it from the dashboard, which is how a
 * metric card drew its headline from one project and its sparkline from
 * another.
 *
 * **The one cross-context seam.** A Tile holds an Analysis, and Analysis lives
 * in another context's domain, which `no-cross-context-domain` forbids
 * importing. So `Tile`, `Dashboard` and `Monitor` are generic in the analysis
 * type and it is closed one layer up, in `@counted/dashboarding-app`. Anything
 * that needs to *inspect* an analysis — "this monitor's analysis must be
 * scalar" — belongs in `app` for the same reason: that is an analytics
 * question, not a dashboard one. See V3-SPEC §7.
 */

export * from "./tile";
export * from "./share-grant";
export * from "./dashboard";
export * from "./threshold";
export * from "./monitor";
export * from "./monitor-alert";
export * from "./readout";
export * from "./errors";
export * from "./events";
