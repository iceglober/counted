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
export type ReadPath = "summary" | "hybrid" | "scan";
export type Window = {
    readonly fromUs: number;
    readonly toUs: number;
};
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
export declare const planRange: (q: {
    from: Date | string;
    to: Date | string;
    step: string;
    groupBy?: readonly string[];
}, options?: {
    readonly sliced?: number;
}) => ReadPlan;
