/**
 * Which of three ways a range query is answered — decided before any SQL runs.
 *
 * - summary: the step is whole hours and both edges sit on an hour. Every
 *   bucket is a union of summary rows; no segment is opened.
 * - hybrid: whole-hour step, but `from` or `to` is inside an hour. The
 *   hour-aligned interior comes from summaries; the two slivers at the edges
 *   are answered by decoding only the segments that overlap them and
 *   filtering event by event. This is the correctness trap the design notes:
 *   skipping a straddling segment is silently wrong, so it is never skipped.
 * - scan: the step is not whole hours (fifteen minutes, say). Buckets do not
 *   align with summary rows, so every overlapping segment is decoded.
 *
 * A fourth rule sits above those: the summaries hold marginals — the hour ×
 * event type cell, and that cell split by ONE dimension at a time. A question
 * that names two or more dimensions (a filter and a group, or two filters)
 * has no summary row to read and decodes its segments: `sliced >= 2` forces
 * the scan path whatever the step.
 *
 * All three union the staging tail live, so a query is right before the
 * compactor has ever run.
 */

import { intervalSeconds } from "../config.js";
import { ceilHour, floorHour, HOUR_US, toMicros } from "./time.js";

export type ReadPath = "summary" | "hybrid" | "scan";

export type Window = { readonly fromUs: number; readonly toUs: number };

export type ReadPlan = {
  readonly path: ReadPath;
  readonly fromUs: number;
  readonly toUs: number;
  readonly stepUs: number;
  /** Buckets are anchored here: the hour containing `from`. */
  readonly originUs: number;
  /** The hour-aligned span served by summary rows, if any. */
  readonly interior: Window | null;
  /** Spans answered by decoding segments: the slivers, or the whole window on a scan. */
  readonly edges: readonly Window[];
  readonly groupBy: readonly string[];
  readonly reason: string;
};

export const planRange = (
  q: { from: Date | string; to: Date | string; step: string; groupBy?: readonly string[] },
  options: { readonly sliced?: number } = {},
): ReadPlan => {
  const fromUs = toMicros(q.from);
  const toUs = toMicros(q.to);
  if (!(toUs > fromUs)) throw new RangeError(`litics: query window is empty (${String(q.from)} to ${String(q.to)})`);
  const stepSeconds = intervalSeconds(q.step);
  if (stepSeconds === null || stepSeconds <= 0) {
    throw new RangeError(`litics: step ${JSON.stringify(q.step)} must be a fixed interval of seconds, minutes, hours, days or weeks`);
  }
  const stepUs = stepSeconds * 1_000_000;
  const originUs = floorHour(fromUs);
  const groupBy = [...(q.groupBy ?? [])];

  if ((options.sliced ?? 0) >= 2) {
    return {
      path: "scan",
      fromUs,
      toUs,
      stepUs,
      originUs,
      interior: null,
      edges: [{ fromUs, toUs }],
      groupBy,
      reason: `${options.sliced} dimensions are named; summaries hold one at a time, so every overlapping segment is decoded`,
    };
  }
  if (stepUs % HOUR_US !== 0) {
    return {
      path: "scan",
      fromUs,
      toUs,
      stepUs,
      originUs,
      interior: null,
      edges: [{ fromUs, toUs }],
      groupBy,
      reason: `step '${q.step}' is not a whole number of hours, so buckets do not align with summary rows; every overlapping segment is decoded`,
    };
  }
  const interiorFrom = ceilHour(fromUs);
  const interiorTo = floorHour(toUs);
  const edges: Window[] = [];
  if (interiorFrom >= interiorTo) {
    return {
      path: "scan",
      fromUs,
      toUs,
      stepUs,
      originUs,
      interior: null,
      edges: [{ fromUs, toUs }],
      groupBy,
      reason: "the window does not contain a whole hour; every overlapping segment is decoded",
    };
  }
  if (fromUs < interiorFrom) edges.push({ fromUs, toUs: interiorFrom });
  if (interiorTo < toUs) edges.push({ fromUs: interiorTo, toUs });
  const interior = { fromUs: interiorFrom, toUs: interiorTo };
  return edges.length === 0
    ? {
        path: "summary",
        fromUs,
        toUs,
        stepUs,
        originUs,
        interior,
        edges,
        groupBy,
        reason: `step '${q.step}' is whole hours and both edges are on the hour; answered from summary rows and the staging tail, no segment opened`,
      }
    : {
        path: "hybrid",
        fromUs,
        toUs,
        stepUs,
        originUs,
        interior,
        edges,
        groupBy,
        reason: `step '${q.step}' is whole hours; the interior comes from summary rows, the ${edges.length === 2 ? "two slivers" : "sliver"} at the edge${edges.length === 2 ? "s" : ""} from decoded segments filtered per event`,
      };
};
