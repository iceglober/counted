/**
 * How long a workspace's events are kept.
 *
 * Advertised on the pricing page since launch and never implemented: v1 had no
 * purge job, no retention column, and no worker to run one in. This is the
 * policy half — pure, so the arithmetic that decides what gets deleted is
 * testable without a database anywhere near it.
 *
 * The awkward part, and the reason this needs stating rather than assuming:
 * **partitions are global and retention is per-plan.** One monthly partition
 * holds every workspace's events for that month, so dropping it deletes data
 * for all of them at once. It is therefore only safe to drop a partition once
 * it is past the *longest* retention any plan grants — and everything shorter
 * than that has to be deleted per project instead.
 *
 * Both halves are needed. Only dropping partitions would keep free-plan data
 * for two years when the page says six months, which for a product whose whole
 * claim is restraint about data is the wrong direction to be wrong in.
 */

import { Duration } from "../shared/duration";
import { Instant } from "../shared/instant";
import type { Entitlement } from "./entitlement";
import { PLAN_IDS, PlanCatalog } from "./plan";

/**
 * The instant before which this entitlement's events may be deleted.
 *
 * `null` means keep indefinitely — an unlimited plan, or one with no retention
 * limit. Callers must treat that as "delete nothing", never as "delete now".
 */
export const retentionCutoff = (entitlement: Entitlement, now: Instant): Instant | null => {
  const days = entitlement.limits.retentionDays;
  if (days === null) return null;
  return Instant.minus(now, Duration.days(days));
};

/**
 * The longest retention any plan grants, in days.
 *
 * `null` when some plan keeps events indefinitely — in which case no partition
 * may ever be dropped, because one of its rows might belong to that plan.
 */
export const longestRetentionDays = (): number | null => {
  let longest = 0;
  for (const id of PLAN_IDS) {
    const days = PlanCatalog.limitsFor(id).retentionDays;
    if (days === null) return null;
    longest = Math.max(longest, days);
  }
  return longest;
};

/**
 * The instant before which a whole partition is expired for everyone.
 *
 * This is the only cutoff a `DROP TABLE` may be compared against. Using a
 * shorter one would delete a paying customer's data along with a free
 * workspace's, and a dropped partition is not recoverable.
 */
export const globalPurgeCutoff = (now: Instant): Instant | null => {
  const days = longestRetentionDays();
  return days === null ? null : Instant.minus(now, Duration.days(days));
};

/**
 * Whether a project needs row-level purging in addition to partition drops.
 *
 * True when its plan keeps events for less time than the longest plan does —
 * its data in the gap sits inside partitions other customers still need.
 */
export const needsRowPurge = (entitlement: Entitlement): boolean => {
  const mine = entitlement.limits.retentionDays;
  const longest = longestRetentionDays();
  if (mine === null) return false;
  if (longest === null) return true;
  return mine < longest;
};
