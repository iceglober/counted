/**
 * The workspace every unclaimed project is born into, created by the
 * installation rather than by an operator.
 *
 * `POST /v1/projects/provision` mints an ingest key for a project that belongs
 * to nobody. `IssueRequest.workspace` is not nullable and must not become so:
 * a key's permission set is derived from the issuing account's role, a role
 * only exists inside a workspace, and a workspace-less key would need a second
 * derivation rule beside the `CredentialGrants` that `credential-kind.ts`
 * exists to keep singular. So the key is issued against a holding workspace,
 * and this is what makes that workspace exist.
 *
 * It has to exist *here* rather than in a runbook. Before this, the two ids
 * were required environment variables naming rows nothing ever created —
 * DEVELOPING.md called it "a real rough edge: the variables are required at
 * boot for a value that cannot exist at first boot" — so on every database
 * that had not been hand-seeded, provisioning failed 100% of the time and
 * answered `NoSuchProject` while doing it.
 *
 * Three rows, and every one of them is created only if missing:
 *
 *   `user`          the account credentials issued here are attributed to.
 *                   Not a synthetic id and not an empty string (v1 wrote
 *                   `userId: ""` into `created_by` for exactly this case): a
 *                   named account with an unroutable address, which an audit
 *                   line can read as "the installation issued this".
 *   `organization`  the holding workspace itself.
 *   `member`        the account's owner standing in it, which is what makes
 *                   `CredentialGrants("ingest", role)` non-empty. Without it
 *                   issuance fails with `NothingGrantable`.
 *
 * **An existing row is never modified.** Point the two variables at a real
 * workspace and a real account and this writes nothing at all; it will not
 * promote a member to owner behind the operator's back. When the standing it
 * finds cannot grant an ingest key it says so and lets the caller decide,
 * because refusing to boot over the no-signup path would take the other
 * forty-one routes down with it.
 *
 * There is deliberately **no domain `workspaces` row**. The holding workspace
 * owns nothing, bills nobody and has no plan: an unclaimed project's ownership
 * stays `unclaimed` in the domain, and its events are metered against the
 * unclaimed allowance rather than a plan (`apps/api/src/ingest/quota.ts`).
 * Creating a workspace row would make it a tenant, and the reconciler would
 * then be right to think a customer exists.
 */

import { Instant, unbrand, type AccountId, type WorkspaceId } from "@counted/kernel";
import type { IdentityAuth } from "./auth";
import type { HoldingWorkspaceInput, IdentityConfig } from "./config";
import { MEMBER_MODEL, ORGANIZATION_MODEL, USER_MODEL } from "./placement";
import { roleFrom, roleTo } from "./role";
import { dateOf, type MemberRow, type OrganizationRow, type UserRow } from "./rows";

export type HoldingWorkspace = {
  readonly workspace: WorkspaceId;
  readonly owner: AccountId;
  /** Which of the three rows this call had to write. Empty on a warm database. */
  readonly created: readonly ("account" | "workspace" | "membership")[];
  /**
   * Null when the standing grants an ingest key. Otherwise the reason it does
   * not — a member-role holding account, say — so a boot log can say why
   * provisioning will refuse instead of leaving a 500 to explain it.
   */
  readonly problem: string | null;
};

const DEFAULTS = {
  name: "Unclaimed projects",
  slug: "counted-unclaimed-holding",
  email: "unclaimed@counted.invalid",
} as const;

/**
 * Create whatever is missing, change nothing that is not.
 *
 * Runs under the same advisory lock as the schema steps in `apps/api`, so two
 * replicas booting onto a cold database queue rather than racing each other to
 * insert the same primary key.
 */
export const ensureHoldingWorkspace = async (
  identity: IdentityAuth,
  input: HoldingWorkspaceInput,
  grants: IdentityConfig["grants"],
  at: Instant,
): Promise<HoldingWorkspace> => {
  const adapter = (await identity.auth.$context).adapter;
  const created: ("account" | "workspace" | "membership")[] = [];

  const accountId = unbrand(input.owner);
  const workspaceId = unbrand(input.workspace);

  const account = await adapter.findOne<UserRow>({
    model: USER_MODEL,
    where: [{ field: "id", value: accountId }],
  });
  if (account === null) {
    await adapter.create<Record<string, unknown>, UserRow>({
      model: USER_MODEL,
      data: {
        id: accountId,
        name: input.name ?? DEFAULTS.name,
        email: input.email ?? DEFAULTS.email,
        // Never verified, and there is no `account` row behind it, so there is
        // no password and no social identity to sign in with.
        emailVerified: false,
        createdAt: dateOf(at),
        updatedAt: dateOf(at),
      },
      // The id is the operator's to choose — it is the one they put in the
      // environment and the one every issued key will record. better-auth
      // would otherwise mint its own and the configuration would name a row
      // that does not exist, which is the failure this function removes.
      forceAllowId: true,
    });
    created.push("account");
  }

  const organization = await adapter.findOne<OrganizationRow>({
    model: ORGANIZATION_MODEL,
    where: [{ field: "id", value: workspaceId }],
  });
  if (organization === null) {
    await adapter.create<Record<string, unknown>, OrganizationRow>({
      model: ORGANIZATION_MODEL,
      data: {
        id: workspaceId,
        name: input.name ?? DEFAULTS.name,
        slug: input.slug ?? DEFAULTS.slug,
        createdAt: dateOf(at),
      },
      forceAllowId: true,
    });
    created.push("workspace");
  }

  const membership = await adapter.findOne<MemberRow>({
    model: MEMBER_MODEL,
    where: [
      { field: "organizationId", value: workspaceId },
      { field: "userId", value: accountId },
    ],
  });
  const role = membership === null ? null : roleFrom(membership.role);
  if (membership === null) {
    await adapter.create<Record<string, unknown>, MemberRow>({
      model: MEMBER_MODEL,
      data: {
        organizationId: workspaceId,
        userId: accountId,
        // Owner, because `CredentialGrants("ingest", role)` is empty below
        // that: `events:write` is an admin-and-up permission on purpose.
        role: roleTo("owner"),
        createdAt: dateOf(at),
      },
    });
    created.push("membership");
  }

  const standing = role ?? "owner";
  const grantable = grants("ingest", standing);

  return {
    workspace: input.workspace,
    owner: input.owner,
    created,
    problem:
      grantable.length > 0
        ? null
        : `the holding account's standing in the holding workspace is "${standing}", ` +
          "which grants no ingest permission — anonymous provisioning will refuse " +
          "with NothingGrantable until it is an admin or an owner",
  };
};
