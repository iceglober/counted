/**
 * Reconciliation for the two-write workspace problem.
 *
 * A workspace is two rows that mean different things: better-auth's
 * `organization` answers "who belongs here, with what role", and the domain's
 * `workspaces` row answers "what plan, what limits, what is owed". They share
 * an id, and both have to exist for either to be useful.
 * `betterAuthWorkspaceProvisioner` writes them inside one transaction, ordered
 * so that the surviving failure is the recoverable one — but "one transaction"
 * is a property of a code path, and this job is the check that the property
 * held. An organization with no workspace is people signing in and belonging to
 * something no plan applies to, no limit constrains, and no invoice covers. It
 * is invisible to billing, and nothing in the product ever errors.
 *
 * Repair is `provisionWorkspace`, the same use case the create path runs, in
 * the same transaction shape. Not a hand-written `INSERT`: the missing half is
 * a workspace **and** its free-plan subscription row, and writing only the
 * first reproduces the v1 failure where the first Stripe webhook had nothing to
 * update, matched no rows, reported success, and the customer paid for nothing.
 *
 * An orphan with no owner is reported and never repaired. `Workspace.open`
 * needs a founder and there is nobody to be one; inventing a founder would
 * hand somebody a workspace they did not create, and choosing an arbitrary
 * member is not available either — the member row is exactly what is missing.
 *
 * There is no race to defend against. Provisioning commits both rows together,
 * so an organization this job can see has either committed with its workspace
 * or is genuinely orphaned; an in-flight transaction is invisible to both
 * halves of the check.
 */

import { provisionWorkspace, type ProvisionWorkspaceDeps, type WorkspaceRepository } from "@counted/tenancy-app";
import { err, Instant, isErr, ok, unbrand, type Duration, type Result } from "@counted/kernel";
import type { UnitOfWork } from "@counted/persistence-ports";

import { describeError } from "../logging";
import type { Logger, OrganizationDirectory, OrganizationRecord } from "../ports";
import type { OrganizationCursor } from "@counted/identity-ports";

export type ReconcileDeps = {
  /**
   * `null` when no implementation is wired. Reporting that is the point: a
   * reconciler that scans an empty list and declares everything consistent is
   * strictly worse than one that says it cannot see.
   */
  readonly organizations: OrganizationDirectory | null;
  /** Reads, on the pool. The repair's read happens again inside the transaction. */
  readonly workspaces: WorkspaceRepository;
  readonly uow: UnitOfWork<ProvisionWorkspaceDeps>;
  readonly logger: Logger;
  /** How far back to look. Orphans are rare and old ones stay orphaned, so this is generous. */
  readonly lookback: Duration;
  readonly batch: number;
  /**
   * `false` finds and reports without writing. The honest default for a first
   * deployment: a repair that turns out to be wrong has created a billable
   * workspace nobody asked for.
   */
  readonly repair: boolean;
};

export type ReconcileReport =
  | { readonly kind: "unavailable"; readonly missing: string }
  | {
      readonly kind: "checked";
      readonly scanned: number;
      readonly orphans: number;
      readonly repaired: number;
      /** Orphaned and not repairable — no owner, or the domain refused. */
      readonly unrepairable: number;
      readonly failures: number;
    };

/**
 * Repair one orphan, or say why not.
 *
 * The `find` inside the transaction is not a duplicate of the one outside it.
 * The outer read decides whether to bother; this one runs under the row lock
 * the transactional workspace repository takes, so two workers reconciling at
 * once cannot both decide the workspace is missing and both create it.
 */
const repairOne = async (
  deps: ReconcileDeps,
  record: OrganizationRecord,
  at: Instant,
): Promise<Result<"repaired" | "already-present", string>> => {
  const owner = record.owner;
  if (owner === null) {
    return err(
      "the organization has no owner member, so there is no founder to open a workspace for",
    );
  }

  return await deps.uow.transact(async (repositories) => {
    const existing = await repositories.workspaces.find(record.workspace);
    if (existing !== null) return ok<"repaired" | "already-present">("already-present");

    const provisioned = await provisionWorkspace(
      repositories,
      { workspace: record.workspace, name: record.name, founder: owner },
      at,
    );
    // A refused rule is a successful transaction reporting a refusal — it
    // commits, and there is nothing to roll back because nothing was written.
    if (isErr(provisioned)) {
      return err(`the domain refused: ${provisioned.error.kind}`);
    }
    return ok<"repaired" | "already-present">("repaired");
  });
};

export const reconcileWorkspaces = async (
  deps: ReconcileDeps,
  now: Instant,
): Promise<ReconcileReport> => {
  const directory = deps.organizations;
  if (directory === null) {
    return {
      kind: "unavailable",
      missing: "OrganizationDirectory — configure the identity adapter to enable workspace reconciliation",
    };
  }

  let cursor: OrganizationCursor | null = null;
  let scanned = 0;
  let orphans = 0;
  let repaired = 0;
  let unrepairable = 0;
  let failures = 0;

  do {
    const page = await directory.page({ since: Instant.minus(now, deps.lookback), limit: deps.batch, cursor });
    scanned += page.items.length;
    cursor = page.cursor;
    for (const record of page.items) {
      try {
        if ((await deps.workspaces.find(record.workspace)) !== null) continue;
        orphans += 1;

        const fields = {
          workspace: unbrand(record.workspace),
          name: record.name,
          owner: record.owner === null ? null : unbrand(record.owner),
          createdAt: Instant.toISO(record.createdAt),
        };

        if (!deps.repair) {
          unrepairable += 1;
          deps.logger.warn("reconcile.orphan", { ...fields, repair: false });
          continue;
        }

        const outcome = await repairOne(deps, record, now);
        if (isErr(outcome)) {
          unrepairable += 1;
          deps.logger.error("reconcile.unrepairable", { ...fields, detail: outcome.error });
          continue;
        }
        if (outcome.value === "repaired") {
          repaired += 1;
          deps.logger.info("reconcile.repaired", fields);
        } else {
          // Another worker got there first between the two reads. Not an orphan
          // after all, and not a failure.
          orphans -= 1;
        }
      } catch (cause) {
        failures += 1;
        deps.logger.error("reconcile.failed", {
          workspace: unbrand(record.workspace),
          detail: describeError(cause),
        });
      }
    }
  } while (cursor !== null);

  return { kind: "checked", scanned, orphans, repaired, unrepairable, failures };
};
