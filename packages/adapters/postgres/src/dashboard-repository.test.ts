/**
 * What a DashboardRepository over Postgres has to get right.
 */

import { afterAll, beforeEach, expect, test } from "bun:test";
import { DashboardId, ProjectId, TileId, WorkspaceId } from "@counted/kernel";
import { Dashboard, Tile, TileWidth, type ShareGrant } from "@counted/dashboarding-domain";
import {
  T0,
  at,
  givenProject,
  givenWorkspace,
  liveHarness,
  must,
  type Harness,
  type TestAnalysis,
} from "./fixtures";
import { closeDatabase, describeLive } from "./testing";

const analysis = (metric: string): TestAnalysis => ({ metric, window: 7 });

describeLive("PostgresDashboardRepository", () => {
  let h: Harness;
  let workspace: WorkspaceId;
  let web: ProjectId;
  let app: ProjectId;

  beforeEach(async () => {
    h = await liveHarness();
    await h.reset();
    workspace = await givenWorkspace(h.repositories);
    web = await givenProject(h.repositories, workspace, "prj_web", "Web");
    app = await givenProject(h.repositories, workspace, "prj_app", "App");
  });
  afterAll(closeDatabase);

  const board = async (id = "dsh_1", name = "Overview"): Promise<Dashboard<TestAnalysis>> => {
    const created = must(Dashboard.create<TestAnalysis>(DashboardId(id), workspace, name, T0));
    await h.repositories.dashboards.save(created.dashboard, created.events);
    return created.dashboard;
  };

  const withTiles = async (dashboard: Dashboard<TestAnalysis>): Promise<Dashboard<TestAnalysis>> => {
    let current = dashboard;
    for (const [id, project, metric] of [
      ["tile_a", web, "signups"],
      ["tile_b", app, "sessions"],
      ["tile_c", web, "revenue"],
    ] as const) {
      const added = must(
        current.addTile(
          Tile.of(TileId(id), metric, project, analysis(metric), "line", TileWidth.THIRD),
          T0,
        ),
      );
      current = added.dashboard;
    }
    await h.repositories.dashboards.save(current, []);
    return current;
  };

  test("tiles come back in the order they were placed", async () => {
    // Layout is a flow: order plus a width in twelfths. v1 carried absolute grid
    // coordinates, drag-resize, a compact flag and per-tile pinning — four
    // mechanisms for one job, and `compact` was written into the layout JSON
    // without appearing in the type that described it.
    await withTiles(await board());

    const loaded = await h.repositories.dashboards.find(DashboardId("dsh_1"));
    expect(loaded?.snapshot().tiles.map((tile) => tile.id)).toEqual([
      TileId("tile_a"),
      TileId("tile_b"),
      TileId("tile_c"),
    ]);
    expect(loaded?.snapshot().tiles[0]?.analysis).toEqual(analysis("signups"));
    expect(loaded?.snapshot().tiles[0]?.width).toBe(TileWidth.THIRD);
    expect(loaded?.snapshot().tiles[0]?.view).toBe("line");
  });

  test("grid geometry survives a database round trip", async () => {
    const current = await withTiles(await board());
    const changed = must(current.setLayout(current.tiles.map((tile, index) => ({
      id: tile.id, x: index * 4, y: 0, width: TileWidth.THIRD, height: index + 3,
    })), T0));
    await h.repositories.dashboards.save(changed.dashboard, changed.events);
    const loaded = await h.repositories.dashboards.find(current.id);
    expect(loaded?.tiles.map((tile) => tile.layout)).toEqual([
      { x: 0, y: 0, height: 3 }, { x: 4, y: 0, height: 4 }, { x: 8, y: 0, height: 5 },
    ]);
  });

  test("a tile names its own project, and never inherits one", async () => {
    // v1 made projectId optional on an insight and inherited it from the
    // dashboard, which is how a metric card drew its headline from one project
    // and its sparkline from another.
    await withTiles(await board());
    const loaded = await h.repositories.dashboards.find(DashboardId("dsh_1"));
    expect(loaded?.snapshot().tiles.map((tile) => tile.project)).toEqual([web, app, web]);
  });

  test("reordering rewrites positions rather than leaving a gap", async () => {
    const filled = await withTiles(await board());
    const reordered = must(
      filled.reorderTiles([TileId("tile_c"), TileId("tile_a"), TileId("tile_b")], T0),
    );
    await h.repositories.dashboards.save(reordered.dashboard, reordered.events);

    const loaded = await h.repositories.dashboards.find(DashboardId("dsh_1"));
    expect(loaded?.snapshot().tiles.map((tile) => tile.id)).toEqual([
      TileId("tile_c"),
      TileId("tile_a"),
      TileId("tile_b"),
    ]);
    const { rows } = await h.pool.query<{ position: number }>(
      `SELECT position FROM dashboard_tiles WHERE dashboard_id = 'dsh_1' ORDER BY position`,
    );
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  test("projectsReadBy is the distinct set a share link may query", async () => {
    // A share grant's binding is derived from exactly this set: the link may run
    // the queries the page it shows needs, and no others.
    await withTiles(await board());
    expect(await h.repositories.dashboards.projectsReadBy(DashboardId("dsh_1"))).toEqual([
      app,
      web,
    ]);
  });

  test("a workspace cannot hold two default dashboards", async () => {
    // v1 had a partial unique index enforcing one default per *user* while the
    // loader resolved the default per *project*, so the constraint and the query
    // disagreed about what "default" meant.
    const first = must((await board("dsh_1", "One")).markDefault(T0));
    await h.repositories.dashboards.save(first.dashboard, first.events);
    const second = must((await board("dsh_2", "Two")).markDefault(T0));

    expect(h.repositories.dashboards.save(second.dashboard, second.events)).rejects.toThrow(
      /dashboards_one_default_per_workspace/,
    );
    expect((await h.repositories.dashboards.findDefault(workspace))?.snapshot().name).toBe("One");
  });

  test("a share link resolves to the dashboard it was minted for, and to no other", async () => {
    const grant: ShareGrant = {
      dashboard: DashboardId("dsh_1"),
      digest: "s".repeat(64),
      expiresAt: at(60),
    };
    const shared = must((await board()).grantShare(grant, T0));
    await h.repositories.dashboards.save(shared.dashboard, shared.events);
    await board("dsh_2", "Other");

    const found = await h.repositories.dashboards.findByShareDigest(grant.digest);
    expect(found?.snapshot().id).toBe(DashboardId("dsh_1"));
    // The grant is rebuilt from the row's own id, so a grant cannot arrive
    // attached to a sibling dashboard and be honoured.
    expect(found?.snapshot().share?.dashboard).toBe(DashboardId("dsh_1"));
    expect(await h.repositories.dashboards.findByShareDigest("nope")).toBeNull();
  });

  test("summaries carry the counts the list view renders", async () => {
    await withTiles(await board("dsh_1", "Overview"));
    const marked = must((await board("dsh_2", "Default")).markDefault(T0));
    await h.repositories.dashboards.save(marked.dashboard, marked.events);

    expect(await h.repositories.dashboards.listForWorkspace(workspace)).toEqual([
      {
        id: DashboardId("dsh_2"),
        workspace,
        name: "Default",
        tileCount: 0,
        shared: false,
        isDefault: true,
      },
      {
        id: DashboardId("dsh_1"),
        workspace,
        name: "Overview",
        tileCount: 3,
        shared: false,
        isDefault: false,
      },
    ]);
  });

  test("deleting a dashboard takes its tiles", async () => {
    await withTiles(await board());
    await h.repositories.dashboards.delete(DashboardId("dsh_1"));
    expect(await h.repositories.dashboards.find(DashboardId("dsh_1"))).toBeNull();
    expect((await h.pool.query(`SELECT 1 FROM dashboard_tiles`)).rowCount).toBe(0);
  });

  test("removing a tile removes its row rather than orphaning it", async () => {
    const filled = await withTiles(await board());
    const removed = must(filled.removeTile(TileId("tile_b"), T0));
    await h.repositories.dashboards.save(removed.dashboard, removed.events);

    const { rows } = await h.pool.query<{ id: string }>(
      `SELECT id FROM dashboard_tiles WHERE dashboard_id = 'dsh_1' ORDER BY position`,
    );
    expect(rows.map((row) => row.id)).toEqual(["tile_a", "tile_c"]);
  });

  test("a tile view this version does not know is refused loudly", async () => {
    await withTiles(await board());
    await h.pool.query(`UPDATE dashboard_tiles SET view = 'sankey' WHERE id = 'tile_a'`);
    expect(h.repositories.dashboards.find(DashboardId("dsh_1"))).rejects.toThrow(
      /dashboard_tiles\.view/,
    );
  });
});
