import { beforeEach, describe, expect, test } from "bun:test";
import { DashboardId, Duration, Instant, ProjectId, TileId, WorkspaceId } from "@counted/kernel";
import type { Result } from "@counted/kernel";
import { Dashboard, ShareGrant, Tile } from "@counted/dashboarding-domain";
import type { DashboardError } from "@counted/dashboarding-domain";
import {
  addTile,
  createDashboard,
  deleteDashboard,
  moveTile,
  removeTile,
  reorderTiles,
  renameDashboard,
  resizeTile,
  resolveShare,
  setDefaultDashboard,
  shareDashboard,
  unshareDashboard,
  updateTile,
} from "./dashboards";
import type { DashboardDeps } from "./ports";
import { FakeDashboards, T0, countingIds, fakeShareTokens, q, stepClock } from "./test-support";
import type { Q } from "./test-support";

const ws = WorkspaceId("ws_1");
const projA = ProjectId("prj_a");
const projB = ProjectId("prj_b");

const must = <T>(r: Result<T, DashboardError>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const errorOf = <T>(r: Result<T, DashboardError>): DashboardError => {
  if (r.ok) throw new Error("expected an error, got ok");
  return r.error;
};

let dashboards: FakeDashboards;
let deps: DashboardDeps<Q>;

beforeEach(() => {
  dashboards = new FakeDashboards();
  deps = {
    dashboards,
    clock: stepClock(),
    ids: countingIds("id"),
    shareTokens: fakeShareTokens(),
  };
});

const seeded = (name = "Overview", isDefault = false) => {
  const d = must(
    Dashboard.create<Q>(DashboardId(`dsh_${name}`), ws, name, T0, isDefault),
  ).dashboard;
  dashboards.seed(d);
  return d;
};

describe("creating", () => {
  test("a dashboard is minted with a generated id and saved with its events", async () => {
    const created = must(await createDashboard(deps, { workspace: ws, name: "Overview" }));
    expect(created.id).toBe(DashboardId("id_1"));
    expect(dashboards.saved).toHaveLength(1);
    expect(dashboards.saved[0]!.events[0]).toMatchObject({ kind: "DashboardCreated" });
  });

  test("a blank name never reaches the store", async () => {
    expect(errorOf(await createDashboard(deps, { workspace: ws, name: "  " })).kind).toBe("NameRequired");
    expect(dashboards.saved).toHaveLength(0);
  });
});

describe("a workspace has at most one default dashboard", () => {
  test("creating a second default clears the first", async () => {
    seeded("First", true);
    const second = must(await createDashboard(deps, { workspace: ws, name: "Second", makeDefault: true }));

    expect(second.isDefault).toBe(true);
    expect(dashboards.defaults(ws)).toBe(1);
  });

  test("promoting an existing dashboard demotes the incumbent", async () => {
    const first = seeded("First", true);
    const second = seeded("Second");

    const promoted = must(await setDefaultDashboard(deps, second.id));
    expect(promoted.isDefault).toBe(true);
    expect((await dashboards.find(first.id))?.isDefault).toBe(false);
    expect(dashboards.defaults(ws)).toBe(1);
  });

  test("promoting the one that already is the default is refused, not written twice", async () => {
    const only = seeded("Only", true);
    expect(errorOf(await setDefaultDashboard(deps, only.id)).kind).toBe("DefaultUnchanged");
    expect(dashboards.saved).toHaveLength(0);
  });

  test("a default in another workspace is left alone", async () => {
    const other = WorkspaceId("ws_2");
    const elsewhere = must(Dashboard.create<Q>(DashboardId("dsh_x"), other, "Theirs", T0, true)).dashboard;
    dashboards.seed(elsewhere);

    await createDashboard(deps, { workspace: ws, name: "Ours", makeDefault: true });
    expect((await dashboards.find(elsewhere.id))?.isDefault).toBe(true);
  });
});

describe("a command against a dashboard that does not exist names the id", () => {
  const missing = DashboardId("dsh_nope");

  test("rename, delete, share and every tile command agree", async () => {
    const expected = { kind: "NoSuchDashboard", dashboard: missing };
    expect(errorOf(await renameDashboard(deps, { dashboard: missing, name: "x" }))).toMatchObject(expected);
    expect(errorOf(await deleteDashboard(deps, missing))).toMatchObject(expected);
    expect(errorOf(await unshareDashboard(deps, missing))).toMatchObject(expected);
    expect(
      errorOf(
        await addTile(deps, {
          dashboard: missing,
          title: "t",
          project: projA,
          analysis: q("a"),
          view: "number",
          width: 6,
        }),
      ),
    ).toMatchObject(expected);
  });
});

describe("tiles — the surface v2 had and could not reach", () => {
  test("adding a tile mints its id and lands it on the dashboard", async () => {
    const d = seeded();
    const after = must(
      await addTile(deps, {
        dashboard: d.id,
        title: "Signups",
        project: projA,
        analysis: q("count(signup)"),
        view: "number",
        width: 6,
      }),
    );

    expect(after.tiles).toHaveLength(1);
    expect(after.tiles[0]!.id).toBe(TileId("id_1"));
    expect(after.tiles[0]!.analysis).toEqual(q("count(signup)"));
    // The point of the whole exercise: the write reached the store.
    expect((await dashboards.find(d.id))?.tiles).toHaveLength(1);
  });

  test("updating a tile is a patch — fields not named keep their values", async () => {
    const d = seeded();
    const withTile = must(
      await addTile(deps, {
        dashboard: d.id,
        title: "Signups",
        project: projA,
        analysis: q("count(signup)"),
        view: "number",
        width: 6,
      }),
    );
    const tile = withTile.tiles[0]!;

    const after = must(await updateTile(deps, { dashboard: d.id, tile: tile.id, title: "Sign-ups" }));
    const updated = after.tile(tile.id)!;

    expect(updated.title).toBe("Sign-ups");
    expect(updated.analysis).toEqual(q("count(signup)"));
    expect(updated.project).toBe(projA);
    expect(updated.width).toBe(6);
    expect(updated.view).toBe("number");
  });

  test("a patch can move a tile to another project without touching its question", async () => {
    const d = seeded();
    const withTile = must(
      await addTile(deps, {
        dashboard: d.id,
        title: "Signups",
        project: projA,
        analysis: q("count(signup)"),
        view: "number",
        width: 6,
      }),
    );
    const tile = withTile.tiles[0]!;
    const after = must(await updateTile(deps, { dashboard: d.id, tile: tile.id, project: projB }));
    expect(after.projects()).toEqual([projB]);
  });

  test("updating an unknown tile is refused before anything is written", async () => {
    const d = seeded();
    expect(
      errorOf(await updateTile(deps, { dashboard: d.id, tile: TileId("ghost"), title: "x" })),
    ).toMatchObject({ kind: "NoSuchTile", tile: TileId("ghost") });
    expect(dashboards.saved).toHaveLength(0);
  });

  test("resize, move, reorder and remove all persist", async () => {
    const d = seeded();
    const add = (title: string) =>
      addTile(deps, {
        dashboard: d.id,
        title,
        project: projA,
        analysis: q(title),
        view: "number",
        width: 6,
      });
    await add("a");
    await add("b");
    const three = must(await add("c"));
    const [a, b, c] = three.tiles.map((t) => t.id) as [TileId, TileId, TileId];

    expect(must(await resizeTile(deps, { dashboard: d.id, tile: a, width: 12 })).tile(a)!.width).toBe(12);
    expect(must(await moveTile(deps, { dashboard: d.id, tile: c, position: 0 })).tiles[0]!.id).toBe(c);
    expect(
      must(await reorderTiles(deps, { dashboard: d.id, order: [a, b, c] })).tiles.map((t) => t.id),
    ).toEqual([a, b, c]);
    expect(must(await removeTile(deps, { dashboard: d.id, tile: b })).tiles).toHaveLength(2);

    expect((await dashboards.find(d.id))?.tiles).toHaveLength(2);
  });
});

describe("sharing", () => {
  test("the token comes back once and only its digest is stored", async () => {
    const d = seeded();
    const shared = must(await shareDashboard(deps, { dashboard: d.id, ttl: Duration.days(7) }));

    expect(shared.token).toBe("tok_1");
    expect(shared.dashboard.share?.digest).toBe("sha256:tok_1");
    expect(JSON.stringify((await dashboards.find(d.id))?.snapshot())).not.toContain('"tok_1"');
  });

  test("the grant expires exactly one ttl after it was minted", async () => {
    const d = seeded();
    const shared = must(await shareDashboard(deps, { dashboard: d.id, ttl: Duration.days(7) }));
    expect(shared.dashboard.share?.expiresAt).toBe(Instant.plus(T0, Duration.days(7)));
  });

  test("a token resolves to the one dashboard it was minted for", async () => {
    const d = seeded();
    await shareDashboard(deps, { dashboard: d.id, ttl: Duration.days(7) });
    expect(must(await resolveShare(deps, "tok_1")).id).toBe(d.id);
  });

  test("a token nobody minted resolves to nothing", async () => {
    seeded();
    expect(errorOf(await resolveShare(deps, "made_up")).kind).toBe("NotShared");
  });

  test("an expired token is told it expired, and stops opening the page", async () => {
    const d = seeded();
    const clock = stepClock();
    deps = { ...deps, clock };
    await shareDashboard(deps, { dashboard: d.id, ttl: Duration.days(1) });

    clock.set(Instant.plus(T0, Duration.days(2)));
    expect(errorOf(await resolveShare(deps, "tok_1")).kind).toBe("ShareGrantExpired");
  });

  test("a digest that resolves to a sibling does not open it", async () => {
    // The failure this defends against: `findByShareDigest` runs a query that
    // forgot to constrain the dashboard and hands back the wrong aggregate. The
    // grant names its dashboard, so the aggregate refuses rather than serving a
    // page the token was never for.
    const target = seeded("Target");
    const sibling = seeded("Sibling");
    dashboards.seed(
      Dashboard.rehydrate<Q>({
        ...sibling.snapshot(),
        share: ShareGrant.of(target.id, "sha256:tok_1", Instant.plus(T0, Duration.days(7))),
      }),
    );
    dashboards.misfileDigest("sha256:tok_1", sibling.id);

    expect(errorOf(await resolveShare(deps, "tok_1")).kind).toBe("ShareGrantMismatch");
  });

  test("unsharing stops the token working", async () => {
    const d = seeded();
    await shareDashboard(deps, { dashboard: d.id, ttl: Duration.days(7) });
    must(await unshareDashboard(deps, d.id));
    expect(errorOf(await resolveShare(deps, "tok_1")).kind).toBe("NotShared");
  });
});

describe("deleting", () => {
  test("a deleted dashboard is gone, and a second delete says so", async () => {
    const d = seeded();
    must(await deleteDashboard(deps, d.id));
    expect(await dashboards.find(d.id)).toBeNull();
    expect(errorOf(await deleteDashboard(deps, d.id)).kind).toBe("NoSuchDashboard");
  });
});

describe("listing", () => {
  test("a summary carries what the console draws before it loads a dashboard", async () => {
    const d = seeded("Overview", true);
    const withTile = must(await addTile(deps, {
      dashboard: d.id,
      title: "t",
      project: projA,
      analysis: q("a"),
      view: "number",
      width: 6,
    }));
    void withTile;
    await shareDashboard(deps, { dashboard: d.id, ttl: Duration.days(7) });

    const [summary] = await dashboards.listForWorkspace(ws);
    expect(summary).toMatchObject({ name: "Overview", tileCount: 1, shared: true, isDefault: true });
  });
});

describe("a dashboard may span projects", () => {
  test("its projects are read from its tiles, which is what a share grant is bound to", async () => {
    const d = seeded();
    for (const [title, project] of [["a", projA], ["b", projB]] as const) {
      await addTile(deps, { dashboard: d.id, title, project, analysis: q(title), view: "number", width: 6 });
    }
    expect(await dashboards.projectsReadBy(d.id)).toEqual([projA, projB]);
  });
});

describe("the aggregate is what refuses, and the use case does not second-guess it", () => {
  test("a tile whose title is blank is refused by the domain rule, through the use case", async () => {
    const d = seeded();
    expect(
      errorOf(
        await addTile(deps, {
          dashboard: d.id,
          title: "   ",
          project: projA,
          analysis: q("a"),
          view: "number",
          width: 6,
        }),
      ).kind,
    ).toBe("TileTitleRequired");
  });

  test("a tile built by hand and a tile built by the use case are the same shape", () => {
    const byHand = Tile.of(TileId("t"), "T", projA, q("a"), "number", 6);
    expect(Object.keys(byHand).sort()).toEqual(
      ["analysis", "id", "project", "title", "view", "width"],
    );
  });
});
