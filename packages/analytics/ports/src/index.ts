/**
 * @counted/analytics-ports — how a question reaches an engine, and what comes
 * back.
 *
 * The Analysis IR — what to measure, over what window, sliced how — lives in
 * `@counted/analytics-domain`. This package is one layer down from it: the
 * resolved, engine-level request that an Analysis is translated into, with
 * relative windows already turned into absolute bounds.
 */

export * from "./analytics-engine";
export * from "./event-retention";
export * from "./schema-catalog";
