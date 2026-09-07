/**
 * Reconciliation for the two-store project problem.
 *
 * Creating a project is two writes into two stores. The project row is ours;
 * the ingest key is better-auth's, on another connection, and there is no
 * transaction across the pair — so `provisionProject` is a saga that
 * compensates on failure and *cannot* compensate on a crash. What survives a
 * crash between the two is a project that can never receive an event: it is in
 * the customer's console, it holds a slot against their plan's cap, and
 * nothing in the product ever errors about it. The only symptom is an empty
 * credential list on a page nobody visits twice.
 *
 * This job is the second half of that saga, run on a schedule. The repair is
 * `repairProjectCredential` — the same use case, the same store, the same
 * derivation, the same `CredentialIssued` fact — and not a hand-written
 * insert, because a repair written a second way is a second implementation of
 * issuance and the two would drift.
 *
 * **The repair issues; it never deletes.** Deleting the orphan and freeing its
 * slot is the tidier-looking option and it cannot be made safe: the same crash
 * can happen *after* the key exists and before the fact is enqueued, and a
 * repair acting on that evidence would destroy a project whose key the
 * customer is already using. Issuing is idempotent in effect — a project that
 * turns out to have a usable key is left alone — and deleting is not.
 *
 * **The key is attributed to a real account**: the workspace's owner, read
 * from the membership directory. There is no synthetic issuer, because a key
 * nobody issued is a key no audit can explain — v1 wrote `userId: ""` into
 * `created_by` for a year. A workspace whose owner has left is reported and
 * not repaired, for the same reason the workspace reconciler refuses an
 * ownerless organization: inventing an issuer is worse than leaving a visible
 * gap.
 *
 * Like every other job here, it says when it cannot see. Without a credential
 * store wired it reports `unavailable` with the name of what is missing rather
 * than scanning nothing and declaring everything healthy.
 */

import { permissionsForRole } from "@counted/authorization";
import { repairProjectCredential, type ProjectDependencies } from "@counted/projects-app";
import { Instant, isErr, unbrand, type AccountId, type Duration, type Permission } from "@counted/kernel";
import type { CredentialStore, MembershipDirectory } from "@counted/identity-ports";
import { Role, type WorkspaceId } from "@counted/kernel";

import { describeError } from "../logging";
import type { Logger, RecentProjects } from "../ports";

export type ProvisioningDeps = {
  readonly projects: RecentProjects;
  /**
   * `null` when identity is not wired. Reporting that is the point: reading
   * better-auth's `apikey` table is `@counted/identity-adapter-better-auth`'s
   * to do, and a reconciler that cannot see credentials cannot tell a healthy
   * project from a broken one.
   */
  readonly credentials: CredentialStore | null;
  readonly memberships: MembershipDirectory | null;
  /** Built from the same store; only used when both of the above are present. */
  readonly projectDeps: ProjectDependencies | null;
  readonly logger: Logger;
  /** How far back to look. A crash is recent by definition. */
  readonly lookback: Duration;
  readonly batch: number;
  /**
   * `false` finds and reports without issuing. The honest default: a key
   * issued by mistake is a live credential nobody asked for, and the finding
   * alone is enough for somebody to look.
   */
  readonly repair: boolean;
};

export type ProvisioningReport =
  | { readonly kind: "unavailable"; readonly missing: string }
  | {
      readonly kind: "checked";
      readonly scanned: number;
      /** Projects found with no usable ingest key. */
      readonly unprovisioned: number;
      readonly repaired: number;
      /** Found, and not repairable — no owner, or the domain refused. */
      readonly unrepairable: number;
      readonly failures: number;
    };

/**
 * The most senior member of a workspace, and what that role holds.
 *
 * An owner if there is one, otherwise the highest role present. A key may
 * never carry more than its issuer, so issuing on behalf of the most senior
 * member is the only choice that can produce a working ingest key at all —
 * `events:write` is admin-and-up.
 */
const issuerFor = async (
  memberships: MembershipDirectory,
  workspace: WorkspaceId,
): Promise<{ account: AccountId; held: readonly Permission[] } | null> => {
  const members = await memberships.membersOf(workspace);
  let best: { account: AccountId; role: Role } | null = null;
  for (const member of members) {
    if (best === null || Role.rank(member.role) > Role.rank(best.role)) {
      best = { account: member.account, role: member.role };
    }
  }
  return best === null ? null : { account: best.account, held: permissionsForRole(best.role) };
};

export const reconcileProvisioning = async (
  deps: ProvisioningDeps,
  now: Instant,
): Promise<ProvisioningReport> => {
  const { credentials, memberships, projectDeps } = deps;
  if (credentials === null || memberships === null || projectDeps === null) {
    return {
      kind: "unavailable",
      missing:
        "CredentialStore and MembershipDirectory — reading better-auth's apikey " +
        "and member tables is @counted/identity-adapter-better-auth's to implement, " +
        "and this process has not been given the identity configuration it needs",
    };
  }

  const records = await deps.projects.createdSince(Instant.minus(now, deps.lookback), deps.batch);

  let unprovisioned = 0;
  let repaired = 0;
  let unrepairable = 0;
  let failures = 0;

  for (const record of records) {
    const fields = {
      project: unbrand(record.project),
      workspace: unbrand(record.workspace),
      name: record.name,
    };

    try {
      // The cheap read first: most projects in the window are healthy, and
      // this is the one call that says so without writing anything.
      const existing = await credentials.list({ level: "project", project: record.project });
      if (existing.length > 0) continue;

      unprovisioned += 1;

      if (!deps.repair) {
        deps.logger.warn("provisioning.unprovisioned", { ...fields, repaired: false });
        continue;
      }

      const issuer = await issuerFor(memberships, record.workspace);
      if (issuer === null) {
        unrepairable += 1;
        deps.logger.warn("provisioning.unrepairable", {
          ...fields,
          why: "the workspace has no members, so there is no account to attribute a key to",
        });
        continue;
      }

      const result = await repairProjectCredential(projectDeps, {
        project: record.project,
        issuedBy: issuer.account,
        held: issuer.held,
      });

      if (isErr(result)) {
        unrepairable += 1;
        deps.logger.warn("provisioning.unrepairable", { ...fields, why: result.error.kind });
        continue;
      }
      if (result.value.kind !== "repaired") {
        // It had a usable key after all, or it stopped needing one between the
        // listing and the repair. Not a failure and not a repair.
        continue;
      }

      repaired += 1;
      deps.logger.info("provisioning.repaired", {
        ...fields,
        credential: unbrand(result.value.credential.credential.id),
        issuedBy: unbrand(issuer.account),
      });
    } catch (error) {
      failures += 1;
      deps.logger.error("provisioning.failed", { ...fields, detail: describeError(error) });
    }
  }

  return {
    kind: "checked",
    scanned: records.length,
    unprovisioned,
    repaired,
    unrepairable,
    failures,
  };
};
