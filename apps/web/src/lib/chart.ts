/**
 * The chart's arithmetic, kept out of the component so it can be tested
 * without rendering anything.
 *
 * Everything here is transcribed from the data-surface spec (Phase 4). Three
 * of its rules are the ones an implementation gets wrong by default:
 *
 *   R8/R9  the series ramp is exactly three steps and **pattern is the primary
 *          category channel**. The three ramp colours clear 8.2–15.5:1 against
 *          the page but only 1.33–1.88:1 against *each other*, and relative
 *          luminance is also what greyscale conversion preserves — so colour
 *          alone is a genuinely weak signal between neighbours. Each step
 *          carries a dash pattern that does not depend on colour perception.
 *   R10    a fourth series does not get a fourth colour (there isn't one) and
 *          does not reuse one of the three. It collapses into a grey aggregate,
 *          which is unambiguous on sight and in greyscale precisely because it
 *          is not a luminance step of the same hue.
 *   R11    **one shared scale across every series on one chart.** A per-series
 *          maximum lets each line rescale to fill the frame independently, and
 *          the relative-magnitude comparison that is the entire reason for
 *          drawing them together silently disappears. This is the rule the
 *          spec names as most likely to be missed, because reusing a
 *          single-series geometry helper per series is the natural way to
 *          write it.
 */

export type Point = { readonly bucketStart: string; readonly value: number };
export type Series = {
  readonly name: string;
  readonly points: readonly Point[];
};

export type Box = { readonly width: number; readonly height: number };

/** The three named steps plus the overflow aggregate. Order is darkest first. */
export const RAMP = [
  {
    stroke: "var(--chart-1)",
    dash: undefined,
    cap: "butt",
    swatch: "chart-swatch--1",
  },
  {
    stroke: "var(--chart-2)",
    dash: "6 3",
    cap: "butt",
    swatch: "chart-swatch--2",
  },
  {
    stroke: "var(--chart-3)",
    dash: "1.5 3.5",
    cap: "round",
    swatch: "chart-swatch--3",
  },
] as const;

export const OVERFLOW = {
  stroke: "var(--chart-4)",
  dash: "2 2",
  cap: "butt",
  swatch: "chart-swatch--other",
} as const;

/**
 * Solo is its own state, explicitly outside the ramp.
 *
 * A lone line has no neighbour to distinguish itself from, so it keeps the
 * middle step (`--accent`) and the one gradient fill in the product rather than
 * being remapped onto ramp step 1. Declaring it as a named state is what stops
 * it reading as an arbitrary exception.
 */
export const SOLO_STROKE = "var(--chart-2)";

export type Line = {
  readonly name: string;
  readonly d: string;
  readonly stroke: string;
  readonly dash: string | undefined;
  readonly cap: "butt" | "round";
  readonly swatch: string;
  readonly peak: number;
};

export type Chart = {
  readonly lines: readonly Line[];
  /** The shared maximum every line is drawn against (R11). */
  readonly max: number;
  /** How many input series were folded into the overflow line. 0 when none. */
  readonly aggregated: number;
  readonly buckets: number;
  readonly solo: boolean;
};

const peakOf = (points: readonly Point[]): number =>
  points.reduce((highest, point) => Math.max(highest, point.value), 0);

/**
 * Series four and beyond, summed per bucket.
 *
 * The spec leaves the aggregate's own arithmetic open (sum, envelope or mean)
 * because it is a chart-math decision rather than a visual one. Sum is chosen
 * because every measure the contract can put in a series is a count or a total,
 * and the sum of counts is the count of the union — the only one of the three
 * that stays a number of the same thing.
 */
const aggregate = (series: readonly Series[]): Series => {
  const totals = new Map<string, number>();
  const order: string[] = [];
  for (const one of series) {
    for (const point of one.points) {
      if (!totals.has(point.bucketStart)) order.push(point.bucketStart);
      totals.set(
        point.bucketStart,
        (totals.get(point.bucketStart) ?? 0) + point.value,
      );
    }
  }
  return {
    name: `Other (${series.length} more)`,
    points: order.map((bucketStart) => ({
      bucketStart,
      value: totals.get(bucketStart) ?? 0,
    })),
  };
};

const pathFor = (points: readonly Point[], max: number, box: Box): string => {
  if (points.length === 0) return "";
  if (points.length === 1) {
    // One bucket has no line to draw. A 2px dash at the value's height reads as
    // a measurement; a zero-length path renders as nothing at all, which is
    // indistinguishable from the empty state the readout already handles.
    const y = box.height - (points[0]!.value / max) * box.height;
    return `M 0 ${y.toFixed(2)} L ${box.width.toFixed(2)} ${y.toFixed(2)}`;
  }
  const step = box.width / (points.length - 1);
  return points
    .map((point, index) => {
      const x = index * step;
      const y = box.height - (point.value / max) * box.height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
};

export const visibleSeries = (input: readonly Series[]): readonly Series[] =>
  input.length > 3 ? [...input.slice(0, 3), aggregate(input.slice(3))] : input;

export const chartOf = (input: readonly Series[], box: Box): Chart => {
  const named = input.slice(0, 3);
  const overflow = input.slice(3);
  const drawn: readonly Series[] =
    overflow.length === 0 ? named : [...named, aggregate(overflow)];

  // R11 — one maximum over every point on the chart, computed before any line
  // is drawn. Never `Math.max` inside the per-series map.
  const max = Math.max(
    0,
    ...drawn.flatMap((one) => one.points.map((point) => point.value)),
  );
  // A flat chart of zeros would divide by zero. Drawing it along the baseline
  // is the truthful rendering; the readout's own empty state catches the case
  // where there is nothing at all.
  const scale = max === 0 ? 1 : max;

  const solo = drawn.length === 1;

  const lines = drawn.map((one, index) => {
    const step = index < RAMP.length ? RAMP[index]! : OVERFLOW;
    return {
      name: one.name,
      d: pathFor(one.points, scale, box),
      stroke: solo ? SOLO_STROKE : step.stroke,
      dash: solo ? undefined : step.dash,
      cap: solo ? ("butt" as const) : step.cap,
      swatch: step.swatch,
      peak: peakOf(one.points),
    };
  });

  return {
    lines,
    max,
    aggregated: overflow.length,
    buckets: Math.max(0, ...drawn.map((one) => one.points.length)),
    solo,
  };
};
