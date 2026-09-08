/**
 * The slots a workspace is entitled to.
 *
 * Its own module, and not a member of `plan.ts` or `workspace.ts`, because both
 * of those need it and a shared type living in either one would make the two
 * import each other. `no-circular` would catch that; putting the shared value
 * where it belongs is cheaper than discovering it.
 *
 * `null` means unlimited. Not `-1`, which is what v1 used and then compared
 * with `>=` in one place and `!==` in another, so an unlimited plan was both
 * uncapped and capped at minus one depending on which file you were in.
 */

export type WorkspaceLimits = {
  readonly maxProjects: number | null;
  readonly maxSeats: number | null;
};

export const WorkspaceLimits = {
  UNLIMITED: { maxProjects: null, maxSeats: null } as WorkspaceLimits,

  of: (maxProjects: number | null, maxSeats: number | null): WorkspaceLimits => ({
    maxProjects,
    maxSeats,
  }),

  equal: (a: WorkspaceLimits, b: WorkspaceLimits): boolean =>
    a.maxProjects === b.maxProjects && a.maxSeats === b.maxSeats,

  /**
   * The limit `count` would breach by taking one more slot, or null when there
   * is room. Returns the number rather than a boolean because every caller
   * needs it — the error says which limit, the event says which limit — and a
   * boolean would send each of them back to re-read `maxProjects` and re-decide
   * whether `null` meant unlimited. That second decision is where "at the cap"
   * becomes `>=` in one file and `>` in another.
   */
  breached: (count: number, limit: number | null): number | null =>
    limit !== null && count >= limit ? limit : null,

  /**
   * The limit `count` is already past, or null. The downgrade question, not the
   * admission one: three projects under a cap of three are at the cap, not over
   * it, and only the second is worth telling the customer about.
   */
  over: (count: number, limit: number | null): number | null =>
    limit !== null && count > limit ? limit : null,
} as const;
