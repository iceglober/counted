/**
 * Rendering values the contract hands over. Every one of these is a formatting
 * decision the pages would otherwise each make differently.
 */

/**
 * Counts, with grouping. Explicitly `en-US` rather than the server's locale:
 * a server-rendered number formatted with the machine's locale changes when the
 * machine does, and the same page then renders `1,204` in one region and
 * `1.204` in another — for the same data, with no user preference involved.
 */
export const count = (value: number): string => value.toLocaleString("en-US");

/**
 * A measured value. Large numbers are grouped; fractional ones keep at most one
 * decimal, because a readout that says `1,204.3719` is reporting precision the
 * measurement does not have.
 */
export const measured = (value: number): string =>
  Number.isInteger(value)
    ? count(value)
    : value.toLocaleString("en-US", { maximumFractionDigits: 1 });

/** `null` means unlimited, and says so. Zero would mean "none allowed". */
export const limit = (value: number | null): string => (value === null ? "unlimited" : count(value));

/**
 * An ISO instant as a readable UTC stamp.
 *
 * UTC, not local: the page is rendered on the server, so "local" is the
 * server's timezone and not the reader's — a stamp that silently means
 * `America/New_York` to everyone is worse than one that says `UTC` to
 * everyone. Times are labelled in the markup that uses this.
 */
export const instant = (iso: string): string => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toISOString().replace("T", " ").slice(0, 16);
};

/** Just the day. Used where the time of day carries no information. */
export const day = (iso: string): string => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toISOString().slice(0, 10);
};

/**
 * A duration in whole units, rounded down to the largest that fits.
 *
 * `Duration` on the wire is always milliseconds with an `Ms` suffix on the
 * field name (contract `primitives.ts`), which exists because v1 had a bare
 * `timeout` meaning seconds in one place and milliseconds in another.
 */
export const durationMs = (ms: number): string => {
  const units: readonly (readonly [number, string])[] = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
    [1_000, "second"],
  ];
  for (const [size, name] of units) {
    if (ms >= size) {
      const whole = Math.floor(ms / size);
      return `${whole} ${name}${whole === 1 ? "" : "s"}`;
    }
  }
  return `${ms} ms`;
};

/**
 * A percentage of a limit, or `null` when there is no limit to be a percentage
 * of. Rendering "0%" against unlimited would be a meter that never moves.
 */
export const percentOf = (used: number, allowed: number | null): number | null => {
  if (allowed === null || allowed <= 0) return null;
  return Math.min(100, Math.round((used / allowed) * 100));
};
