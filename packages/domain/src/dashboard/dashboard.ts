/**
 * Dashboard — a workspace-owned arrangement of tiles.
 *
 * Owned by the **workspace**, which is what dissolves v1's worst structural
 * bug. There a dashboard belonged to a user via a nullable `userId`, and every
 * guard read `if (existing.userId && existing.userId !== session.user.id)` —
 * so a dashboard whose owner was NULL (and project deletion deliberately
 * created those) was readable, editable, deletable and publicly shareable by
 * any authenticated user. There was also a partial unique index enforcing one
 * default *per user* while the loader resolved the default *per project*, so
 * the two disagreed about what "default" even meant.
 *
 * Layout is a flow, not a grid. Tiles are ordered and each has a width in
 * twelfths; they pack left to right and wrap. v1 carried absolute grid
 * coordinates plus drag-resize plus a `compact` flag plus per-tile pinning —
 * four mechanisms for one job, with `compact` written into the layout JSON but
 * absent from the type that described it.
 */

import { err, ok, type Result } from "../shared/result";
import type { DashboardId, ProjectId, WorkspaceId } from "../shared/ids";
import type { Instant } from "../shared/instant";
import { ROW_UNITS, Tile, TileWidth, type TileId } from "./tile";
import type { DashboardError } from "./errors";
import type { DashboardEvent } from "./events";

/** A revocable, expiring capability to read one dashboard. */
export type ShareGrant = {
  readonly digest: string;
  readonly expiresAt: Instant;
};

export type DashboardSnapshot = {
  readonly id: DashboardId;
  readonly workspace: WorkspaceId;
  readonly name: string;
  readonly tiles: readonly Tile[];
  readonly isDefault: boolean;
  readonly share: ShareGrant | null;
};

export type DashboardApplied = {
  readonly dashboard: Dashboard;
  readonly events: readonly DashboardEvent[];
};

export const MAX_TILES = 50;

export class Dashboard {
  private constructor(
    readonly id: DashboardId,
    readonly workspace: WorkspaceId,
    readonly name: string,
    private readonly tileList: readonly Tile[],
    readonly isDefault: boolean,
    readonly share: ShareGrant | null,
  ) {}

  static create(
    id: DashboardId,
    workspace: WorkspaceId,
    name: string,
    at: Instant,
    isDefault = false,
  ): Result<DashboardApplied, DashboardError> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });

    return ok({
      dashboard: new Dashboard(id, workspace, trimmed, [], isDefault, null),
      events: [{ kind: "DashboardCreated", dashboard: id, workspace, name: trimmed, at }],
    });
  }

  static rehydrate(s: DashboardSnapshot): Dashboard {
    return new Dashboard(s.id, s.workspace, s.name, s.tiles, s.isDefault, s.share);
  }

  snapshot(): DashboardSnapshot {
    return {
      id: this.id,
      workspace: this.workspace,
      name: this.name,
      tiles: this.tileList,
      isDefault: this.isDefault,
      share: this.share,
    };
  }

  // ── reads ────────────────────────────────────────────────────────────────

  get tiles(): readonly Tile[] {
    return this.tileList;
  }

  get isEmpty(): boolean {
    return this.tileList.length === 0;
  }

  tile(id: TileId): Tile | undefined {
    return this.tileList.find((t) => t.id === id);
  }

  /** Every project this dashboard reads from. A dashboard may span projects. */
  projects(): readonly ProjectId[] {
    return [...new Set(this.tileList.map((t) => t.project))];
  }

  /**
   * Pack tiles into rows of twelve, in order. A tile that will not fit in the
   * space left starts a new row. Deterministic, and the same on the server, in
   * the browser, and on the public share page — v1 computed layout in the
   * client only, so the shared view drew something different.
   */
  rows(): readonly (readonly Tile[])[] {
    const out: Tile[][] = [];
    let row: Tile[] = [];
    let used = 0;

    for (const tile of this.tileList) {
      if (used + tile.width > ROW_UNITS && row.length > 0) {
        out.push(row);
        row = [];
        used = 0;
      }
      row.push(tile);
      used += tile.width;
    }
    if (row.length > 0) out.push(row);
    return out;
  }

  // ── commands ─────────────────────────────────────────────────────────────

  addTile(tile: Tile, at: Instant): Result<DashboardApplied, DashboardError> {
    if (this.tileList.length >= MAX_TILES) {
      return err({ kind: "TooManyTiles", max: MAX_TILES });
    }
    if (this.tileList.some((t) => t.id === tile.id)) {
      return err({ kind: "TileExists", tile: tile.id });
    }
    if (!TileWidth.isValid(tile.width)) {
      return err({ kind: "InvalidWidth", width: tile.width });
    }
    if (tile.title.trim().length === 0) return err({ kind: "TileTitleRequired" });

    return ok({
      dashboard: this.with([...this.tileList, tile]),
      events: [{ kind: "TileAdded", dashboard: this.id, tile: tile.id, at }],
    });
  }

  removeTile(id: TileId, at: Instant): Result<DashboardApplied, DashboardError> {
    if (!this.tileList.some((t) => t.id === id)) return err({ kind: "NoSuchTile", tile: id });
    return ok({
      dashboard: this.with(this.tileList.filter((t) => t.id !== id)),
      events: [{ kind: "TileRemoved", dashboard: this.id, tile: id, at }],
    });
  }

  resizeTile(id: TileId, width: TileWidth, at: Instant): Result<DashboardApplied, DashboardError> {
    const existing = this.tile(id);
    if (existing === undefined) return err({ kind: "NoSuchTile", tile: id });
    if (!TileWidth.isValid(width)) return err({ kind: "InvalidWidth", width });
    if (existing.width === width) return err({ kind: "WidthUnchanged", tile: id });

    return ok({
      dashboard: this.with(this.tileList.map((t) => (t.id === id ? Tile.withWidth(t, width) : t))),
      events: [{ kind: "TileResized", dashboard: this.id, tile: id, width, at }],
    });
  }

  replaceTile(tile: Tile, at: Instant): Result<DashboardApplied, DashboardError> {
    if (!this.tileList.some((t) => t.id === tile.id)) return err({ kind: "NoSuchTile", tile: tile.id });
    if (tile.title.trim().length === 0) return err({ kind: "TileTitleRequired" });

    return ok({
      dashboard: this.with(this.tileList.map((t) => (t.id === tile.id ? tile : t))),
      events: [{ kind: "TileUpdated", dashboard: this.id, tile: tile.id, at }],
    });
  }

  /** Move a tile to a new position in the flow. Order is the layout. */
  moveTile(id: TileId, toIndex: number, at: Instant): Result<DashboardApplied, DashboardError> {
    const from = this.tileList.findIndex((t) => t.id === id);
    if (from === -1) return err({ kind: "NoSuchTile", tile: id });
    if (toIndex < 0 || toIndex >= this.tileList.length) {
      return err({ kind: "IndexOutOfRange", index: toIndex, size: this.tileList.length });
    }
    if (from === toIndex) return err({ kind: "PositionUnchanged", tile: id });

    const next = [...this.tileList];
    const [moved] = next.splice(from, 1);
    next.splice(toIndex, 0, moved!);

    return ok({
      dashboard: this.with(next),
      events: [{ kind: "TileMoved", dashboard: this.id, tile: id, position: toIndex, at }],
    });
  }

  rename(name: string, at: Instant): Result<DashboardApplied, DashboardError> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });
    if (trimmed === this.name) return err({ kind: "NameUnchanged" });
    return ok({
      dashboard: new Dashboard(this.id, this.workspace, trimmed, this.tileList, this.isDefault, this.share),
      events: [{ kind: "DashboardRenamed", dashboard: this.id, name: trimmed, at }],
    });
  }

  /** Mint a share capability. Replacing an existing one revokes it. */
  grantShare(grant: ShareGrant, at: Instant): Result<DashboardApplied, DashboardError> {
    if (grant.expiresAt <= at) return err({ kind: "ShareGrantExpired" });
    return ok({
      dashboard: new Dashboard(this.id, this.workspace, this.name, this.tileList, this.isDefault, grant),
      events: [{ kind: "DashboardShared", dashboard: this.id, expiresAt: grant.expiresAt, at }],
    });
  }

  unshare(at: Instant): Result<DashboardApplied, DashboardError> {
    if (this.share === null) return err({ kind: "NotShared" });
    return ok({
      dashboard: new Dashboard(this.id, this.workspace, this.name, this.tileList, this.isDefault, null),
      events: [{ kind: "DashboardUnshared", dashboard: this.id, at }],
    });
  }

  /** Whether a presented digest may read this dashboard right now. */
  allowsShareRead(digest: string, at: Instant): boolean {
    return this.share !== null && this.share.digest === digest && this.share.expiresAt > at;
  }

  private with(tiles: readonly Tile[]): Dashboard {
    return new Dashboard(this.id, this.workspace, this.name, tiles, this.isDefault, this.share);
  }
}
