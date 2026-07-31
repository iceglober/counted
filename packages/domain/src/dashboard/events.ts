import type { DashboardId, WorkspaceId } from "../shared/ids";
import type { Instant } from "../shared/instant";
import type { TileId, TileWidth } from "./tile";

export type DashboardEvent =
  | { kind: "DashboardCreated"; dashboard: DashboardId; workspace: WorkspaceId; name: string; at: Instant }
  | { kind: "DashboardRenamed"; dashboard: DashboardId; name: string; at: Instant }
  | { kind: "TileAdded"; dashboard: DashboardId; tile: TileId; at: Instant }
  | { kind: "TileRemoved"; dashboard: DashboardId; tile: TileId; at: Instant }
  | { kind: "TileUpdated"; dashboard: DashboardId; tile: TileId; at: Instant }
  | { kind: "TileResized"; dashboard: DashboardId; tile: TileId; width: TileWidth; at: Instant }
  | { kind: "TileMoved"; dashboard: DashboardId; tile: TileId; position: number; at: Instant }
  | { kind: "DashboardShared"; dashboard: DashboardId; expiresAt: Instant; at: Instant }
  | { kind: "DashboardUnshared"; dashboard: DashboardId; at: Instant };
