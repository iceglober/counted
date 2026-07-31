import { describe, expect, test } from "bun:test";
import { DashboardId, ProjectId, WorkspaceId } from "../shared/ids";
import { Duration, Instant } from "../shared";
import { Analysis, FieldRef, Measure, Window } from "../analytics";
import { Dashboard, MAX_TILES, type ShareGrant } from "./dashboard";
import { ROW_UNITS, Tile, TileId, TileWidth, type TileContent } from "./tile";
import type { DashboardError } from "./errors";

const t0 = Instant.fromEpochMillis(1_700_000_000_000);
const later = Instant.plus(t0, Duration.days(1));
const dash = DashboardId("dsh_1");
const ws = WorkspaceId("ws_1");
const projA = ProjectId("prj_a");
const projB = ProjectId("prj_b");
const week = Window.lastDays(7);

const content = (): TileContent => ({
  kind: "analysis",
  analysis: Analysis.countOverWindow(week),
  view: "number",
});

const tile = (n: string, width: TileWidth = TileWidth.HALF, project = projA) =>
  Tile.of(TileId(`tile_${n}`), `Tile ${n}`, project, content(), width);

const must = <T>(r: { ok: true; value: T } | { ok: false; error: DashboardError }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const errorOf = <T>(r: { ok: true; value: T } | { ok: false; error: DashboardError }): DashboardError => {
  if (r.ok) throw new Error("expected an error, got ok");
  return r.error;
};

const empty = () => must(Dashboard.create(dash, ws, "Overview", t0)).dashboard;
const withTiles = (...tiles: Tile[]) =>
  tiles.reduce((d, t) => must(d.addTile(t, later)).dashboard, empty());

describe("ownership", () => {
  test("a dashboard belongs to a workspace, never to a nullable user", () => {
    const d = empty();
    expect(d.workspace).toBe(ws);
    // v1 had dashboards.userId nullable, and every guard read
    // `if (existing.userId && existing.userId !== session.user.id)` — so a
    // NULL owner meant "editable by anyone". There is no such state here.
  });

  test("a blank name is refused", () => {
    expect(errorOf(Dashboard.create(dash, ws, "  ", t0)).kind).toBe("NameRequired");
  });
});

describe("a tile names its own project", () => {
  test("projects are read from the tiles, not inherited downwards", () => {
    const d = withTiles(tile("a", TileWidth.HALF, projA), tile("b", TileWidth.HALF, projB));
    expect(d.projects()).toEqual([projA, projB]);
  });

  test("the same project appears once", () => {
    expect(withTiles(tile("a"), tile("b")).projects()).toEqual([projA]);
  });

  // Tile.of requires a ProjectId, so a tile without one does not compile.
  // v1 made it optional and resolved `insight.projectId ?? dashboardProjectId`
  // in some paths but not others, which is how a metric card drew its headline
  // from one project and its sparkline from another.
});

describe("width is one vocabulary", () => {
  test("twelfths, 1 to 12", () => {
    expect(TileWidth.isValid(1)).toBe(true);
    expect(TileWidth.isValid(12)).toBe(true);
    expect(TileWidth.isValid(0)).toBe(false);
    expect(TileWidth.isValid(13)).toBe(false);
    expect(TileWidth.isValid(4.5)).toBe(false);
    expect(ROW_UNITS).toBe(12);
  });

  test("the named fractions are twelfths too", () => {
    expect(TileWidth.THIRD).toBe(4);
    expect(TileWidth.HALF).toBe(6);
    expect(TileWidth.TWO_THIRDS).toBe(8);
    expect(TileWidth.FULL).toBe(12);
  });
});

describe("rows pack deterministically", () => {
  test("two halves share a row", () => {
    const rows = withTiles(tile("a", 6), tile("b", 6)).rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(2);
  });

  test("a tile that will not fit starts a new row", () => {
    const rows = withTiles(tile("a", 8), tile("b", 6), tile("c", 6)).rows();
    expect(rows.map((r) => r.length)).toEqual([1, 2]);
  });

  test("three thirds share a row, the fourth wraps", () => {
    const rows = withTiles(tile("a", 4), tile("b", 4), tile("c", 4), tile("d", 4)).rows();
    expect(rows.map((r) => r.length)).toEqual([3, 1]);
  });

  test("a full-width tile always sits alone", () => {
    const rows = withTiles(tile("a", 6), tile("b", 12), tile("c", 6)).rows();
    expect(rows.map((r) => r.length)).toEqual([1, 1, 1]);
  });

  test("an empty dashboard has no rows", () => {
    expect(empty().rows()).toEqual([]);
    expect(empty().isEmpty).toBe(true);
  });

  test("packing is a pure function of order and width — same on server, client and share page", () => {
    const d = withTiles(tile("a", 4), tile("b", 8), tile("c", 6));
    expect(d.rows().map((r) => r.map((t) => t.id))).toEqual(d.rows().map((r) => r.map((t) => t.id)));
  });
});

describe("tiles", () => {
  test("adding, then finding", () => {
    const d = must(empty().addTile(tile("a"), later)).dashboard;
    expect(d.tiles).toHaveLength(1);
    expect(d.tile(TileId("tile_a"))?.title).toBe("Tile a");
  });

  test("duplicate ids are refused", () => {
    expect(errorOf(withTiles(tile("a")).addTile(tile("a"), later)).kind).toBe("TileExists");
  });

  test("a blank title is refused", () => {
    const bad = Tile.of(TileId("t"), "   ", projA, content());
    expect(errorOf(empty().addTile(bad, later)).kind).toBe("TileTitleRequired");
  });

  test("tile count is capped", () => {
    let d = empty();
    for (let i = 0; i < MAX_TILES; i++) d = must(d.addTile(tile(`t${i}`), later)).dashboard;
    expect(errorOf(d.addTile(tile("one_more"), later))).toMatchObject({ kind: "TooManyTiles", max: MAX_TILES });
  });

  test("removing an unknown tile is an error, not a silent no-op", () => {
    expect(errorOf(empty().removeTile(TileId("nope"), later)).kind).toBe("NoSuchTile");
  });

  test("resizing changes only that tile", () => {
    const d = must(withTiles(tile("a", 6), tile("b", 6)).resizeTile(TileId("tile_a"), 12, later)).dashboard;
    expect(d.tile(TileId("tile_a"))?.width).toBe(12);
    expect(d.tile(TileId("tile_b"))?.width).toBe(6);
  });

  test("a no-op resize is refused rather than emitting an event", () => {
    expect(errorOf(withTiles(tile("a", 6)).resizeTile(TileId("tile_a"), 6, later)).kind).toBe("WidthUnchanged");
  });

  test("moving reorders the flow", () => {
    const d = withTiles(tile("a"), tile("b"), tile("c"));
    const moved = must(d.moveTile(TileId("tile_c"), 0, later)).dashboard;
    expect(moved.tiles.map((t) => t.id)).toEqual([TileId("tile_c"), TileId("tile_a"), TileId("tile_b")]);
  });

  test("moving out of range is refused", () => {
    const d = withTiles(tile("a"), tile("b"));
    expect(errorOf(d.moveTile(TileId("tile_a"), 5, later))).toMatchObject({ kind: "IndexOutOfRange", size: 2 });
    expect(errorOf(d.moveTile(TileId("tile_a"), 0, later)).kind).toBe("PositionUnchanged");
  });

  test("replacing swaps content while keeping position", () => {
    const d = withTiles(tile("a"), tile("b"));
    const updated = Tile.withTitle(d.tile(TileId("tile_a"))!, "Renamed");
    const after = must(d.replaceTile(updated, later)).dashboard;
    expect(after.tiles[0]!.title).toBe("Renamed");
    expect(after.tiles.map((t) => t.id)).toEqual([TileId("tile_a"), TileId("tile_b")]);
  });
});

describe("sharing is a capability with an expiry", () => {
  const grant: ShareGrant = { digest: "share_secret", expiresAt: Instant.plus(t0, Duration.days(30)) };

  test("a share grant lets a digest read, until it expires", () => {
    const d = must(empty().grantShare(grant, t0)).dashboard;
    expect(d.allowsShareRead("share_secret", later)).toBe(true);
    expect(d.allowsShareRead("wrong", later)).toBe(false);
    expect(d.allowsShareRead("share_secret", Instant.plus(t0, Duration.days(31)))).toBe(false);
  });

  test("an unshared dashboard allows nothing", () => {
    expect(empty().allowsShareRead("anything", later)).toBe(false);
  });

  test("an already-expired grant is refused", () => {
    const stale: ShareGrant = { digest: "x", expiresAt: t0 };
    expect(errorOf(empty().grantShare(stale, t0)).kind).toBe("ShareGrantExpired");
  });

  test("unsharing revokes, and cannot be repeated", () => {
    const shared = must(empty().grantShare(grant, t0)).dashboard;
    const revoked = must(shared.unshare(later)).dashboard;
    expect(revoked.allowsShareRead("share_secret", later)).toBe(false);
    expect(errorOf(revoked.unshare(later)).kind).toBe("NotShared");
  });
});

describe("person-only content is visible on the tile", () => {
  test("a retention tile always requires identity", () => {
    const retentionTile = Tile.of(TileId("r"), "Retention", projA, {
      kind: "retention",
      retention: { window: week, grain: "day", periods: 3, basis: "person" },
    });
    expect(Tile.requiresPerson(retentionTile)).toBe(true);
  });

  test("a distinct-people analysis does too", () => {
    const t = Tile.of(TileId("p"), "People", projA, {
      kind: "analysis",
      analysis: { measure: Measure.distinctPeople(), window: week },
      view: "number",
    });
    expect(Tile.requiresPerson(t)).toBe(true);
  });

  test("an ordinary count does not", () => {
    expect(Tile.requiresPerson(tile("a"))).toBe(false);
  });
});

describe("rehydration and immutability", () => {
  test("snapshot round-trips", () => {
    const built = withTiles(tile("a", 4, projA), tile("b", 8, projB));
    const revived = Dashboard.rehydrate(built.snapshot());
    expect(revived.tiles.map((t) => t.id)).toEqual(built.tiles.map((t) => t.id));
    expect(revived.projects()).toEqual([projA, projB]);
    expect(revived.rows().map((r) => r.length)).toEqual(built.rows().map((r) => r.length));
  });

  test("commands leave the original untouched", () => {
    const before = withTiles(tile("a"));
    const after = must(before.addTile(tile("b"), later)).dashboard;
    expect(before.tiles).toHaveLength(1);
    expect(after.tiles).toHaveLength(2);
  });
});

describe("the analysis is reusable across dashboards", () => {
  test("a tile holds an Analysis, so the same question can sit on two dashboards", () => {
    const shared = Analysis.breakdown(Measure.count(), FieldRef.system("os_name"), week);
    const a = Tile.of(TileId("x"), "By OS", projA, { kind: "analysis", analysis: shared, view: "bar" });
    const b = Tile.of(TileId("y"), "By OS", projB, { kind: "analysis", analysis: shared, view: "table" });
    expect(Analysis.toKey(shared)).toBe(Analysis.toKey((b.content as { analysis: Analysis }).analysis));
    expect(a.project).not.toBe(b.project);
  });
});
