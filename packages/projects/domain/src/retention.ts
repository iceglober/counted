/**
 * How long this project's events are kept.
 *
 * The plan sets a ceiling; a project may choose to keep less. It may never
 * choose to keep more, and that clamp is applied here rather than at write time
 * so there is no path where a stored value out-ranks the plan it was bought
 * under — a downgrade must shorten retention immediately, not next time
 * somebody edits the field.
 *
 * The plan's allowance arrives as a **number**, not as an `Entitlement`. This
 * package cannot import `@counted/tenancy-domain` (`no-cross-context-domain`),
 * and the rule genuinely does not need it: "keep the shorter of the two" is
 * arithmetic, and the only thing tenancy has to say is what the ceiling is.
 *
 * v1 advertised retention on the pricing page from launch and never implemented
 * it: no column, no purge job, no worker to run one in.
 */

import { Duration, err, Instant, ok, type Result } from "@counted/kernel";
import type { ProjectError } from "./errors";

/** The longest any plan may grant. A limit on the limit, so a bad plan row cannot mean "forever". */
export const MAX_RETENTION_DAYS = 3_650;

export type RetentionPolicy =
  /** Keep for exactly as long as the plan allows. The default, and the only one most projects need. */
  | { readonly kind: "inherit" }
  /** Keep for `days`, or the plan's allowance, whichever is shorter. */
  | { readonly kind: "days"; readonly days: number };

export const RETENTION_INHERIT: RetentionPolicy = { kind: "inherit" };

/**
 * Whole positive days only. Zero would mean "delete on arrival", which is not a
 * retention setting, it is a broken project — and a fractional day would make
 * two purge runs disagree about the same row.
 */
export const retentionPolicy = (days: number): Result<RetentionPolicy, ProjectError> => {
  if (!Number.isInteger(days) || days < 1 || days > MAX_RETENTION_DAYS) {
    return err({ kind: "InvalidRetention", days });
  }
  return ok({ kind: "days", days });
};

/**
 * The number of days actually in force.
 *
 * `planDays` is null for a plan that keeps events indefinitely. A project may
 * still pin a shorter window under such a plan — that is the one case where the
 * project's number wins outright rather than by being smaller.
 */
export const effectiveRetentionDays = (
  policy: RetentionPolicy,
  planDays: number | null,
): number | null => {
  if (policy.kind === "inherit") return planDays;
  if (planDays === null) return policy.days;
  return Math.min(policy.days, planDays);
};

/**
 * The instant before which this project's events may be deleted.
 *
 * `null` means keep everything. Callers must read that as "delete nothing" —
 * never as "delete now", which is the direction this kind of null is usually
 * got wrong in.
 */
export const retentionCutoff = (
  policy: RetentionPolicy,
  planDays: number | null,
  now: Instant,
): Instant | null => {
  const days = effectiveRetentionDays(policy, planDays);
  return days === null ? null : Instant.minus(now, Duration.days(days));
};

export const retentionEquals = (a: RetentionPolicy, b: RetentionPolicy): boolean =>
  a.kind === "inherit" ? b.kind === "inherit" : b.kind === "days" && a.days === b.days;
