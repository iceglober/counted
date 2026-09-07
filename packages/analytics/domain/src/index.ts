/**
 * @counted/analytics-domain — the Analysis IR. No state, no SQL.
 *
 * What to measure, over what window, sliced how. The same `Analysis` a
 * dashboard tile holds is the one a monitor holds — v1 forked them, giving
 * alerts a free-text metric column with its own compiler and a window string
 * parsed by a regex that silently fell through to one hour.
 *
 * Two responsibilities moved in this version.
 *
 * The domain no longer computes bucket edges. litics computes its own, from
 * the hour grid and the query step. The rule's purpose survives — there is
 * still exactly one bucketing implementation — but it is no longer ours, and
 * the failure to avoid is keeping both. What remains is `resolveWindow`, which
 * turns a relative window into absolute bounds against a `now` the caller
 * supplies; that is not bucketing, and it has to happen once per dashboard load
 * rather than once per tile.
 *
 * The domain no longer pretends every predicate costs the same. `answerability`
 * classifies a question as index-answerable, a raw scan, or not answerable at
 * all, and exports the classification — because the adapter needs the flat
 * filter map, a cost control needs to refuse a scan before it runs, and the
 * console needs to say why a filter is slow.
 */

export * from "./dimension";
export * from "./field";
export * from "./predicate";
export * from "./answerability";
export * from "./measure";
export * from "./window";
export * from "./defect";
export * from "./funnel";
export * from "./analysis";
export * from "./readout";
