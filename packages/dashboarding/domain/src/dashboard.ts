import { validTileLayout, type TilePlacement } from "./tile";
/**
 * Dashboard — a workspace-owned arrangement of tiles.
 *
 * Owned by the **workspace**, which dissolves v1's worst structural bug. There
 * a dashboard belonged to a user via a nullable `userId`, and every guard read
 * `if (existing.userId && existing.userId !== session.user.id)` — so a
 * dashboard whose owner was NULL (and project deletion deliberately created
 * those) was readable, editable, deletable and publicly shareable by any
 * authenticated user. There was also a partial unique index enforcing one
 * default *per user* while the loader resolved the default *per project*, so
 * the two disagreed about what "default" even meant. Here `isDefault` is a fact
 * about a dashboard in a workspace, and "at most one default per workspace" is
 * enforced where it is knowable — across aggregates, in the use case.
 *
 * Layout uses twelve columns with explicit positions and independent heights.
 * The complete arrangement is validated and saved together. Older clients may
 * still use ordered widths; those tiles flow until a grid layout is saved.
 *
 * **The whole tile lifecycle is here and reachable.** v2 had `addTile`
 * implemented and tested and no route that could call it, so every dashboard a
 * customer created stayed permanently empty. The domain was never the problem;
 * the missing half was above it. Anything added here needs a use case in
 * `@counted/dashboarding-app` and a procedure in `@counted/contract` before a
 * customer can use it.
 */

import { err, Instant, ok } from "@counted/kernel";
import type { DashboardId, ProjectId, Result, TileId, WorkspaceId } from "@counted/kernel";
import { ROW_UNITS, Tile, TileWidth } from "./tile";
import type { ShareGrant } from "./share-grant";
import type { DashboardError } from "./errors";
import type { DashboardEvent } from "./events";

/**
 * A ceiling that exists so one dashboard cannot become an unbounded fan-out of
 * analytics queries. Every tile is at least one engine round trip on every
 * render; fifty is already a lot to ask of one page.
 */
export const MAX_TILES = 50;

export type DashboardSnapshot<A> = {
  readonly id: DashboardId;
  readonly workspace: WorkspaceId;
  readonly name: string;
  readonly tiles: readonly Tile<A>[];
  readonly isDefault: boolean;
  readonly share: ShareGrant | null;
};

export type DashboardApplied<A> = {
  readonly dashboard: Dashboard<A>;
  readonly events: readonly DashboardEvent[];
};

type DashboardResult<A> = Result<DashboardApplied<A>, DashboardError>;

export class Dashboard<A> {
  private constructor(private readonly s: DashboardSnapshot<A>) {}

  static create<A>(
    id: DashboardId,
    workspace: WorkspaceId,
    name: string,
    at: Instant,
    isDefault = false,
  ): DashboardResult<A> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });

    return ok({
      dashboard: new Dashboard<A>({
        id,
        workspace,
        name: trimmed,
        tiles: [],
        isDefault,
        share: null,
      }),
      events: [{ kind: "DashboardCreated", dashboard: id, workspace, name: trimmed, at }],
    });
  }

  static rehydrate<A>(s: DashboardSnapshot<A>): Dashboard<A> {
    return new Dashboard<A>(s);
  }

  snapshot(): DashboardSnapshot<A> {
    return this.s;
  }

  // ── reads ────────────────────────────────────────────────────────────────

  get id(): DashboardId {
    return this.s.id;
  }
  get workspace(): WorkspaceId {
    return this.s.workspace;
  }
  get name(): string {
    return this.s.name;
  }
  get tiles(): readonly Tile<A>[] {
    return this.s.tiles;
  }
  get isDefault(): boolean {
    return this.s.isDefault;
  }
  get share(): ShareGrant | null {
    return this.s.share;
  }
  get isEmpty(): boolean {
    return this.s.tiles.length === 0;
  }

  tile(id: TileId): Tile<A> | undefined {
    return this.s.tiles.find((t) => t.id === id);
  }

  /**
   * Every project this dashboard reads from, in the order the tiles first name
   * them. A dashboard may span projects, and this set is what a share grant's
   * binding is derived from — a share link may run the queries the page it
   * shows needs, and no others.
   */
  projects(): readonly ProjectId[] {
    return [...new Set(this.s.tiles.map((t) => t.project))];
  }

  /**
   * Pack tiles into rows of twelve, in order. A tile that will not fit in the
   * space left starts a new row. Deterministic, and the same on the server, in
   * the browser and on the public share page — v1 computed layout in the client
   * only, so the shared view drew something different from the one the author
   * had arranged.
   */
  rows(): readonly (readonly Tile<A>[])[] {
    const out: Tile<A>[][] = [];
    let row: Tile<A>[] = [];
    let used = 0;

    for (const tile of this.s.tiles) {
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

  // ── the tile lifecycle ───────────────────────────────────────────────────

  addTile(tile: Tile<A>, at: Instant): DashboardResult<A> {
    if (this.s.tiles.length >= MAX_TILES) return err({ kind: "TooManyTiles", max: MAX_TILES });
    if (this.s.tiles.some((t) => t.id === tile.id)) return err({ kind: "TileExists", tile: tile.id });

    const shaped = Dashboard.wellFormed(tile);
    if (!shaped.ok) return shaped;

    return ok({
      dashboard: this.withTiles([...this.s.tiles, tile]),
      events: [
        { kind: "TileAdded", dashboard: this.s.id, tile: tile.id, project: tile.project, at },
      ],
    });
  }

  /**
   * Swap a tile's content wholesale, keeping its position. Title, analysis,
   * view and width all move together, because the console edits them on one
   * form and a per-field command per field would be five round trips to change
   * one card.
   */
  updateTile(tile: Tile<A>, at: Instant): DashboardResult<A> {
    if (!this.s.tiles.some((t) => t.id === tile.id)) return err({ kind: "NoSuchTile", tile: tile.id });

    const shaped = Dashboard.wellFormed(tile);
    if (!shaped.ok) return shaped;

    return ok({
      dashboard: this.withTiles(this.s.tiles.map((t) => (t.id === tile.id ? (t.width === tile.width ? tile : Tile.withoutLayout(tile)) : t))),
      events: [{ kind: "TileUpdated", dashboard: this.s.id, tile: tile.id, at }],
    });
  }

  /**
   * Width alone. Separate from `updateTile` because dragging a tile edge is the
   * one edit that happens dozens of times a minute, and a no-op resize is
   * refused rather than emitting an event nobody caused.
   */
  resizeTile(id: TileId, width: TileWidth, at: Instant): DashboardResult<A> {
    const existing = this.tile(id);
    if (existing === undefined) return err({ kind: "NoSuchTile", tile: id });
    if (!TileWidth.isValid(width)) return err({ kind: "InvalidWidth", width });
    if (existing.width === width) return err({ kind: "WidthUnchanged", tile: id });

    return ok({
      dashboard: this.withTiles(this.s.tiles.map((t) => (t.id === id ? Tile.withWidth(t, width) : t))),
      events: [{ kind: "TileResized", dashboard: this.s.id, tile: id, width, at }],
    });
  }

  /** Replace the complete grid atomically; repeating the same layout is a success. */
  setLayout(placements: readonly TilePlacement[], at: Instant): DashboardResult<A> {
    const ids = new Set(placements.map((item) => item.id));
    if (placements.length !== this.s.tiles.length || ids.size !== this.s.tiles.length ||
        this.s.tiles.some((tile) => !ids.has(tile.id))) {
      return err({ kind: "InvalidLayout", detail: "The layout must contain every insight exactly once. Reload the dashboard and try again." });
    }
    for (const item of placements) {
      if (!TileWidth.isValid(item.width) || !validTileLayout(item, item.width))
        return err({ kind: "InvalidLayout", detail: "An insight lies outside the grid or has an invalid size." });
    }
    for (let i = 0; i < placements.length; i++) {
      const a = placements[i]!;
      for (const b of placements.slice(i + 1)) {
        if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y)
          return err({ kind: "InvalidLayout", detail: "Insights cannot overlap." });
      }
    }
    const ordered = [...placements].sort((a, b) => a.y - b.y || a.x - b.x);
    const tiles = ordered.map(({ id, width, x, y, height }) => ({ ...this.tile(id)!, width, layout: { x, y, height } }));
    const unchanged = tiles.every((tile, i) => {
      const old = this.s.tiles[i];
      return old?.id === tile.id && old.width === tile.width && old.layout?.x === tile.layout.x &&
        old.layout?.y === tile.layout.y && old.layout?.height === tile.layout.height;
    });
    return ok({ dashboard: unchanged ? this : this.withTiles(tiles), events: unchanged ? [] : [{ kind: "DashboardLayoutChanged", dashboard: this.s.id, at }] });
  }

  /** Move one tile to a new position in the flow. Order is the layout. */
  moveTile(id: TileId, toIndex: number, at: Instant): DashboardResult<A> {
    const from = this.s.tiles.findIndex((t) => t.id === id);
    if (from === -1) return err({ kind: "NoSuchTile", tile: id });
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= this.s.tiles.length) {
      return err({ kind: "IndexOutOfRange", index: toIndex, size: this.s.tiles.length });
    }
    if (from === toIndex) return err({ kind: "PositionUnchanged", tile: id });

    const next = [...this.s.tiles];
    const [moved] = next.splice(from, 1);
    next.splice(toIndex, 0, moved!);

    return ok({
      dashboard: this.withTiles(next.map(Tile.withoutLayout)),
      events: [{ kind: "TileMoved", dashboard: this.s.id, tile: id, position: toIndex, at }],
    });
  }

  /**
   * Rearrange every tile at once — one drag-and-drop, one write.
   *
   * The order must be a permutation of exactly the tiles already here. Not a
   * subset, not a superset, no duplicates. Accepting a partial order and
   * appending the remainder is how a client bug silently deletes tiles from the
   * layout, so an incomplete order is refused with the two counts that make the
   * mismatch obvious.
   */
  reorderTiles(order: readonly TileId[], at: Instant): DashboardResult<A> {
    for (const id of order) {
      if (!this.s.tiles.some((t) => t.id === id)) return err({ kind: "NoSuchTile", tile: id });
    }

    const distinct = new Set(order).size;
    if (distinct !== this.s.tiles.length || order.length !== this.s.tiles.length) {
      return err({ kind: "NotAPermutation", expected: this.s.tiles.length, received: distinct });
    }

    const unchanged = this.s.tiles.every((t, i) => t.id === order[i]);
    if (unchanged) return err({ kind: "OrderUnchanged" });

    const byId = new Map(this.s.tiles.map((t) => [t.id, t]));
    const next = order.map((id) => byId.get(id)!);

    return ok({
      dashboard: this.withTiles(next.map(Tile.withoutLayout)),
      events: [{ kind: "TilesReordered", dashboard: this.s.id, order: [...order], at }],
    });
  }

  removeTile(id: TileId, at: Instant): DashboardResult<A> {
    if (!this.s.tiles.some((t) => t.id === id)) return err({ kind: "NoSuchTile", tile: id });
    return ok({
      dashboard: this.withTiles(this.s.tiles.filter((t) => t.id !== id)),
      events: [{ kind: "TileRemoved", dashboard: this.s.id, tile: id, at }],
    });
  }

  // ── the dashboard itself ─────────────────────────────────────────────────

  rename(name: string, at: Instant): DashboardResult<A> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });
    if (trimmed === this.s.name) return err({ kind: "NameUnchanged" });
    return ok({
      dashboard: this.patch({ name: trimmed }),
      events: [{ kind: "DashboardRenamed", dashboard: this.s.id, name: trimmed, at }],
    });
  }

  /**
   * The aggregate can only say *this* dashboard is the default. "At most one
   * default per workspace" spans aggregates, so it is the use case that clears
   * the previous one — v1 tried to state it as a partial unique index scoped to
   * a user while the loader read it scoped to a project, and the two never
   * agreed on which dashboard would open.
   */
  markDefault(at: Instant): DashboardResult<A> {
    if (this.s.isDefault) return err({ kind: "DefaultUnchanged" });
    return ok({
      dashboard: this.patch({ isDefault: true }),
      events: [{ kind: "DashboardDefaultSet", dashboard: this.s.id, at }],
    });
  }

  clearDefault(at: Instant): DashboardResult<A> {
    if (!this.s.isDefault) return err({ kind: "DefaultUnchanged" });
    return ok({
      dashboard: this.patch({ isDefault: false }),
      events: [{ kind: "DashboardDefaultCleared", dashboard: this.s.id, at }],
    });
  }

  // ── sharing ──────────────────────────────────────────────────────────────

  /**
   * Mint a share capability. Replacing an existing one revokes it — there is
   * exactly one live share link per dashboard, so "revoke the link I sent" is
   * one action and not a hunt through a list.
   */
  grantShare(grant: ShareGrant, at: Instant): DashboardResult<A> {
    if (grant.dashboard !== this.s.id) return err({ kind: "ShareGrantMismatch" });
    if (!Instant.isAfter(grant.expiresAt, at)) return err({ kind: "ShareGrantExpired" });
    return ok({
      dashboard: this.patch({ share: grant }),
      events: [{ kind: "DashboardShared", dashboard: this.s.id, expiresAt: grant.expiresAt, at }],
    });
  }

  unshare(at: Instant): DashboardResult<A> {
    if (this.s.share === null) return err({ kind: "NotShared" });
    return ok({
      dashboard: this.patch({ share: null }),
      events: [{ kind: "DashboardUnshared", dashboard: this.s.id, at }],
    });
  }

  /**
   * May a presented digest read *this* dashboard right now, and if not, why.
   *
   * A wrong digest and an unshared dashboard both answer `NotShared`, on
   * purpose: distinguishing them turns this into an oracle that tells a guesser
   * which dashboards have live links. An expired grant is reported as expired,
   * because saying so only tells someone who already held the right token.
   */
  authorizeShareRead(digest: string, at: Instant): Result<ShareGrant, DashboardError> {
    const grant = this.s.share;
    if (grant === null) return err({ kind: "NotShared" });
    // A grant that names another dashboard cannot open this one, whatever put
    // it here. A share token is a view of one page, not a guest account.
    if (grant.dashboard !== this.s.id) return err({ kind: "ShareGrantMismatch" });
    if (grant.digest !== digest) return err({ kind: "NotShared" });
    if (!Instant.isAfter(grant.expiresAt, at)) return err({ kind: "ShareGrantExpired" });
    return ok(grant);
  }

  /** The same question as a boolean, for call sites that only branch. */
  allowsShareRead(digest: string, at: Instant): boolean {
    return this.authorizeShareRead(digest, at).ok;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private static wellFormed<A>(tile: Tile<A>): Result<Tile<A>, DashboardError> {
    if (tile.title.trim().length === 0) return err({ kind: "TileTitleRequired" });
    if (!TileWidth.isValid(tile.width)) return err({ kind: "InvalidWidth", width: tile.width });
    return ok(tile);
  }

  private withTiles(tiles: readonly Tile<A>[]): Dashboard<A> {
    return new Dashboard<A>({ ...this.s, tiles });
  }

  private patch(fields: Partial<DashboardSnapshot<A>>): Dashboard<A> {
    return new Dashboard<A>({ ...this.s, ...fields });
  }
}
