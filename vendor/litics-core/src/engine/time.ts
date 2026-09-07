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

const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|\+00(?::?00)?)$/;

/**
 * `Date` or an ISO-8601 string → microseconds. A UTC string keeps up to six
 * fraction digits exactly (`2026-09-01T10:00:00.000001Z` is one microsecond
 * past the hour); anything else goes through `Date` at millisecond precision.
 */
export const toMicros = (value: Date | string): number => {
  if (typeof value === "string") {
    const m = ISO_UTC.exec(value.trim());
    if (m) {
      const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
      if (!Number.isFinite(ms)) throw new RangeError(`litics: ${JSON.stringify(value)} is not a timestamp`);
      const fraction = (m[7] ?? "").padEnd(6, "0");
      return ms * 1000 + Number(fraction);
    }
  }
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(ms)) throw new RangeError(`litics: ${JSON.stringify(String(value))} is not a timestamp`);
  return Math.round(ms * 1000);
};

/** Microseconds → an ISO-8601 UTC string with six fraction digits, the inverse of `toMicros`. */
export const fromMicros = (us: number): string => {
  const ms = Math.floor(us / 1000);
  const rest = us - ms * 1000;
  return `${new Date(ms).toISOString().slice(0, -1)}${String(rest).padStart(3, "0")}Z`;
};

export const floorHour = (us: number): number => Math.floor(us / HOUR_US) * HOUR_US;
export const ceilHour = (us: number): number => Math.ceil(us / HOUR_US) * HOUR_US;

/** The bucket `us` falls in: `origin + floor((us − origin) / step) · step`. */
export const binOf = (us: number, originUs: number, stepUs: number): number =>
  originUs + Math.floor((us - originUs) / stepUs) * stepUs;

/** A SQL expression for a µs parameter as timestamptz. Exact integer arithmetic, no float. */
export const tsExpr = (param: string): string => `('epoch'::timestamptz + ${param}::int8 * interval '1 microsecond')`;

/** A SQL expression reading a timestamptz column back as µs text (int8 is text on the wire). */
export const usExpr = (column: string): string => `(extract(epoch from ${column}) * 1000000)::int8::text`;

export const toDate = (us: number): Date => new Date(us / 1000);
