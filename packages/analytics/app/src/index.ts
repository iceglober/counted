/**
 * @counted/analytics-app — turning an Analysis into engine calls.
 *
 * Resolves relative windows against the Clock exactly once, translates the
 * Analysis IR into the resolved queries `@counted/analytics-ports` describes,
 * and assembles readouts. Conversion rates, zero-fill and trend arithmetic are
 * computed here rather than in SQL, which is what keeps them testable without
 * a database.
 */

export {};
