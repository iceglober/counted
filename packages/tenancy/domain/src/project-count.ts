/**
 * One counting rule for projects, in one place.
 *
 * **The defect this exists to close.** v2 counted a workspace's projects in two
 * places and the two disagreed. `provisionProject` compared the cap against
 * `activeProjects()` — archived projects were free — while the SQL that loaded
 * the workspace selected `id, name, state FROM projects WHERE workspace_id = $1`
 * with no state filter and every other reader treated the result as "the
 * projects". So a workspace with three active and two archived projects was
 * simultaneously at 3/3 (may not create another) and at 5/3 (already over) with
 * no code path that could report both. A customer archives a project to make
 * room, the create button starts working, and the usage bar still says they are
 * over. Two counts of one number is the same bug as v1's three definitions of
 * "is this customer on Pro?", one level down.
 *
 * The rule: **a project consumes a slot exactly while it is active.** Archived
 * projects keep their data and their name and cost nothing. Every question
 * about how many projects a workspace has — the cap check, the downgrade
 * report, the usage readout — goes through `countAgainstCap` here, and the test
 * beside this file asserts that those three agree in the presence of archived
 * projects.
 *
 * The counterpart rule is that *un*-archiving is a cap decision too. A slot
 * freed by archiving can have been taken by the time the customer wants it
 * back, so `Workspace.restoreProject` re-checks. Without that, archive/restore
 * is a way to hold more active projects than the plan allows.
 */

import type { ProjectId } from "@counted/kernel";

export type ProjectState = "active" | "archived";

/**
 * The workspace's view of a project: enough to enforce the cap and to name
 * things, not the project itself. The Project aggregate owns credentials,
 * retention and its own lifecycle.
 */
export type ProjectEntry = {
  readonly id: ProjectId;
  readonly name: string;
  readonly state: ProjectState;
};

/**
 * Does this project consume a slot?
 *
 * The whole rule, and the only place it is written. A caller that filters on
 * `state === "active"` itself has forked it.
 */
export const countsAgainstCap = (entry: ProjectEntry): boolean => entry.state === "active";

/** How many slots this set of projects consumes. */
export const countAgainstCap = (entries: readonly ProjectEntry[]): number => {
  let n = 0;
  for (const entry of entries) if (countsAgainstCap(entry)) n += 1;
  return n;
};

/** Every project consuming a slot, in the order given. */
export const activeProjects = (entries: readonly ProjectEntry[]): readonly ProjectEntry[] =>
  entries.filter(countsAgainstCap);

export const findProject = (
  entries: readonly ProjectEntry[],
  id: ProjectId,
): ProjectEntry | undefined => entries.find((entry) => entry.id === id);
