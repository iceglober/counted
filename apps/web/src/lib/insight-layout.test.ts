import { describe, expect, test } from "bun:test";
import { collides, type Layout } from "react-grid-layout";
import {
  adjustLayout,
  applyMobileLayout,
  insightCompactor,
  insightLayout,
  mobileLayout,
  moveMobileInsight,
  placementsOf,
  packInsights,
  packInteractiveLayout,
} from "./insight-layout";
import type { ContractOutputs } from "./client";

type Insight =
  ContractOutputs["dashboards"]["get"]["dashboard"]["tiles"][number];
const insight = (
  id: string,
  width: number,
  view: Insight["view"] = "number",
): Insight => ({
  id,
  width,
  view,
  title: id,
  project: "project",
  analysis: {
    shape: "scalar",
    measure: { kind: "count" },
    window: { kind: "relative", amount: 7, unit: "day" },
    summary: "total",
  },
});
const noOverlap = (layout: Layout) => {
  for (let i = 0; i < layout.length; i++)
    for (const other of layout.slice(i + 1))
      expect(collides(layout[i]!, other)).toBe(false);
};

describe("Insight grid editing", () => {
  test("legacy Insights get compact numbers, larger charts, and space beside saved geometry", () => {
    const layout = insightLayout([
      { ...insight("saved", 6, "line"), layout: { x: 0, y: 0, height: 8 } },
      insight("number", 3),
      insight("chart", 6, "line"),
    ]);
    expect(placementsOf(layout)[0]).toEqual({
      id: "saved",
      x: 0,
      y: 0,
      width: 6,
      height: 8,
    });
    expect(layout[1]!.h).toBeLessThan(layout[2]!.h);
    noOverlap(layout);
  });

  test("a dropped or enlarged card moves a chain of neighbors and closes gaps while preserving widths and heights", () => {
    const layout = insightCompactor.compact(
      [
        { i: "enlarged", x: 0, y: 0, w: 6, h: 8 },
        { i: "neighbor", x: 3, y: 3, w: 6, h: 6 },
        { i: "below", x: 0, y: 9, w: 6, h: 6 },
        { i: "spaced", x: 9, y: 25, w: 3, h: 3 },
      ],
      12,
    );
    noOverlap(layout);
    expect(layout.find((item) => item.i === "spaced")).toMatchObject({
      x: 6,
      y: 0,
      w: 3,
      h: 3,
    });
    expect(layout.find((item) => item.i === "below")!.y).toBe(8);
  });

  test("shrinking or removing an Insight pulls the cards beneath it upward", () => {
    const saved = insightLayout([
      { ...insight("top", 12, "line"), layout: { x: 0, y: 0, height: 8 } },
      { ...insight("below", 12, "line"), layout: { x: 0, y: 8, height: 6 } },
    ]);
    const resized = adjustLayout(saved, "top", { h: 5 });
    expect(resized.find((item) => item.i === "below")).toMatchObject({
      x: 0,
      y: 5,
      w: 12,
      h: 6,
    });
    expect(saved.find((item) => item.i === "below")!.y).toBe(8);
    const removed = insightLayout([
      { ...insight("below", 12, "line"), layout: { x: 0, y: 8, height: 6 } },
    ]);
    expect(removed[0]).toMatchObject({ x: 0, y: 0, w: 12, h: 6 });
    noOverlap(resized);
  });

  test("existing saved gaps condense consistently for viewing and sharing", () => {
    const compacted = insightLayout([
      { ...insight("left", 6, "table"), layout: { x: 0, y: 0, height: 8 } },
      { ...insight("right", 6, "line"), layout: { x: 6, y: 0, height: 5 } },
      { ...insight("next", 6, "line"), layout: { x: 6, y: 8, height: 6 } },
    ]);
    expect(compacted.find((item) => item.i === "next")).toMatchObject({
      x: 6,
      y: 5,
      w: 6,
      h: 6,
    });
    expect(insightCompactor.compact(compacted, 12)).toEqual(compacted);
    noOverlap(compacted);
  });

  test("fills left-hand holes and moves cards upward across columns", () => {
    const across = packInsights(
      [
        { i: "tall", x: 0, y: 0, w: 6, h: 8 },
        { i: "short", x: 6, y: 0, w: 6, h: 3 },
        { i: "below", x: 0, y: 8, w: 4, h: 5 },
      ],
      12,
    );
    expect(across.find((item) => item.i === "below")).toMatchObject({
      x: 6,
      y: 3,
      w: 4,
      h: 5,
    });
    expect(
      packInsights([{ i: "alone", x: 9, y: 12, w: 3, h: 3 }], 12)[0],
    ).toMatchObject({ x: 0, y: 0, w: 3, h: 3 });
    const shrunk = adjustLayout(
      [
        { i: "a", x: 0, y: 0, w: 6, h: 5 },
        { i: "b", x: 6, y: 0, w: 6, h: 5 },
      ],
      "a",
      { w: 3 },
    );
    expect(shrunk.find((item) => item.i === "b")).toMatchObject({
      x: 3,
      y: 0,
      w: 6,
      h: 5,
    });
    noOverlap(across);
    noOverlap(shrunk);
  });

  test("holds the dragged card while its neighbor fills the vacated space", () => {
    const original = [
      { i: "a", x: 0, y: 0, w: 3, h: 3 },
      { i: "b", x: 3, y: 0, w: 3, h: 3 },
      { i: "c", x: 6, y: 0, w: 3, h: 3 },
      { i: "d", x: 9, y: 0, w: 3, h: 3 },
    ];
    const moved = adjustLayout(original, "a", { x: 3 });
    expect(moved.find((item) => item.i === "a")).toMatchObject({ x: 3, y: 0 });
    expect(moved.find((item) => item.i === "b")).toMatchObject({ x: 0, y: 0 });
    expect(placementsOf(moved).map((item) => item.id)).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
    expect(original[0]!.x).toBe(0);
    expect(moved.some((item) => item.static)).toBe(false);
    noOverlap(moved);
  });

  test("intermediate drag positions do not scramble the rest of a mixed-size dashboard", () => {
    const initial = [
      ...["a", "b", "c", "d"].map((i, index) => ({
        i,
        x: index * 3,
        y: 0,
        w: 3,
        h: 3,
      })),
      { i: "wide", x: 0, y: 3, w: 8, h: 7 },
      { i: "narrow", x: 8, y: 3, w: 4, h: 7 },
    ];
    let current: Layout = initial;
    for (const x of [1, 2, 3]) {
      current = packInteractiveLayout(
        current.map((item) => (item.i === "a" ? { ...item, x } : item)),
        12,
        initial,
        "a",
      );
      noOverlap(current);
    }
    const released = packInsights(current, 12);
    expect(placementsOf(released).map((item) => item.id)).toEqual([
      "b",
      "a",
      "c",
      "d",
      "wide",
      "narrow",
    ]);
    expect(released.find((item) => item.i === "wide")).toMatchObject({
      x: 0,
      y: 3,
      w: 8,
      h: 7,
    });
    expect(released.find((item) => item.i === "narrow")).toMatchObject({
      x: 8,
      y: 3,
      w: 4,
      h: 7,
    });
  });

  test("mixed sizes settle without overlap, mutation, or any earlier fitting slot", () => {
    for (let seed = 0; seed < 20; seed++) {
      const original = Array.from({ length: 16 }, (_, index) => ({
        i: String(index),
        x: (index + seed) % 3,
        y: index * 4,
        w: 2 + ((index * 7 + seed) % 8),
        h: 3 + ((index * 3 + seed) % 9),
      }));
      const before = structuredClone(original);
      const packed = packInsights(original, 12);
      expect(original).toEqual(before);
      expect(placementsOf(packInsights(packed, 12))).toEqual(
        placementsOf(packed),
      );
      noOverlap(packed);
      for (const item of packed) {
        expect(item.w).toBe(original.find((other) => other.i === item.i)!.w);
        expect(item.h).toBe(original.find((other) => other.i === item.i)!.h);
        expect(item.x).toBeGreaterThanOrEqual(0);
        expect(item.x + item.w).toBeLessThanOrEqual(12);
        for (let y = 0; y <= item.y; y++) {
          for (let x = 0; x <= 12 - item.w; x++) {
            if (y === item.y && x >= item.x) break;
            expect(
              packed.some(
                (other) =>
                  other.i !== item.i && collides({ ...item, x, y }, other),
              ),
            ).toBe(true);
          }
        }
      }
    }
  });

  test("keyboard sizing stays bounded and never overlaps or mutates saved geometry", () => {
    const saved = insightLayout([
      insight("number", 3),
      insight("chart", 6, "line"),
    ]);
    const original = placementsOf(saved);
    const changed = adjustLayout(saved, "number", { w: 20, h: -1, x: -10 });
    expect(changed[0]).toMatchObject({ w: 12, h: 3, x: 0 });
    expect(placementsOf(saved)).toEqual(original);
    noOverlap(changed);
  });

  test("viewing on a phone does not alter desktop geometry; phone editing retains desktop widths", () => {
    const desktop = insightLayout([
      insight("a", 3),
      insight("b", 8, "line"),
      insight("c", 6, "table"),
    ]);
    const before = placementsOf(desktop);
    const mobile = mobileLayout(desktop);
    expect(mobile.every((item) => item.w === 1 && item.x === 0)).toBe(true);
    noOverlap(mobile);
    expect(placementsOf(desktop)).toEqual(before);
    const moved = moveMobileInsight(desktop, "c", -1);
    expect(placementsOf(moved).map((item) => item.id)).toEqual(["a", "c", "b"]);
    const resized = applyMobileLayout(
      moved,
      mobileLayout(moved).map((item) =>
        item.i === "b" ? { ...item, h: 10 } : item,
      ),
    );
    expect(resized.find((item) => item.i === "b")).toMatchObject({
      w: 8,
      h: 10,
    });
    noOverlap(resized);
  });
});
