/**
 * What happened, as facts. Each variant carries `kind` and `at`, which is what
 * `DomainEvent` requires and what the outbox envelopes as
 * `"dashboarding.<Kind>"`.
 *
 * Deletion emits nothing. `DashboardRepository.delete` and
 * `MonitorRepository.delete` take an id and no events, so there is no
 * `DashboardDeleted` to enqueue — flagged in the hand-off, because a webhook
 * subscriber that wants to know a dashboard went away currently cannot.
 */

import type { DashboardId, DomainEvent, Instant, MonitorId, ProjectId, TileId, WorkspaceId } from "@counted/kernel";
import type { TileWidth } from "./tile";
import type { Threshold } from "./threshold";

export type DashboardEvent =
  | { readonly kind: "DashboardLayoutChanged"; readonly dashboard: DashboardId; readonly at: Instant }
  | { readonly kind: "DashboardCreated"; readonly dashboard: DashboardId; readonly workspace: WorkspaceId; readonly name: string; readonly at: Instant }
  | { readonly kind: "DashboardRenamed"; readonly dashboard: DashboardId; readonly name: string; readonly at: Instant }
  | { readonly kind: "DashboardDefaultSet"; readonly dashboard: DashboardId; readonly at: Instant }
  | { readonly kind: "DashboardDefaultCleared"; readonly dashboard: DashboardId; readonly at: Instant }
  | { readonly kind: "TileAdded"; readonly dashboard: DashboardId; readonly tile: TileId; readonly project: ProjectId; readonly at: Instant }
  | { readonly kind: "TileUpdated"; readonly dashboard: DashboardId; readonly tile: TileId; readonly at: Instant }
  | { readonly kind: "TileRemoved"; readonly dashboard: DashboardId; readonly tile: TileId; readonly at: Instant }
  | { readonly kind: "TileResized"; readonly dashboard: DashboardId; readonly tile: TileId; readonly width: TileWidth; readonly at: Instant }
  | { readonly kind: "TileMoved"; readonly dashboard: DashboardId; readonly tile: TileId; readonly position: number; readonly at: Instant }
  | { readonly kind: "TilesReordered"; readonly dashboard: DashboardId; readonly order: readonly TileId[]; readonly at: Instant }
  | { readonly kind: "DashboardShared"; readonly dashboard: DashboardId; readonly expiresAt: Instant; readonly at: Instant }
  | { readonly kind: "DashboardUnshared"; readonly dashboard: DashboardId; readonly at: Instant };

export type MonitorEvent =
  | { readonly kind: "MonitorCreated"; readonly monitor: MonitorId; readonly workspace: WorkspaceId; readonly project: ProjectId; readonly name: string; readonly at: Instant }
  | { readonly kind: "MonitorRenamed"; readonly monitor: MonitorId; readonly name: string; readonly at: Instant }
  | { readonly kind: "MonitorRetargeted"; readonly monitor: MonitorId; readonly at: Instant }
  | { readonly kind: "MonitorReconfigured"; readonly monitor: MonitorId; readonly at: Instant }
  | { readonly kind: "MonitorEnabled"; readonly monitor: MonitorId; readonly at: Instant }
  | { readonly kind: "MonitorDisabled"; readonly monitor: MonitorId; readonly at: Instant }
  | {
      readonly kind: "MonitorFired";
      readonly monitor: MonitorId;
      readonly project: ProjectId;
      readonly observed: number;
      readonly threshold: Threshold;
      readonly entering: boolean;
      readonly at: Instant;
    }
  | { readonly kind: "MonitorRecovered"; readonly monitor: MonitorId; readonly project: ProjectId; readonly observed: number; readonly at: Instant };

/**
 * Both unions really do satisfy `DomainEvent`. Asserted at compile time rather
 * than trusted: the repositories' `save` signatures are constrained on it, so a
 * variant that forgot `at` would otherwise only fail at some distant call site.
 */
type Assert<T extends true> = T;
type _DashboardEventsAreDomainEvents = Assert<DashboardEvent extends DomainEvent ? true : false>;
type _MonitorEventsAreDomainEvents = Assert<MonitorEvent extends DomainEvent ? true : false>;
