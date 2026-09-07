import { describe, expect, test } from "bun:test";
import { OVERFLOW, RAMP, SOLO_STROKE, chartOf, type Series } from "./chart";

const box = { width: 100, height: 40 };
const series = (name: string, values: readonly number[]): Series => ({
  name,
  points: values.map((value, index) => ({
    bucketStart: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    value,
  })),
});

describe("one shared scale across every series (R11)", () => {
  test("a small series is drawn small beside a large one", () => {
    // The failure this catches: reusing a single-series geometry helper per
    // series, which rescales each line to fill the frame and silently erases
    // the relative-magnitude comparison the chart exists to show.
    const chart = chartOf([series("big", [0, 100]), series("small", [0, 10])], box);

    expect(chart.max).toBe(100);
    // The big line reaches the top of the box (y = 0); the small one reaches
    // a tenth of the way up (y = 36 of 40).
    expect(chart.lines[0]!.d).toContain("L 100.00 0.00");
    expect(chart.lines[1]!.d).toContain("L 100.00 36.00");
  });

  test("an all-zero chart draws along the baseline instead of dividing by zero", () => {
    const chart = chartOf([series("flat", [0, 0, 0])], box);
    expect(chart.max).toBe(0);
    expect(chart.lines[0]!.d).toBe("M 0.00 40.00 L 50.00 40.00 L 100.00 40.00");
  });
});

describe("category is carried by pattern, not only by colour (R9)", () => {
  test("two series get different dash patterns as well as different colours", () => {
    // The three ramp steps measure 1.33–1.88:1 against each other, which is
    // also the greyscale number. Colour alone is a weak signal between them.
    const chart = chartOf([series("a", [1, 2]), series("b", [2, 1])], box);
    expect(chart.lines[0]!.stroke).toBe(RAMP[0].stroke);
    expect(chart.lines[1]!.stroke).toBe(RAMP[1].stroke);
    expect(chart.lines[0]!.dash).toBeUndefined();
    expect(chart.lines[1]!.dash).toBe("6 3");
  });

  test("the dotted step uses round caps, or it renders as tiny rectangles", () => {
    const chart = chartOf([series("a", [1]), series("b", [1]), series("c", [1])], box);
    expect(chart.lines[2]!.cap).toBe("round");
  });
});

describe("a fourth series never gets a fourth blue (R10)", () => {
  test("series four and beyond collapse into one grey aggregate", () => {
    const chart = chartOf(
      [series("a", [1, 1]), series("b", [1, 1]), series("c", [1, 1]), series("d", [2, 2]), series("e", [3, 3])],
      box,
    );

    expect(chart.lines).toHaveLength(4);
    expect(chart.aggregated).toBe(2);
    expect(chart.lines[3]!.stroke).toBe(OVERFLOW.stroke);
    expect(chart.lines[3]!.name).toBe("Other (2 more)");
  });

  test("no ramp colour is ever used twice", () => {
    const many = Array.from({ length: 9 }, (_, index) => series(`s${index}`, [index + 1]));
    const strokes = chartOf(many, box).lines.map((line) => line.stroke);
    expect(new Set(strokes).size).toBe(strokes.length);
  });

  test("the aggregate sums its members per bucket", () => {
    const chart = chartOf(
      [series("a", [0]), series("b", [0]), series("c", [0]), series("d", [2]), series("e", [3])],
      box,
    );
    expect(chart.lines[3]!.peak).toBe(5);
  });
});

describe("solo is its own state, not the ramp with n=1 (§3.2)", () => {
  test("a single series keeps the middle step and no dash", () => {
    // Remapping solo onto ramp step 1 would change today's approved pixels for
    // no encoding benefit: a lone line has no neighbour to differ from.
    const chart = chartOf([series("only", [1, 2, 3])], box);
    expect(chart.solo).toBe(true);
    expect(chart.lines[0]!.stroke).toBe(SOLO_STROKE);
    expect(chart.lines[0]!.dash).toBeUndefined();
  });

  test("adding a second series moves the first onto the ramp", () => {
    const chart = chartOf([series("a", [1]), series("b", [1])], box);
    expect(chart.solo).toBe(false);
    expect(chart.lines[0]!.stroke).toBe(RAMP[0].stroke);
  });
});
