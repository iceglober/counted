/**
 * Time, as the engine sees it: integer microseconds since the epoch, in a
 * JavaScript number. Postgres keeps timestamps at microsecond precision and
 * 2^53 µs is the year 2255, so nothing is lost in either direction.
 *
 * Every window edge and every bucket is computed here, once, and handed to
 * SQL as an integer — `'epoch' + $n µs` — so the database and the decoder
 * can never disagree about where an hour starts.
 */
import { HOUR_US } from "../segment.js";
export { HOUR_US };
/**
 * `Date` or an ISO-8601 string → microseconds. A UTC string keeps up to six
 * fraction digits exactly (`2026-09-01T10:00:00.000001Z` is one microsecond
 * past the hour); anything else goes through `Date` at millisecond precision.
 */
export declare const toMicros: (value: Date | string) => number;
/** Microseconds → an ISO-8601 UTC string with six fraction digits, the inverse of `toMicros`. */
export declare const fromMicros: (us: number) => string;
export declare const floorHour: (us: number) => number;
export declare const ceilHour: (us: number) => number;
/** The bucket `us` falls in: `origin + floor((us − origin) / step) · step`. */
export declare const binOf: (us: number, originUs: number, stepUs: number) => number;
/** A SQL expression for a µs parameter as timestamptz. Exact integer arithmetic, no float. */
export declare const tsExpr: (param: string) => string;
/** A SQL expression reading a timestamptz column back as µs text (int8 is text on the wire). */
export declare const usExpr: (column: string) => string;
export declare const toDate: (us: number) => Date;
