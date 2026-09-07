/**
 * How long the outgoing secret keeps working.
 *
 * This is the one part of rotation that is a **product** decision rather than a
 * storage one, which is why `CredentialStore.rotate` takes the window as a
 * parameter and the number lives here. Underneath, rotation is two writes —
 * mint a replacement, then give the old key a short expiry — and the window is
 * the only thing standing between "we rotated the key" and "every deployed
 * client stopped sending events at 14:02".
 *
 * v1 rotated by overwriting the key in place. There was no window at all: the
 * old secret stopped working the instant somebody clicked the button, and the
 * only way to find out was the graph going flat.
 */

import { Duration } from "@counted/kernel";

/**
 * A day. Long enough that a deploy, a cache, or a queue of in-flight requests
 * carrying the old key all drain; short enough that a leaked key is not still
 * live next week — which is the reason most rotations happen.
 */
export const DEFAULT_ROTATION_OVERLAP: Duration = Duration.hours(24);

/**
 * Seven days. Past this an "overlap" is really two live keys, and the operator
 * has stopped rotating and started duplicating.
 */
export const MAX_ROTATION_OVERLAP: Duration = Duration.days(7);

/**
 * Clamp rather than refuse.
 *
 * An overlap is a comfort window, not a correctness parameter: nothing breaks
 * if it is shorter than asked for, and the alternative — a `BAD_REQUEST` on the
 * one call an operator makes while a key is leaking — trades a real emergency
 * against a preference. Zero is honoured exactly, because "cut it off now" is
 * what you want when the old secret is on GitHub.
 */
export const resolveOverlap = (requested: Duration | null): Duration => {
  if (requested === null) return DEFAULT_ROTATION_OVERLAP;
  if (Duration.isNegative(requested)) return Duration.ZERO;
  return Duration.compare(requested, MAX_ROTATION_OVERLAP) > 0
    ? MAX_ROTATION_OVERLAP
    : requested;
};
