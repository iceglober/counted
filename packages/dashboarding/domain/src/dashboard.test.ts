import { describe, expect, test } from "bun:test";
import { DashboardId, Duration, Instant, ProjectId, TileId, WorkspaceId } from "@counted/kernel";
import type { Result } from "@counted/kernel";
import { Dashboard, MAX_TILES } from "./dashboard";
import { ShareGrant } from "./share-grant";
import { Tile, TileWidth, ROW_UNITS } from "./tile";
import type { DashboardError } from "./errors";
import type { DashboardApplied } from "./dashboard";

/**
 * The analysis is opaque to this domain, so the tests use a stand-in. If these
 * tests could only be written against the real Analysis IR, the type parameter
 * would not be doing its job.
 */
type Q = { readonly question: string };
const q = (question: string): Q => ({ question });

const t0 = Instant.fromEpochMillis(1_700_000_000_000);
const at = (d: Duration) => Instant.plus(t0, d);
const later = at(Duration.days(1));

const dash = DashboardId("dsh_1");
const sibling = DashboardId("dsh_2");
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

const tile = (n: string, width: TileWidth = TileWidth.HALF, project = projA) =>
  Tile.of(TileId(`tile_${n}`), `Tile ${n}`, project, q(n), "number", width);

const empty = () => must(Dashboard.create<Q>(dash, ws, "Overview", t0)).dashboard;
const withTiles = (...tiles: readonly Tile<Q>[]) =>
  tiles.reduce<Dashboard<Q>>((d, t) => must(d.addTile(t, later)).dashboard, empty());

const applied = (r: Result<DashboardApplied<Q>, DashboardError>) => must(r);

describe("ownership", () => {
  test("a dashboard belongs to a workspace, never to a nullable user", () => {
    // v1 had dashboards.userId nullable and every guard read
    // `if (existing.userId && existing.userId !== session.user.id)` — so a NULL
    // owner meant "editable by anyone". There is no such state here.
    expect(empty().workspace).toBe(ws);
  });

  test("a blank name is refused", () => {
    expect(errorOf(Dashboard.create<Q>(dash, ws, "  ", t0)).kind).toBe("NameRequired");
  });

  test("the name is stored trimmed, so two dashboards cannot differ by a space", () => {
    expect(must(Dashboard.create<Q>(dash, ws, "  Overview  ", t0)).dashboard.name).toBe("Overview");
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
});

describe("width is one vocabulary", () => {
  test("twelfths, 1 to 12, and nothing else", () => {
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

  test("a width outside the vocabulary cannot enter the aggregate", () => {
    // The one place an invalid width can arrive is deserialized input that was
    // asserted rather than parsed. v1's `spanToCols` silently mapped anything
    // it did not recognise to one column.
    const bad = { ...tile("a"), width: 99 as TileWidth };
    expect(errorOf(empty().addTile(bad, later))).toMatchObject({ kind: "InvalidWidth", width: 99 });
  });
});

describe("rows pack deterministically", () => {
  test("two halves share a row", () => {
    expect(withTiles(tile("a", 6), tile("b", 6)).rows()).toHaveLength(1);
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
    const once = d.rows().map((r) => r.map((t) => t.id));
    const twice = d.rows().map((r) => r.map((t) => t.id));
    expect(once).toEqual(twice);
  });
});

describe("the tile lifecycle — every step reachable, which is what v2 lacked", () => {
  test("adding, then finding", () => {
    const d = must(empty().addTile(tile("a"), later)).dashboard;
    expect(d.tiles).toHaveLength(1);
    expect(d.tile(TileId("tile_a"))?.title).toBe("Tile a");
  });

  test("adding names the project on the event, so the outbox does not have to reload the tile", () => {
    const { events } = applied(empty().addTile(tile("a", TileWidth.HALF, projB), later));
    expect(events).toEqual([
      { kind: "TileAdded", dashboard: dash, tile: TileId("tile_a"), project: projB, at: later },
    ]);
  });

  test("duplicate ids are refused", () => {
    expect(errorOf(withTiles(tile("a")).addTile(tile("a"), later)).kind).toBe("TileExists");
  });

  test("a blank title is refused", () => {
    const bad = Tile.of(TileId("t"), "   ", projA, q("x"));
    expect(errorOf(empty().addTile(bad, later)).kind).toBe("TileTitleRequired");
  });

  test("updating swaps content while keeping position", () => {
    const d = withTiles(tile("a"), tile("b"));
    const renamed = Tile.withTitle(d.tile(TileId("tile_a"))!, "Renamed");
    const after = must(d.updateTile(renamed, later)).dashboard;
    expect(after.tiles[0]!.title).toBe("Renamed");
    expect(after.tiles.map((t) => t.id)).toEqual([TileId("tile_a"), TileId("tile_b")]);
  });

  test("updating an unknown tile does not quietly add it", () => {
    // v1's persistLayout upserted, so a stale client could resurrect a tile
    // another tab had deleted.
    expect(errorOf(empty().updateTile(tile("ghost"), later)).kind).toBe("NoSuchTile");
    expect(must(empty().rename("x", later)).dashboard.tiles).toHaveLength(0);
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

  test("moving out of range is refused, and so is moving nowhere", () => {
    const d = withTiles(tile("a"), tile("b"));
    expect(errorOf(d.moveTile(TileId("tile_a"), 5, later))).toMatchObject({ kind: "IndexOutOfRange", size: 2 });
    expect(errorOf(d.moveTile(TileId("tile_a"), -1, later)).kind).toBe("IndexOutOfRange");
    expect(errorOf(d.moveTile(TileId("tile_a"), 0, later)).kind).toBe("PositionUnchanged");
  });

  test("removing an unknown tile is an error, not a silent no-op", () => {
    expect(errorOf(empty().removeTile(TileId("nope"), later)).kind).toBe("NoSuchTile");
  });

  test("removing keeps the rest in order", () => {
    const d = withTiles(tile("a"), tile("b"), tile("c"));
    const after = must(d.removeTile(TileId("tile_b"), later)).dashboard;
    expect(after.tiles.map((t) => t.id)).toEqual([TileId("tile_a"), TileId("tile_c")]);
  });
});

describe("reordering is all-or-nothing", () => {
  const three = () => withTiles(tile("a"), tile("b"), tile("c"));
  const ids = (d: Dashboard<Q>) => d.tiles.map((t) => t.id);

  test("a full permutation rearranges every tile in one write", () => {
    const after = must(
      three().reorderTiles([TileId("tile_c"), TileId("tile_a"), TileId("tile_b")], later),
    ).dashboard;
    expect(ids(after)).toEqual([TileId("tile_c"), TileId("tile_a"), TileId("tile_b")]);
  });

  test("a partial order is refused rather than appending the remainder", () => {
    // Accepting a subset and appending what is left is how a client bug drops
    // tiles out of a layout without anything reporting a failure.
    expect(errorOf(three().reorderTiles([TileId("tile_a")], later))).toMatchObject({
      kind: "NotAPermutation",
      expected: 3,
      received: 1,
    });
  });

  test("a duplicate in the order is refused", () => {
    expect(
      errorOf(three().reorderTiles([TileId("tile_a"), TileId("tile_a"), TileId("tile_b")], later)).kind,
    ).toBe("NotAPermutation");
  });

  test("an unknown tile in the order names itself", () => {
    expect(
      errorOf(three().reorderTiles([TileId("tile_a"), TileId("tile_b"), TileId("ghost")], later)),
    ).toMatchObject({ kind: "NoSuchTile", tile: TileId("ghost") });
  });

  test("reordering to the order it already has is refused", () => {
    expect(
      errorOf(three().reorderTiles([TileId("tile_a"), TileId("tile_b"), TileId("tile_c")], later)).kind,
    ).toBe("OrderUnchanged");
  });
});

describe("the tile limit is a boundary, not a suggestion", () => {
  const full = () => {
    let d = empty();
    for (let i = 0; i < MAX_TILES; i++) d = must(d.addTile(tile(`t${i}`), later)).dashboard;
    return d;
  };

  test("exactly MAX_TILES tiles fit", () => {
    expect(full().tiles).toHaveLength(MAX_TILES);
  });

  test("the one after that is refused, and says the limit", () => {
    expect(errorOf(full().addTile(tile("one_more"), later))).toMatchObject({
      kind: "TooManyTiles",
      max: MAX_TILES,
    });
  });

  test("the refusal leaves the dashboard exactly as it was", () => {
    const d = full();
    const refused = d.addTile(tile("one_more"), later);
    expect(refused.ok).toBe(false);
    expect(d.tiles).toHaveLength(MAX_TILES);
  });

  test("removing one makes room for exactly one more", () => {
    const freed = must(full().removeTile(TileId("tile_t0"), later)).dashboard;
    const refilled = must(freed.addTile(tile("one_more"), later)).dashboard;
    expect(refilled.tiles).toHaveLength(MAX_TILES);
    expect(errorOf(refilled.addTile(tile("and_another"), later)).kind).toBe("TooManyTiles");
  });

  test("the limit counts tiles, so updating at the limit still works", () => {
    const d = full();
    const renamed = Tile.withTitle(d.tiles[0]!, "Still fine");
    expect(must(d.updateTile(renamed, later)).dashboard.tiles).toHaveLength(MAX_TILES);
  });
});

describe("renaming and the default dashboard", () => {
  test("a rename to the same name is refused rather than emitting an event", () => {
    expect(errorOf(empty().rename("Overview", later)).kind).toBe("NameUnchanged");
    expect(errorOf(empty().rename("  Overview  ", later)).kind).toBe("NameUnchanged");
  });

  test("a blank rename is refused", () => {
    expect(errorOf(empty().rename("  ", later)).kind).toBe("NameRequired");
  });

  test("marking default is a fact about this dashboard only", () => {
    // v1 enforced one default per *user* with a partial unique index while the
    // loader resolved the default per *project*. Which dashboard opened was
    // whichever query ran. Here the aggregate states only its own flag and the
    // use case clears the previous holder.
    const d = must(empty().markDefault(later)).dashboard;
    expect(d.isDefault).toBe(true);
    expect(errorOf(d.markDefault(later)).kind).toBe("DefaultUnchanged");
    const cleared = must(d.clearDefault(later)).dashboard;
    expect(cleared.isDefault).toBe(false);
    expect(errorOf(cleared.clearDefault(later)).kind).toBe("DefaultUnchanged");
  });
});

describe("a share token is a view of one page, not a guest account", () => {
  const digest = "sha256:share_secret";
  const grant = ShareGrant.of(dash, digest, at(Duration.days(30)));
  const shared = () => must(empty().grantShare(grant, t0)).dashboard;

  test("the right digest reads, until it expires", () => {
    expect(shared().allowsShareRead(digest, later)).toBe(true);
    expect(shared().allowsShareRead(digest, at(Duration.days(31)))).toBe(false);
  });

  test("a grant minted for a sibling dashboard cannot be attached to this one", () => {
    const forSibling = ShareGrant.of(sibling, digest, at(Duration.days(30)));
    expect(errorOf(empty().grantShare(forSibling, t0)).kind).toBe("ShareGrantMismatch");
  });

  test("a sibling's grant, if it reaches this aggregate anyway, does not open it", () => {
    // The path this defends: a repository resolves a digest with a query that
    // forgot to constrain the dashboard, and hands back the wrong aggregate
    // carrying a grant that was minted elsewhere. The grant names its dashboard,
    // so the read is refused instead of served.
    const misfiled = Dashboard.rehydrate<Q>({
      ...empty().snapshot(),
      share: ShareGrant.of(sibling, digest, at(Duration.days(30))),
    });
    expect(misfiled.allowsShareRead(digest, later)).toBe(false);
    expect(errorOf(misfiled.authorizeShareRead(digest, later)).kind).toBe("ShareGrantMismatch");
  });

  test("one dashboard's live share says nothing about another's", () => {
    const other = must(Dashboard.create<Q>(sibling, ws, "Sibling", t0)).dashboard;
    expect(other.allowsShareRead(digest, later)).toBe(false);
    expect(errorOf(other.authorizeShareRead(digest, later)).kind).toBe("NotShared");
  });

  test("a wrong digest and an unshared dashboard answer the same, so this is not an oracle", () => {
    expect(errorOf(shared().authorizeShareRead("wrong", later)).kind).toBe("NotShared");
    expect(errorOf(empty().authorizeShareRead("wrong", later)).kind).toBe("NotShared");
  });

  test("the right digest past expiry is told it expired — it already had the token", () => {
    expect(errorOf(shared().authorizeShareRead(digest, at(Duration.days(31)))).kind).toBe("ShareGrantExpired");
  });

  test("a grant that expires exactly now is already dead", () => {
    const expiring = ShareGrant.of(dash, digest, at(Duration.days(30)));
    const d = must(empty().grantShare(expiring, t0)).dashboard;
    expect(d.allowsShareRead(digest, at(Duration.days(30)))).toBe(false);
  });

  test("an already-expired grant is refused at minting", () => {
    expect(errorOf(empty().grantShare(ShareGrant.of(dash, digest, t0), t0)).kind).toBe("ShareGrantExpired");
  });

  test("re-sharing replaces the live grant, so revoking a link is one action", () => {
    const replaced = must(shared().grantShare(ShareGrant.of(dash, "sha256:second", at(Duration.days(30))), later)).dashboard;
    expect(replaced.allowsShareRead(digest, later)).toBe(false);
    expect(replaced.allowsShareRead("sha256:second", later)).toBe(true);
  });

  test("unsharing revokes, and cannot be repeated", () => {
    const revoked = must(shared().unshare(later)).dashboard;
    expect(revoked.allowsShareRead(digest, later)).toBe(false);
    expect(errorOf(revoked.unshare(later)).kind).toBe("NotShared");
  });
});

describe("rehydration and immutability", () => {
  test("a snapshot round-trips", () => {
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

describe("the editable grid", () => {
  const placements = [
    { id: TileId("tile_a"), x: 0, y: 0, width: 3 as TileWidth, height: 3 },
    { id: TileId("tile_b"), x: 3, y: 0, width: 9 as TileWidth, height: 7 },
  ];
  test("persists width, independent height and position without changing questions", () => {
    const board = withTiles(tile("a"), tile("b"));
    const changed = must(board.setLayout(placements, later));
    expect(changed.dashboard.tiles[0]).toMatchObject({ width: 3, layout: { x: 0, y: 0, height: 3 }, analysis: q("a") });
    expect(changed.dashboard.tiles[1]).toMatchObject({ width: 9, layout: { x: 3, y: 0, height: 7 } });
    expect(changed.events[0]?.kind).toBe("DashboardLayoutChanged");
    expect(must(changed.dashboard.setLayout(placements, later)).events).toEqual([]);
  });
  test("refuses missing, duplicate, unknown, overlapping and out-of-bounds placements atomically", () => {
    const board = withTiles(tile("a"), tile("b"));
    for (const bad of [placements.slice(0, 1), [placements[0]!, placements[0]!],
      [placements[0]!, { ...placements[1]!, id: TileId("elsewhere") }],
      [placements[0]!, { ...placements[1]!, x: 2 }],
      [placements[0]!, { ...placements[1]!, x: 4 }],
      [placements[0]!, { ...placements[1]!, height: 0 }],
      [placements[0]!, { ...placements[1]!, y: -1 }]]) {
      expect(errorOf(board.setLayout(bad, later)).kind).toBe("InvalidLayout");
    }
    expect(board.tiles.every((tile) => tile.layout === undefined)).toBe(true);
  });
  test("reading order follows placement instead of request order", () => {
    const board = withTiles(tile("a"), tile("b"));
    const changed = must(board.setLayout([{ ...placements[0]!, y: 7 }, { ...placements[1]!, x: 0 }], later));
    expect(changed.dashboard.tiles.map((tile) => tile.id)).toEqual([TileId("tile_b"), TileId("tile_a")]);
  });
});
