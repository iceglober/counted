/**
 * `DashboardRepository` over Postgres.
 *
 * Generic in `A`, the analytics context's Analysis IR. `no-cross-context-domain`
 * keeps `Dashboard` from importing it, so it stays a type parameter all the way
 * down to storage and arrives here with an `AnalysisCodec` the composition root
 * supplies (V3-SPEC §7). The column is `jsonb`, which means the analysis is
 * queryable in psql during an incident and is not a base64 blob nobody can read.
 *
 * **Tiles are rows.** `projectsReadBy` — the query that decides what a share
 * link is allowed to run — is a `SELECT DISTINCT project_id` over them. Storing
 * the layout as one JSON document would make an authorization boundary
 * something the application has to deserialise before it can check, and v1's
 * layout JSON already carried a `compact` flag that its own type did not
 * mention.
 *
 * **Saving tiles is delete-then-insert.** A dashboard holds at most `MAX_TILES`
 * of them and reordering rewrites the position of every tile after the one that
 * moved, so a diff would be more code, more round trips, and would need a
 * deferrable unique index to survive the intermediate states. Inside the
 * transaction the rewrite is atomic; outside one there is no such thing as a
 * partly-saved dashboard to observe.
 */

import { DashboardId, ProjectId, TileId, WorkspaceId } from "@counted/kernel";
import {
  Dashboard,
  isTileView,
  validTileLayout,
  type TileLayout,
  type Tile,
  TileWidth,
  type DashboardEvent,
  type ShareGrant,
  type TileView,
} from "@counted/dashboarding-domain";
import type { DashboardRepository, DashboardSummary } from "@counted/dashboarding-ports";
import {
  RowDecodeError,
  decodeNumeric,
  decodeText,
  instantOf,
  optionalTimestamp,
  type AnalysisCodec,
} from "./decode";
import { exec, firstRow, rows, type Queryable } from "./queryable";

type DashboardRow = {
  readonly id: string;
  readonly workspace_id: string;
  readonly name: string;
  readonly is_default: boolean;
  readonly share_digest: string | null;
  readonly share_expires_at: Date | null;
};

type TileRow = {
  readonly id: string;
  readonly title: string;
  readonly project_id: string;
  readonly analysis: unknown;
  readonly view: string;
  readonly width: number;
  readonly grid_layout: TileLayout | null;
};

const SELECT = `SELECT id, workspace_id, name, is_default, share_digest, share_expires_at
                FROM dashboards`;

export class PostgresDashboardRepository<A>
  implements DashboardRepository<Dashboard<A>, DashboardEvent>
{
  constructor(
    private readonly db: Queryable,
    private readonly analysis: AnalysisCodec<A>,
  ) {}

  find(id: DashboardId): Promise<Dashboard<A> | null> {
    return this.one(`${SELECT} WHERE id = $1`, [id]);
  }

  /**
   * Resolve a share link.
   *
   * The digest column is uniquely indexed, so this cannot silently pick one of
   * two dashboards — and the `ShareGrant` it rebuilds names the row's own id,
   * so the aggregate's re-check of "is this grant for me?" can never be
   * satisfied by a grant that reached the wrong dashboard.
   */
  findByShareDigest(digest: string): Promise<Dashboard<A> | null> {
    return this.one(`${SELECT} WHERE share_digest = $1`, [digest]);
  }

  async listForWorkspace(workspace: WorkspaceId): Promise<readonly DashboardSummary[]> {
    const found = await rows<{
      id: string;
      workspace_id: string;
      name: string;
      is_default: boolean;
      shared: boolean;
      tile_count: string;
    }>(
      this.db,
      `SELECT d.id, d.workspace_id, d.name, d.is_default,
              d.share_digest IS NOT NULL AS shared,
              count(t.id) AS tile_count
       FROM dashboards d
       LEFT JOIN dashboard_tiles t ON t.dashboard_id = d.id
       WHERE d.workspace_id = $1
       GROUP BY d.id
       ORDER BY d.is_default DESC, d.name, d.id`,
      [workspace],
    );
    return found.map((row) => ({
      id: DashboardId(row.id),
      workspace: WorkspaceId(row.workspace_id),
      name: row.name,
      tileCount: Number(row.tile_count),
      shared: row.shared,
      isDefault: row.is_default,
    }));
  }

  /**
   * Every project this dashboard reads from.
   *
   * A share grant's binding is derived from exactly this set: a share link may
   * run the queries the page it shows needs, and no others. v2 got the
   * evaluation right but had no query behind it.
   */
  async projectsReadBy(dashboard: DashboardId): Promise<readonly ProjectId[]> {
    const found = await rows<{ project_id: string }>(
      this.db,
      `SELECT DISTINCT project_id FROM dashboard_tiles WHERE dashboard_id = $1 ORDER BY project_id`,
      [dashboard],
    );
    return found.map((row) => ProjectId(row.project_id));
  }

  /**
   * The workspace's default dashboard.
   *
   * At most one can exist: `dashboards_one_default_per_workspace` is a partial
   * unique index over the same column and the same scope this reads. v1 had the
   * index scoped per user and the loader resolving per project, so the
   * constraint and the query disagreed about what "default" meant and the
   * console showed a different default from the one the database allowed.
   */
  findDefault(workspace: WorkspaceId): Promise<Dashboard<A> | null> {
    return this.one(`${SELECT} WHERE workspace_id = $1 AND is_default`, [workspace]);
  }

  /**
   * Upsert, never update. `events` is not written here: the outbox is a separate
   * repository handed out by the same transaction, so a use case writes the
   * aggregate and its events side by side.
   */
  async save(dashboard: Dashboard<A>, events: readonly DashboardEvent[]): Promise<void> {
    const s = dashboard.snapshot();
    await exec(
      this.db,
      `INSERT INTO dashboards (id, workspace_id, name, is_default, share_digest, share_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET workspace_id = EXCLUDED.workspace_id,
             name = EXCLUDED.name,
             is_default = EXCLUDED.is_default,
             share_digest = EXCLUDED.share_digest,
             share_expires_at = EXCLUDED.share_expires_at,
             updated_at = now()`,
      [
        s.id,
        s.workspace,
        s.name,
        s.isDefault,
        s.share?.digest ?? null,
        optionalTimestamp(s.share?.expiresAt ?? null),
      ],
    );

    await exec(this.db, `DELETE FROM dashboard_tiles WHERE dashboard_id = $1`, [s.id]);
    if (s.tiles.length === 0) return;

    const values: unknown[] = [s.id];
    const placeholders = s.tiles.map((tile, index) => {
      const base = values.length;
      values.push(
        tile.id,
        index,
        tile.title,
        tile.project,
        JSON.stringify(this.analysis.encode(tile.analysis)),
        tile.view,
        tile.width,
        tile.layout ? JSON.stringify(tile.layout) : null,
      );
      return `($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 7}, $${base + 8}::jsonb)`;
    });

    await exec(
      this.db,
      `INSERT INTO dashboard_tiles (dashboard_id, id, position, title, project_id, analysis, view, width, grid_layout)
       VALUES ${placeholders.join(", ")}`,
      values,
    );
  }

  async delete(id: DashboardId): Promise<void> {
    await exec(this.db, `DELETE FROM dashboards WHERE id = $1`, [id]);
  }

  private async one(text: string, values: unknown[]): Promise<Dashboard<A> | null> {
    const row = await firstRow<DashboardRow>(this.db, text, values);
    if (row === null) return null;

    const tiles = await rows<TileRow>(
      this.db,
      `SELECT id, title, project_id, analysis, view, width, grid_layout
       FROM dashboard_tiles WHERE dashboard_id = $1 ORDER BY position`,
      [row.id],
    );

    return Dashboard.rehydrate<A>({
      id: DashboardId(row.id),
      workspace: WorkspaceId(row.workspace_id),
      name: row.name,
      isDefault: row.is_default,
      share: this.shareOf(row),
      tiles: tiles.map((tile) => this.tileOf(row.id, tile)),
    });
  }

  private shareOf(row: DashboardRow): ShareGrant | null {
    if (row.share_digest === null || row.share_expires_at === null) return null;
    return {
      dashboard: DashboardId(row.id),
      digest: row.share_digest,
      expiresAt: instantOf(row.share_expires_at),
    };
  }

  private tileOf(dashboard: string, row: TileRow): Tile<A> {
    const where = { table: "dashboard_tiles", id: `${dashboard}/${row.id}` };
    if (row.grid_layout !== null && !validTileLayout(row.grid_layout, row.width))
      throw new RowDecodeError("dashboard_tiles", row.id, "grid_layout", row.grid_layout);
    return {
      ...(row.grid_layout === null ? {} : { layout: row.grid_layout }),
      id: TileId(row.id),
      title: row.title,
      project: ProjectId(row.project_id),
      analysis: this.analysis.decode(row.analysis),
      view: decodeText<TileView>(row.view, isTileView, { ...where, column: "view" }),
      width: decodeNumeric(row.width, TileWidth.isValid, { ...where, column: "width" }),
    };
  }
}
