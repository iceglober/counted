/**
 * What an engine read's exception means, in the port's vocabulary.
 *
 * Anything unrecognised becomes `Unavailable` rather than `InvalidQuery`: the
 * read was planned from a config this package validated at import, so "the
 * question was wrong" is nearly always the less likely explanation.
 */

import { AbortError, SegmentCorruptError, SegmentFormatError } from "@litics/core";
import type { EngineFailure } from "@counted/analytics-ports";
import type { Duration } from "@counted/kernel";

/**
 * A caller that walked away.
 *
 * `EngineFailure` has no "cancelled" kind and inventing one would ripple
 * through the contract's error table for a case the client already knows
 * about — it is the one that aborted. `Unavailable` with a detail that says so
 * keeps the shape and does not claim the engine timed out, which would be a
 * different instruction to whoever reads the log.
 */
export const cancelled: EngineFailure = {
  kind: "Unavailable",
  detail: "the caller cancelled the query before it finished",
};

export const failureFor = (cause: unknown, budget: Duration): EngineFailure => {
  if (cause instanceof AbortError) return cancelled;
  if (cause instanceof SegmentFormatError || cause instanceof SegmentCorruptError) {
    // Data the engine cannot read: an operator's problem, named precisely, and
    // never a number.
    return { kind: "Unavailable", detail: cause.message };
  }
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? String((cause as { code?: unknown }).code)
      : "";
  const detail = cause instanceof Error ? cause.message : String(cause);

  switch (code) {
    case "57014": // query_canceled — statement_timeout fired.
      return { kind: "Timeout", budget };
    case "42P01": // undefined_table
    case "3F000": // invalid_schema_name
      return {
        kind: "Unavailable",
        detail: `the analytics schema is not present — run the litics migrations (${detail})`,
      };
    case "53300": // too_many_connections
    case "53400": // configuration_limit_exceeded
    case "57P01": // admin_shutdown
    case "57P02": // crash_shutdown
    case "57P03": // cannot_connect_now
      return { kind: "Unavailable", detail };
    case "42501": // insufficient_privilege
      return { kind: "Unavailable", detail: `the analytics role lacks a grant (${detail})` };
    default:
      break;
  }
  // litics validates a read before touching the database and throws a plain
  // RangeError with a `litics:` prefix — an unknown dimension, a step that is
  // not a fixed interval. `plan.ts` refuses these first, so reaching here means
  // the two disagreed, and that is worth saying as a question problem.
  if (cause instanceof RangeError || detail.startsWith("litics:")) {
    return { kind: "InvalidQuery", detail };
  }
  return { kind: "Unavailable", detail };
};
