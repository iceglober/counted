/**
 * Creating a workspace, which is two writes into one database.
 *
 * better-auth's organization answers "who belongs here, with what role". The
 * domain's workspace answers "what plan, what limits, what is owed". They
 * share an id and mean different things, and both have to exist for either to
 * be useful. An organization with no workspace is the bad half: people can
 * sign in and belong to something that no plan applies to, no limit constrains
 * and no invoice covers. It is invisible to billing and uncharged.
 *
 * So the two writes run inside one transaction, and the order is chosen so
 * that the surviving failure is the recoverable one:
 *
 *   1. the `organization` row      — inside the transaction
 *   2. the owner's `member` row    — inside the transaction
 *   3. the domain's workspace row  — inside the transaction, via the mirror
 *   4. commit
 *
 * If the mirror throws, steps 1 and 2 roll back and nothing happened. If the
 * commit itself fails after a mirror that writes on its own connection has
 * already committed, what survives is a workspace nobody belongs to — visible
 * in billing, joinable by nobody, and fixable by hand. Never the reverse.
 *
 * **The mirror must write on the connection identity is holding** for that
 * guarantee to be a guarantee rather than an ordering preference. That is why
 * `IdentityDatabase` takes a `pg.Pool` rather than a connection string: the
 * composition root is stating that better-auth and `@counted/adapter-postgres`
 * are the same database, which is the precondition this whole file rests on.
 *
 * ### Why the organization row is written here rather than through
 * `auth.api.createOrganization`
 *
 * That endpoint's own two writes are not in a transaction, and its adapter
 * resolves through an AsyncLocalStorage this package cannot reach —
 * `runWithTransaction` lives in `@better-auth/core`, which better-auth does not
 * re-export. Calling it from inside `adapter.transaction` would therefore write
 * the organization *outside* the transaction and produce exactly the orphan
 * this file exists to prevent. What the endpoint does beyond the two inserts is
 * a slug-uniqueness check and its own hooks; the check is reproduced below,
 * and the hooks are ours to not have.
 */

import {
  AccountId,
  Instant,
  WorkspaceId,
  err,
  ok,
  unbrand,
  type Result,
} from "@counted/kernel";
import type { IdentityAuth } from "./auth";
import { MEMBER_MODEL, ORGANIZATION_MODEL, USER_MODEL } from "./placement";
import { roleTo } from "./role";
import { dateOf, type MemberRow, type OrganizationRow, type UserRow } from "./rows";

export type NewWorkspace = {
  readonly name: string;
  /** URL-safe, unique across the installation. */
  readonly slug: string;
  readonly owner: AccountId;
};

/**
 * The domain's half of workspace creation.
 *
 * Supplied by the composition root, called inside identity's transaction, and
 * given the id better-auth just minted — because the workspace and the
 * organization must share it, and better-auth is the one that mints ids
 * (the domain is Conformist to identity and never mints
 * its own account or workspace ids).
 *
 * **Throwing is how the mirror refuses.** A thrown error rolls the
 * organization back; a returned value commits it. There is no `Result` here
 * for that reason — a refusal that came back as a value would have to be
 * turned into a throw anyway to reach the rollback, and two ways to say no is
 * one too many.
 */
export interface WorkspaceMirror {
  place(workspace: WorkspaceId, owner: AccountId, at: Instant): Promise<void>;
}

export type ProvisionFailure =
  | { readonly kind: "SlugTaken"; readonly slug: string }
  | { readonly kind: "NoSuchAccount"; readonly account: AccountId }
  /** The mirror refused, or the transaction did not commit. Nothing was written. */
  | { readonly kind: "NotProvisioned"; readonly detail: string };

export type ProvisionedWorkspace = {
  readonly workspace: WorkspaceId;
  readonly owner: AccountId;
  readonly createdAt: Instant;
};

export const betterAuthWorkspaceProvisioner = (identity: IdentityAuth) => ({
  /**
   * Create the organization, its owner membership and the domain's workspace,
   * or create none of them.
   */
  async provision(
    input: NewWorkspace,
    mirror: WorkspaceMirror,
    at: Instant,
  ): Promise<Result<ProvisionedWorkspace, ProvisionFailure>> {
    const context = await identity.auth.$context;
    const adapter = context.adapter;

    // Checked before the transaction opens as well as inside it. Outside so
    // the common refusal costs no transaction; inside because between the two
    // checks somebody else can take the slug.
    const owner = await adapter.findOne<UserRow>({
      model: USER_MODEL,
      where: [{ field: "id", value: unbrand(input.owner) }],
    });
    if (owner === null) return err({ kind: "NoSuchAccount", account: input.owner });

    try {
      return await adapter.transaction(async (trx) => {
        const taken = await trx.findOne<OrganizationRow>({
          model: ORGANIZATION_MODEL,
          where: [{ field: "slug", value: input.slug }],
        });
        if (taken !== null) {
          return err<ProvisionFailure>({ kind: "SlugTaken", slug: input.slug });
        }

        const organization = await trx.create<Record<string, unknown>, OrganizationRow>({
          model: ORGANIZATION_MODEL,
          data: { name: input.name, slug: input.slug, createdAt: dateOf(at) },
        });
        const workspace = WorkspaceId(organization.id);

        await trx.create<Record<string, unknown>, MemberRow>({
          model: MEMBER_MODEL,
          data: {
            organizationId: organization.id,
            userId: unbrand(input.owner),
            // The creator is the owner. Not configurable: "who can be billed
            // for this" needs exactly one answer at creation time.
            role: roleTo("owner"),
            createdAt: dateOf(at),
          },
        });

        // Last, and inside. A throw here rolls the two rows above back, which
        // is the whole reason the order is this way round.
        await mirror.place(workspace, input.owner, at);

        return ok<ProvisionedWorkspace>({ workspace, owner: input.owner, createdAt: at });
      });
    } catch (error) {
      // The transaction rolled back: no organization, no member, and whatever
      // the mirror did on this connection is gone with them.
      return err({
        kind: "NotProvisioned",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

export type WorkspaceProvisioner = ReturnType<typeof betterAuthWorkspaceProvisioner>;
