import type { TileId } from "./tile";

export type DashboardError =
  | { kind: "NameRequired" }
  | { kind: "NameUnchanged" }
  | { kind: "TileTitleRequired" }
  | { kind: "TileExists"; tile: TileId }
  | { kind: "NoSuchTile"; tile: TileId }
  | { kind: "TooManyTiles"; max: number }
  | { kind: "InvalidWidth"; width: number }
  | { kind: "WidthUnchanged"; tile: TileId }
  | { kind: "IndexOutOfRange"; index: number; size: number }
  | { kind: "PositionUnchanged"; tile: TileId }
  | { kind: "ShareGrantExpired" }
  | { kind: "NotShared" };
