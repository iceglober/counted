/**
 * Every way a dashboard or monitor command can be refused.
 *
 * Discriminated unions with a `kind`, never exceptions and never strings, so
 * the mapping to a wire code is a table a reader can check (V3-SPEC §6) rather
 * than a chain of `instanceof`.
 *
 * Four `DashboardError` kinds and two `MonitorError` kinds are NOT in V3-SPEC
 * §6 as written. They are flagged in this package's hand-off:
 *
 *   NoSuchDashboard    404 — the aggregate the command names does not exist
 *   NotAPermutation    400 — a reorder that is not a rearrangement of these tiles
 *   OrderUnchanged     409 — a reorder that changes nothing
 *   DefaultUnchanged   409 — marking the already-default dashboard default
 *   ShareGrantMismatch 403 — a grant minted for a different dashboard
 *   NoSuchMonitor      404
 *   NameUnchanged      409 — monitor rename that changes nothing, mirroring the
 *                            dashboard rule that already exists in the table
 */

import type { DashboardId, MonitorId, TileId } from "@counted/kernel";

export type DashboardError =
  | { readonly kind: "InvalidLayout"; readonly detail: string }
  | { readonly kind: "NameRequired" }
  | { readonly kind: "NameUnchanged" }
  | { readonly kind: "NoSuchDashboard"; readonly dashboard: DashboardId }
  | { readonly kind: "TileTitleRequired" }
  | { readonly kind: "TileExists"; readonly tile: TileId }
  | { readonly kind: "NoSuchTile"; readonly tile: TileId }
  | { readonly kind: "TooManyTiles"; readonly max: number }
  | { readonly kind: "InvalidWidth"; readonly width: number }
  | { readonly kind: "WidthUnchanged"; readonly tile: TileId }
  | { readonly kind: "IndexOutOfRange"; readonly index: number; readonly size: number }
  | { readonly kind: "PositionUnchanged"; readonly tile: TileId }
  | { readonly kind: "NotAPermutation"; readonly expected: number; readonly received: number }
  | { readonly kind: "OrderUnchanged" }
  | { readonly kind: "DefaultUnchanged" }
  | { readonly kind: "ShareGrantExpired" }
  | { readonly kind: "ShareGrantMismatch" }
  | { readonly kind: "NotShared" };

/**
 * `AnalysisMustBeScalar` and `InvalidAnalysis` are declared here but never
 * produced here. Deciding whether an analysis yields a single number is an
 * analytics question, and this domain holds the analysis as an opaque `A`
 * (V3-SPEC §7). `@counted/dashboarding-app` runs that check through an injected
 * `AnalysisCheck` and returns these. The alternative — a monitor domain that
 * imports the Analysis IR — is the cross-context import the architecture
 * forbids.
 */
export type MonitorError =
  | { readonly kind: "NameRequired" }
  | { readonly kind: "NameUnchanged" }
  | { readonly kind: "NoSuchMonitor"; readonly monitor: MonitorId }
  | { readonly kind: "NegativeCooldown" }
  | { readonly kind: "AnalysisMustBeScalar" }
  | { readonly kind: "InvalidAnalysis"; readonly detail: string }
  | { readonly kind: "AlreadyEnabled" }
  | { readonly kind: "AlreadyDisabled" };
