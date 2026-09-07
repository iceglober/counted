/**
 * Pack everything in staging now.
 *
 * The compactor does this on its own cadence; this is the synchronous form —
 * for the journey suite, which has just written an event and wants to prove
 * the segment path answers the same as the staging path, and for an operator
 * who wants "make it current" without waiting a tick. Lives here because
 * `flush` is litics', and only this package may say so.
 */

import { flush, type PackOutcome } from "@litics/core";

import { resolved, STREAM } from "./config";

/** The pool shape litics' `flush` wants: a real `pg.Pool`. */
export type PackPool = Parameters<typeof flush>[0];

export type { PackOutcome };

/** Pack every staged event of every project into segments, and say what was packed. */
export const packNow = (pool: PackPool): Promise<PackOutcome[]> => flush(pool, resolved, STREAM);
