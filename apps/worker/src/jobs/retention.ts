/**
 * Retention enforcement: deleting what we said we would not keep.
 *
 * Counted has advertised retention on the pricing page since v1 and never
 * implemented it — no column, no purge job, and no worker to run one in. The
 * arithmetic is now in two domain packages and this file is what walks it.
 *
 * **Two cutoffs, and only one of them is here.** The store's own retention is
 * global: litics deletes any segment older than `retention` in the analytics
 * config, whichever project it belongs to, and `jobs/maintenance.ts` checks
 * that number against the *longest* retention any plan grants. What is left
 * over is the gap: a free-plan project keeps 180 days while the store keeps
 * 760, so its segments outlive its plan's promise and have to be deleted per
 * project, before an instant. That is this file, through `EventRetention`.
 *
 * **`null` means keep, never delete now.** Both `retentionCutoff` functions
 * return `null` for a plan or policy with no limit, and that is the direction
 * this kind of null is usually got wrong in. A project with no cutoff produces
 * no purge request at all — there is no code path here that can turn "keep
 * indefinitely" into a `DELETE`.
 *
 * **The entitlement decides, not the plan column.** A `past_due` workspace
 * keeps its paid retention while the card is chased; a `canceled` one drops to
 * free. Reading `plan` alone would delete a paying customer's data the day
 * their card expired — the same conflation that let v1 meter a past-due
 * customer as free while giving them unlimited projects.
 */

import { retentionCutoff as projectCutoff } from "@counted/projects-domain";
import { Entitlement, retentionCutoff as planCutoff } from "@counted/tenancy-domain";
import { isErr, unbrand, type Instant, type ProjectId } from "@counted/kernel";

import { describeError } from "../logging";
import type { EventRetention, Logger, PurgeRequest, RetentionTarget, RetentionTargets } from "../ports";

export type RetentionSweepDeps = {
  readonly targets: RetentionTargets;
  /**
   * `null` when no implementation is wired. The sweep then reports itself
   * unavailable rather than scanning happily and deleting nothing, which is
   * what an unenforced retention policy looks like from the outside.
   */
  readonly retention: EventRetention | null;
  readonly logger: Logger;
  readonly pageSize: number;
  /** Ceiling on projects touched per tick, so one sweep cannot run for an hour. */
  readonly maxProjects: number;
};

export type RetentionSweepReport =
  | { readonly kind: "unavailable"; readonly missing: string }
  | {
      readonly kind: "swept";
      readonly scanned: number;
      /** Rows the store returned that this version could not decode. Skipped, never defaulted. */
      readonly unreadable: number;
      /** Projects with a cutoff — the rest keep everything. */
      readonly due: number;
      readonly purged: number;
      readonly rowsDeleted: number;
      readonly failures: number;
    };

/**
 * The instant before which this project's events may be deleted, or `null`.
 *
 * Two clamps compose here and the order does not matter, which is worth
 * knowing: the plan sets a ceiling and the project may pin something shorter,
 * so `effectiveRetentionDays` takes the smaller. The one asymmetric case is a
 * plan with no limit, where a project's own pin wins outright — that is the
 * only way a `null` plan allowance produces a cutoff at all.
 */
export const purgeFor = (target: RetentionTarget, now: Instant): PurgeRequest | null => {
  const entitlement = Entitlement.resolve(target.plan, target.payment);

  // Asked for its own sake: a plan-level `null` and a project-level `null` are
  // the same instruction, and `projectCutoff` already composes them. This call
  // exists so that a change to the plan catalogue that introduces an unlimited
  // plan is visible here rather than only inside the projects package.
  const planLimit = planCutoff(entitlement, now);
  if (planLimit === null && target.policy.kind === "inherit") return null;

  const before = projectCutoff(target.policy, entitlement.limits.retentionDays, now);
  return before === null ? null : { project: target.project, before };
};

export const enforceRetention = async (
  deps: RetentionSweepDeps,
  now: Instant,
): Promise<RetentionSweepReport> => {
  const retention = deps.retention;
  if (retention === null) {
    return {
      kind: "unavailable",
      missing:
        "EventRetention — deleting a project's rows out of the analytics store is " +
        "@counted/analytics-adapter-litics' to implement",
    };
  }

  let scanned = 0;
  let unreadable = 0;
  let due = 0;
  let purged = 0;
  let rowsDeleted = 0;
  let failures = 0;
  let after: ProjectId | null = null;

  while (scanned + unreadable < deps.maxProjects) {
    const page = await deps.targets.page(
      after,
      Math.min(deps.pageSize, deps.maxProjects - scanned - unreadable),
    );
    unreadable += page.examined - page.targets.length;

    for (const target of page.targets) {
      scanned += 1;

      const request = purgeFor(target, now);
      if (request === null) continue;
      due += 1;

      try {
        const outcome = await retention.purge(request);
        if (isErr(outcome)) {
          failures += 1;
          deps.logger.warn("retention.purge-refused", {
            project: unbrand(target.project),
            reason: outcome.error.kind,
          });
          continue;
        }
        purged += 1;
        rowsDeleted += outcome.value;
      } catch (cause) {
        failures += 1;
        deps.logger.error("retention.purge-failed", {
          project: unbrand(target.project),
          detail: describeError(cause),
        });
      }
    }

    if (page.cursor === null) break;
    after = page.cursor;
  }

  if (unreadable > 0) {
    deps.logger.warn("retention.unreadable-rows", { count: unreadable });
  }

  return { kind: "swept", scanned, unreadable, due, purged, rowsDeleted, failures };
};
