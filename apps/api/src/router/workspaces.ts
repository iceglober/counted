/**
 * Workspaces: the billing and membership boundary.
 *
 * **`changeRole` and `removeMember` write through `MembershipWriter`**, the
 * one write port `@counted/identity-*` exposes over better-auth's `member`
 * table (`apps/api` may not import better-auth — `.dependency-cruiser.cjs`,
 * rule 3 — so the port is the only way there). The rules — the last owner
 * stays, a change must change something, a non-member cannot be re-roled —
 * are enforced behind that port, inside its transaction, and proven by its
 * contract suite. What this file does is read the account first, so a stale
 * id in a console form is refused before anything is written (`NotAMember`,
 * which is what a person who does not exist is), and map the port's refusals
 * through the same table every other tenancy error uses. Authorization is
 * the middleware's: `workspace:admin` is held by owners alone, so an admin is
 * refused before either handler runs.
 *
 * `create` is two writes in one transaction and the transaction is
 * better-auth's, because the organization row and the workspace row must share
 * an id and neither is useful alone. The mirror below writes on the pool rather
 * than on identity's connection, which is the degradation
 * `provisioning.ts` documents: a commit that fails after the mirror has
 * committed leaves a workspace nobody belongs to — visible in billing, fixable
 * by hand — and never an organization no plan applies to.
 */

import { AccountId, Instant, isErr, unbrand } from "@counted/kernel";
import type { WorkspaceId } from "@counted/kernel";
import { provisionWorkspace, readWorkspaceUsage } from "@counted/tenancy-app";
import type { WorkspaceMirror } from "@counted/identity-adapter-better-auth";
import { fromEngineFailure, fromWorkspaceError, raise } from "../faults";
import * as serialize from "../serialize";
import { entitlementDeps } from "../wiring";
import { eventsThisPeriod, monthToDate } from "../usage";
import type { HandlerDeps } from "./deps";
import { actingAccount, locatedWorkspace, orWorkspaceFault, slugify } from "./support";

export const workspaceRoutes = ({ deps, guarded }: HandlerDeps) => ({
  list: guarded.workspaces.list.handler(async ({ context }) => ({
    items: context.authority.reach.map(serialize.workspaceSummary),
  })),

  create: guarded.workspaces.create.handler(async ({ input, context }) => {
    const founder = actingAccount(context.authority.principal);
    const at = context.at;

    let provisioned: Awaited<ReturnType<typeof provisionWorkspace>> | null = null;

    /**
     * The domain's half, run inside identity's transaction.
     *
     * A throw here rolls the organization and its owner membership back, which
     * is why `WorkspaceMirror.place` has no `Result` — a refusal returned as a
     * value would have to be turned into a throw anyway to reach the rollback.
     */
    const mirror: WorkspaceMirror = {
      place: async (workspace: WorkspaceId, owner: AccountId, placedAt: Instant) => {
        provisioned = await provisionWorkspace(
          { workspaces: deps.reads.workspaces, subscriptions: deps.reads.subscriptions },
          { workspace, name: input.name, founder: owner },
          placedAt,
        );
        if (isErr(provisioned)) {
          throw new Error(`workspace refused: ${provisioned.error.kind}`);
        }
      },
    };

    const outcome = await deps.identity.workspaces.provision(
      { name: input.name, slug: slugify(input.name, deps.ids.next()), owner: founder },
      mirror,
      at,
    );

    if (!outcome.ok) {
      switch (outcome.error.kind) {
        case "NoSuchAccount":
          raise({
            code: "NOT_FOUND",
            message: "No such account.",
            data: { reason: "NoSuchAccount", account: String(outcome.error.account) },
          });
          break;
        case "SlugTaken":
          // The slug carries eight characters of a UUIDv7, so a collision is a
          // clash between two workspaces created in the same millisecond with
          // the same name. Retrying is the caller's cheapest fix and a 409 says
          // so; picking a new slug here would hide a broken id generator.
          raise({
            code: "CONFLICT",
            message: "That workspace name is momentarily taken. Try again.",
            data: { reason: "SlugTaken", slug: outcome.error.slug },
          });
          break;
        case "NotProvisioned":
          raise({
            code: "INTERNAL_SERVER_ERROR",
            message: "The workspace was not created.",
            data: { reason: "NotProvisioned", detail: outcome.error.detail },
          });
          break;
      }
    }

    const created = provisioned as Awaited<ReturnType<typeof provisionWorkspace>> | null;
    if (created === null || isErr(created)) {
      // Unreachable: `provision` returning `ok` means the mirror ran and did
      // not throw. Stated rather than asserted, because a silent `!` here would
      // be the one place a missing workspace became a TypeError in a response.
      raise({
        code: "INTERNAL_SERVER_ERROR",
        message: "The workspace was created but could not be read back.",
        data: { reason: "NotProvisioned", detail: "the mirror produced no workspace" },
      });
    }

    return { workspace: serialize.workspace(created.value.workspace) };
  }),

  get: guarded.workspaces.get.handler(async ({ context }) => {
    const id = locatedWorkspace(context.authority.located);
    const found = await deps.reads.workspaces.find(id);
    if (found === null) {
      orWorkspaceFault({ ok: false, error: { kind: "NoSuchWorkspace", workspace: id } });
    }
    return { workspace: serialize.workspace(found as NonNullable<typeof found>) };
  }),

  rename: guarded.workspaces.rename.handler(async ({ input, context }) => {
    const id = locatedWorkspace(context.authority.located);
    const renamed = await deps.uow.transact(async ({ workspaces }) => {
      const found = await workspaces.find(id);
      if (found === null) {
        return { ok: false as const, error: { kind: "NoSuchWorkspace" as const, workspace: id } };
      }
      const applied = found.rename(input.name, context.at);
      if (isErr(applied)) return applied;
      await workspaces.save(applied.value.workspace, applied.value.events);
      return { ok: true as const, value: applied.value.workspace };
    });
    return { workspace: serialize.workspace(orWorkspaceFault(renamed)) };
  }),

  members: guarded.workspaces.members.handler(async ({ context }) => {
    const id = locatedWorkspace(context.authority.located);
    const memberships = await deps.identity.memberships.membersOf(id);
    const people = await deps.identity.accounts.findMany(memberships.map((m) => m.account));
    // A membership whose account row is gone is dropped rather than rendered
    // with a placeholder name. A row that says "Unknown" in a member list is
    // indistinguishable from a real person nobody has named.
    return {
      items: memberships.flatMap((membership) => {
        const person = people.get(membership.account);
        return person === undefined ? [] : [serialize.member(membership, person)];
      }),
    };
  }),

  usage: guarded.workspaces.usage.handler(async ({ context }) => {
    const id = locatedWorkspace(context.authority.located);
    const reading = await eventsThisPeriod(deps.engine, id, context.at, {
      deadline: deps.config.queryDeadline,
      traceId: context.traceId,
    });
    if (!reading.ok) {
      // The event count is the readout's whole point, so a failed read is a
      // failed request. Reporting zero would tell a customer near their cap
      // that they had used nothing.
      raise(fromEngineFailure(reading.failure));
    }
    const usage = orWorkspaceFault(
      await readWorkspaceUsage(entitlementDeps(deps, deps.reads), {
        workspace: id,
        eventsUsed: reading.events,
      }),
    );
    const bounds = monthToDate(context.at);
    const from = new Date(Instant.toEpochMillis(bounds.from));
    return { usage: { ...serialize.usage(usage), period: {
      from: Instant.toISO(bounds.from), measuredAt: Instant.toISO(context.at),
      resetsAt: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)).toISOString(),
    } } };
  }),

  changeRole: guarded.workspaces.changeRole.handler(async ({ input, context }) => {
    const id = locatedWorkspace(context.authority.located);
    const account = AccountId(input.accountId);

    // Read before the write, not after: the response needs the person, and a
    // person who does not exist is not a member — which is the contract's
    // answer, and it is given before a row is touched.
    const person = await deps.identity.accounts.find(account);
    if (person === null) raise(fromWorkspaceError({ kind: "NotAMember", account }));

    const changed = orWorkspaceFault(
      await deps.identity.memberships.changeRole(id, account, input.role),
    );
    return { member: serialize.member(changed, person) };
  }),

  removeMember: guarded.workspaces.removeMember.handler(async ({ input, context }) => {
    const id = locatedWorkspace(context.authority.located);
    const account = AccountId(input.accountId);
    orWorkspaceFault(await deps.identity.memberships.remove(id, account));
    return { removed: true as const, account: unbrand(account) };
  }),
  leave: guarded.workspaces.leave.handler(async ({ context }) => {
    const id = locatedWorkspace(context.authority.located);
    const account = actingAccount(context.authority.principal);
    orWorkspaceFault(await deps.identity.memberships.remove(id, account));
    return { left: true as const };
  }),
});
