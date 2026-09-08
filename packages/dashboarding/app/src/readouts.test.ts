import { describe, expect, test } from "bun:test";
import { Duration, Instant, ProjectId, TileId } from "@counted/kernel";
import { Tile } from "@counted/dashboarding-domain";
import { ReadoutId } from "@counted/dashboarding-domain";
import type { EngineOutcome, FunnelCounts, Series } from "@counted/analytics-ports";
import {
  breakdownReadout,
  funnelReadout,
  readoutIdFor,
  scalarReadout,
  seriesReadout,
  toReadoutFailure,
} from "./readouts";
import { T0, q } from "./test-support";

const rid = ReadoutId("rd_1");
const at = (mins: number) => Instant.plus(T0, Duration.minutes(mins));

const series = (...values: readonly number[]): EngineOutcome<Series> => ({
  ok: true,
  value: { buckets: values.map((value, i) => ({ start: at(i * 60), value })) },
  computedAt: at(1),
});

describe("a failure is stated, never rendered as an empty chart", () => {
  test("every engine failure maps to a code and a retriable flag", () => {
    expect(toReadoutFailure({ kind: "Timeout", budget: Duration.seconds(5) })).toMatchObject({
      code: "timeout",
      retriable: true,
    });
    expect(toReadoutFailure({ kind: "Unavailable", detail: "pool exhausted" })).toMatchObject({
      code: "engine_unavailable",
      retriable: true,
    });
    expect(toReadoutFailure({ kind: "InvalidQuery", detail: "unknown dimension" })).toMatchObject({
      code: "invalid_request",
      retriable: false,
    });
    expect(toReadoutFailure({ kind: "NotImplemented", feature: "retention" })).toMatchObject({
      code: "unsupported",
      retriable: false,
    });
  });

  test("only the failures a retry could fix are marked retriable", () => {
    // The console draws a retry button off this. Marking an unsupported feature
    // retriable is a loop against a query that will never work; marking a
    // timeout permanent tells a customer to give up on a blip.
    const retriable = (["Timeout", "Unavailable", "InvalidQuery", "NotImplemented"] as const).map(
      (kind) => {
        switch (kind) {
          case "Timeout":
            return toReadoutFailure({ kind, budget: Duration.seconds(1) }).retriable;
          case "Unavailable":
            return toReadoutFailure({ kind, detail: "" }).retriable;
          case "InvalidQuery":
            return toReadoutFailure({ kind, detail: "" }).retriable;
          case "NotImplemented":
            return toReadoutFailure({ kind, feature: "group_by" }).retriable;
        }
      },
    );
    expect(retriable).toEqual([true, true, false, false]);
  });

  test("a failed query is a failed readout, not a zero", () => {
    // v1 wrapped every query in Promise.allSettled and turned any rejection into
    // emptyData(), so "we could not ask" and "you have no traffic" drew the same
    // chart.
    const failed = seriesReadout(rid, { ok: false, error: { kind: "Unavailable", detail: "down" } });
    expect(failed.ok).toBe(false);
    expect(failed.ok === false && failed.failure.detail).toBe("down");
  });

  test("a genuinely empty answer is an answer", () => {
    const empty = seriesReadout(rid, series());
    expect(empty.ok).toBe(true);
    expect(empty.ok === true && empty.value).toEqual({ shape: "series", points: [] });
  });
});

describe("shapes", () => {
  test("a series keeps every bucket, zeros included", () => {
    const readout = seriesReadout(rid, series(3, 0, 5));
    expect(readout.ok === true && readout.value).toMatchObject({
      shape: "series",
      points: [
        { bucketStart: at(0), value: 3 },
        { bucketStart: at(60), value: 0 },
        { bucketStart: at(120), value: 5 },
      ],
    });
  });

  test("a scalar is the total of the window, not the last bucket", () => {
    // A card labelled "this week" that quietly draws the most recent hour is
    // invisible, because the number it shows is always plausible.
    const readout = scalarReadout(rid, series(3, 0, 5));
    expect(readout.ok === true && readout.value).toEqual({ shape: "scalar", value: 8 });
  });

  test("a funnel carries its three counts", () => {
    const outcome: EngineOutcome<FunnelCounts> = {
      ok: true,
      value: { counts: [100, 40, 12] },
      computedAt: at(1),
    };
    expect(funnelReadout(rid, outcome).ok === true).toBe(true);
    const readout = funnelReadout(rid, outcome);
    expect(readout.ok === true && readout.value).toEqual({ shape: "funnel", counts: [100, 40, 12] });
  });

  test("the computed instant travels with the answer, so a stale card can say so", () => {
    const readout = scalarReadout(rid, series(1));
    expect(readout.ok === true && readout.computedAt).toBe(at(1));
  });
});

describe("a breakdown assembled from one series per value", () => {
  test("each part becomes a row, keeping the order it was asked in", () => {
    const readout = breakdownReadout(
      rid,
      [
        { label: "macOS", outcome: series(4, 4) },
        { label: "Windows", outcome: series(3) },
      ],
      at(2),
    );
    expect(readout.ok === true && readout.value).toEqual({
      shape: "breakdown",
      rows: [
        { label: "macOS", value: 8 },
        { label: "Windows", value: 3 },
      ],
    });
  });

  test("one failed part fails the whole readout", () => {
    // Dropping the failed row and drawing the rest re-ranks the chart silently:
    // the missing bar is exactly the one a reader wanted, and nothing on the
    // page says a row was omitted.
    const readout = breakdownReadout(
      rid,
      [
        { label: "macOS", outcome: series(4) },
        { label: "Windows", outcome: { ok: false, error: { kind: "Timeout", budget: Duration.seconds(2) } } },
      ],
      at(2),
    );
    expect(readout.ok).toBe(false);
    expect(readout.ok === false && readout.failure.code).toBe("timeout");
  });

  test("no values is an empty breakdown, not a failure", () => {
    const readout = breakdownReadout(rid, [], at(2));
    expect(readout.ok === true && readout.value).toEqual({ shape: "breakdown", rows: [] });
  });

  test("the readout's instant is when the set was assembled, not when one part answered", () => {
    const readout = breakdownReadout(rid, [{ label: "macOS", outcome: series(1) }], at(99));
    expect(readout.ok === true && readout.computedAt).toBe(at(99));
  });
});

describe("correlation", () => {
  test("a tile's readout is keyed by the tile, and a monitor's is not a tile's", () => {
    const tile = Tile.of(TileId("tile_a"), "Signups", ProjectId("prj_a"), q("count(signup)"));
    expect(readoutIdFor(tile)).toBe(ReadoutId("tile_a"));
  });
});
