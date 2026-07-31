/**
 * The chart's arithmetic.
 *
 * Tested as numbers rather than as markup, because the way a chart fails is a
 * wrong value drawn convincingly — a baseline that is not zero, a curve
 * inventing a dip, a `NaN` swallowing a path. None of those look like errors,
 * and a snapshot of an SVG string would pass through every one of them.
 */

import { describe, expect, test } from "bun:test";
import { geometryFor, type Point } from "./series-chart";

const series = (...values: number[]): Point[] =>
  values.map((value, index) => ({ bucketStart: `2026-01-0${index + 1}T00:00:00Z`, value }));

/** Every `L x y` / `M x y` pair in a path, as numbers. */
const coordinates = (path: string): { x: number; y: number }[] =>
  [...path.matchAll(/[ML]\s+([\d.]+)\s+([\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

describe("the baseline is always zero", () => {
  test("a series that never approaches zero is not stretched to fill the axis", () => {
    // The single most common way a chart lies: scaling to the minimum makes
    // 900→1000 look like a collapse to nothing and back.
    const { line } = geometryFor(series(900, 1000));
    const points = coordinates(line);
    const [first, second] = points;

    // 900 sits at 90% of the height of 1000, not at the bottom.
    expect(first!.y).toBeGreaterThan(second!.y);
    const span = first!.y - second!.y;
    const height = 140 - 3 * 2;
    expect(span / height).toBeCloseTo(0.1, 2);
  });

  test("the peak touches the top and nothing exceeds it", () => {
    const { line } = geometryFor(series(1, 5, 3));
    const ys = coordinates(line).map((c) => c.y);
    expect(Math.min(...ys)).toBeCloseTo(3, 5);
    expect(Math.max(...ys)).toBeLessThanOrEqual(140 - 3);
  });
});

describe("degenerate input does not produce a broken path", () => {
  test("a single point does not divide by zero", () => {
    // `index / (length - 1)` is `0/0` for one point, which renders `NaN` into
    // the path and silently draws nothing at all.
    const { line, area } = geometryFor(series(7));
    expect(line).not.toContain("NaN");
    expect(area).not.toContain("NaN");
    expect(coordinates(line)).toHaveLength(1);
  });

  test("an all-zero series sits on the baseline rather than vanishing", () => {
    const { line, max } = geometryFor(series(0, 0, 0));
    expect(max).toBe(0);
    expect(line).not.toContain("NaN");
    for (const point of coordinates(line)) expect(point.y).toBeCloseTo(140 - 3, 5);
  });

  test("no points produces no path rather than a malformed one", () => {
    const { line, area } = geometryFor([]);
    expect(line).toBe("");
    expect(area).toBe("");
  });
});

describe("the line is straight, not smoothed", () => {
  test("the path uses only move and line commands", () => {
    // A bezier through the points invents values between them — a curve
    // dipping below zero between two positive buckets is drawing data that
    // does not exist.
    const { line } = geometryFor(series(1, 9, 2, 8));
    expect(line).toMatch(/^M[\s\d.]+(L[\s\d.]+)+$/);
    expect(line).not.toMatch(/[CSQTA]/);
  });

  test("there is exactly one vertex per bucket", () => {
    // No interpolated points: what is drawn is what was measured.
    expect(coordinates(geometryFor(series(1, 2, 3, 4, 5)).line)).toHaveLength(5);
  });
});

describe("the area closes to the baseline", () => {
  test("it returns along the bottom and closes", () => {
    const { area } = geometryFor(series(1, 2));
    expect(area.endsWith("Z")).toBe(true);
    const bottom = coordinates(area).slice(-2);
    for (const point of bottom) expect(point.y).toBeCloseTo(140 - 3, 5);
  });

  test("the area starts from the same points the line does", () => {
    // Two paths derived separately would be free to disagree, which shows up
    // as a fill that floats off its own line.
    const { line, area } = geometryFor(series(3, 1, 4));
    expect(area.startsWith(line)).toBe(true);
  });
});

describe("horizontal placement", () => {
  test("buckets are evenly spaced across the full width", () => {
    const xs = coordinates(geometryFor(series(1, 1, 1, 1, 1)).line).map((c) => c.x);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 5);
    expect(xs[0]).toBeCloseTo(3, 5);
    expect(xs[xs.length - 1]).toBeCloseTo(480 - 3, 5);
  });
});
