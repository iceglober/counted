/**
 * Creating a project, with the ingest key it is useless without.
 *
 * The invariant "an active project always has at least one usable ingest
 * credential" was an aggregate invariant in v2, and it cannot be one any more:
 * the project row is ours and the key row is better-auth's, and there is no
 * transaction spanning both. So this use case is a small saga, and the honest
 * version of it says what survives each failure:
 *
 *   1. save the project and enqueue `ProjectCreated`
 *   2. issue the first ingest key
 *   3a. on success — enqueue `CredentialIssued`
 *   3b. on failure — delete the project and enqueue `ProjectDeleted`
 *
 * Step 3b is why `ProjectDeleted` exists. A consumer that reacted to
 * `ProjectCreated` (provisioning a litics tenant, say) needs a fact to react to
 * in order to undo it; a rollback in a transaction it never saw is not
 * something it can observe.
 *
 * The window that remains: a crash between 1 and 3 leaves a project with no
 * ingest key. It is visible — `canIngest` over its (empty) credential list is
 * false — and `repairProjectCredential` below is what closes it, run by the
 * worker's reconciler. There is no way to close it in one transaction: the
 * project row is ours and the key row is better-auth's, on another connection,
 * and the only orderings that avoid the window need a store method that places
 * a key on a project it cannot see yet — which is the placement check `issue`
 * exists to make, deleted.
 */

import {
  canIngest,
  grantableTo,
  INGEST_PERMISSIONS,
  Project,
  suggestedProjectName,
  withinGrant,
  type ClaimGrant,
  type ProjectError,
  type ProjectSnapshot,
} from "@counted/projects-domain";
import {
  err,
  ok,
  ProjectId,
  type AccountId,
  type Permission,
  type Result,
  type WorkspaceId,
} from "@counted/kernel";
import type { IssueFailure, IssuedCredential } from "@counted/identity-ports";
import { envelopes } from "./envelopes";
import type { ProjectDependencies } from "./ports";

export type ProvisionProjectCommand = {
  readonly workspace: WorkspaceId;
  /** Blank falls back to a generated two-word name — never "Untitled project". */
  readonly name: string;
  readonly issuedBy: AccountId;
  /** The issuer's expanded permission set, resolved in `apps/*` from their role. */
  readonly held: readonly Permission[];
  /** What to call the first key. Defaults to `default`. */
  readonly credentialName?: string;
  /**
   * The id to create the project under, when the caller had to know it before
   * the row existed.
   *
   * `apps/api` reserves the workspace's project slot first, and
   * `Workspace.registerProject` takes the id — so the id has to be minted
   * before this use case runs or the reservation names a project that is about
   * to get a different one. Omitted, one is minted here, which is what the
   * unclaimed-provisioning path does.
   */
  readonly id?: ProjectId;
};

export type ProvisionedProject = {
  readonly project: ProjectSnapshot;
  /** The plaintext secret is in here, and this is the only time it exists. */
  readonly credential: IssuedCredential;
};

export const provisionProject = async (
  deps: ProjectDependencies,
  command: ProvisionProjectCommand,
): Promise<Result<ProvisionedProject, ProjectError | IssueFailure>> => {
  const at = deps.clock.now();

  // Q3 before anything is written. An issuer who may not mint an ingest key
  // must not leave a project behind as a side effect of finding that out.
  const grantable = grantableTo("ingest", command.held);
  if (!grantable.ok) return grantable;

  const name = command.name.trim().length === 0 ? suggestedProjectName() : command.name;
  const id = command.id ?? ProjectId(deps.ids.next());
  const created = Project.create(id, name, command.workspace, at);
  if (!created.ok) return created;

  await deps.uow.transact(async ({ projects, outbox }) => {
    await projects.save(created.value.project, created.value.events);
    await outbox.enqueue(envelopes(created.value.events, deps.ids));
  });

  const issued = await deps.credentials.issue(
    {
      kind: "ingest",
      name: command.credentialName ?? "default",
      workspace: command.workspace,
      project: id,
      issuedBy: command.issuedBy,
      expiresIn: null,
    },
    at,
  );

  if (!issued.ok) {
    await compensate(deps, id, command.workspace);
    return issued;
  }

  const contained = withinGrant(issued.value.credential.permissions, grantable.value);
  if (!contained.ok) {
    // The key exists and carries more than its issuer holds. Kill it, then undo
    // the project — a project whose only key had to be revoked is not one the
    // caller asked for.
    await deps.credentials.revoke(issued.value.credential.id, at);
    await compensate(deps, id, command.workspace);
    return contained;
  }

  await deps.uow.transact(async ({ outbox }) => {
    await outbox.enqueue(
      envelopes(
        [
          {
            kind: "CredentialIssued",
            project: id,
            credential: issued.value.credential.id,
            credentialKind: "ingest",
            at,
          },
        ],
        deps.ids,
      ),
    );
  });

  return ok({ project: created.value.project.snapshot(), credential: issued.value });
};

const compensate = async (
  deps: ProjectDependencies,
  project: ProjectId,
  workspace: WorkspaceId,
): Promise<void> => {
  const at = deps.clock.now();
  await deps.uow.transact(async ({ projects, outbox }) => {
    await projects.delete(project);
    await outbox.enqueue(
      envelopes([{ kind: "ProjectDeleted", project, workspace, at }], deps.ids),
    );
  });
};

/**
 * Where an unclaimed project's first key is issued, and who it is attributed
 * to.
 *
 * An anonymously provisioned project belongs to nobody and its key still has
 * to carry a derived permission set — which needs a role, and a role only
 * exists inside a workspace. Making `IssueRequest.workspace` nullable would
 * therefore need a second derivation rule beside `CredentialGrants`, and would
 * change `CredentialSummary`, `VerifiedCredential` and `Binding` with it. A
 * holding workspace changes one row instead, and `ensureHoldingWorkspace` in
 * the identity adapter is what makes it exist on a database that has never
 * seen a signup.
 *
 * The key is not widened by being issued there: an ingest principal's binding
 * comes from the project's *current* workspace, not the key's recorded one, so
 * it reaches one project and keeps working after that project is claimed.
 */
export type HoldingPlacement = {
  readonly workspace: WorkspaceId;
  readonly issuedBy: AccountId;
};

export type ProvisionUnclaimedProjectCommand = {
  /** Blank falls back to a generated two-word name. */
  readonly name: string;
  /**
   * The claim grant, already minted.
   *
   * The digest and the expiry arrive as values because the domain may not
   * reach for randomness or a clock — an adapter mints the token, hashes it,
   * and hands the hash down. That is also why the plaintext token is never
   * seen here: this use case could not return it twice even if it wanted to.
   */
  readonly grant: ClaimGrant;
  readonly holding: HoldingPlacement;
  /** What to call the first key. Defaults to `default`. */
  readonly credentialName?: string;
  /** The id to create the project under. One is minted here when omitted. */
  readonly id?: ProjectId;
};

/**
 * The no-signup path: one unauthenticated call in, a working ingest key out.
 *
 * The same saga as `provisionProject` and the same compensation, with one
 * difference that matters: there is no issuer to run Q3 against. Nobody is
 * asking on their own authority, so there is no authority to exceed — what
 * bounds the key instead is the credential-kind ceiling, checked after
 * issuance. A store that handed back anything beyond `events:write` here has
 * mis-derived, and the key is revoked rather than returned.
 *
 * The window that remains is `provisionProject`'s: a crash between the project
 * row committing and the key existing leaves a project that cannot ingest.
 * `repairProjectCredential` is what closes it, and the worker runs it.
 */
export const provisionUnclaimedProject = async (
  deps: ProjectDependencies,
  command: ProvisionUnclaimedProjectCommand,
): Promise<Result<ProvisionedProject, ProjectError | IssueFailure>> => {
  const at = deps.clock.now();

  const name = command.name.trim().length === 0 ? suggestedProjectName() : command.name;
  const id = command.id ?? ProjectId(deps.ids.next());

  const created = Project.provisionUnclaimed(id, name, command.grant, at);
  if (!created.ok) return created;

  await deps.uow.transact(async ({ projects, outbox }) => {
    await projects.save(created.value.project, created.value.events);
    await outbox.enqueue(envelopes(created.value.events, deps.ids));
  });

  const issued = await deps.credentials.issue(
    {
      kind: "ingest",
      name: command.credentialName ?? "default",
      workspace: command.holding.workspace,
      project: id,
      issuedBy: command.holding.issuedBy,
      expiresIn: null,
    },
    at,
  );

  if (!issued.ok) {
    // A project with no ingest key is exactly what this path exists not to
    // hand out. Deleted rather than returned half-made — and unlike the
    // claimed path there is no workspace slot to give back, because an
    // unclaimed project holds none.
    await deleteUnclaimed(deps, id);
    return issued;
  }

  const contained = withinGrant(issued.value.credential.permissions, INGEST_PERMISSIONS);
  if (!contained.ok) {
    await deps.credentials.revoke(issued.value.credential.id, at);
    await deleteUnclaimed(deps, id);
    return contained;
  }

  await deps.uow.transact(async ({ outbox }) => {
    await outbox.enqueue(
      envelopes(
        [
          {
            kind: "CredentialIssued",
            project: id,
            credential: issued.value.credential.id,
            credentialKind: "ingest",
            at,
          },
        ],
        deps.ids,
      ),
    );
  });

  return ok({ project: created.value.project.snapshot(), credential: issued.value });
};

/**
 * Undo an unclaimed project.
 *
 * `ProjectDeleted` carries a workspace and this project has none, so the event
 * is not enqueued: a consumer that reacted to `ProjectProvisionedUnclaimed`
 * gets `ProjectDeleted` for a workspace that was never true, and a false fact
 * is worse than a missing one. Nothing downstream has provisioned anything for
 * an unclaimed project — the tenancy tree is written on claim, not on
 * provision — so there is nothing for a consumer to undo.
 */
const deleteUnclaimed = async (deps: ProjectDependencies, project: ProjectId): Promise<void> => {
  await deps.uow.transact(async ({ projects }) => {
    await projects.delete(project);
  });
};

/**
 * Give a project its missing ingest key, or say why it needs none.
 *
 * This is the repair half of the two-store problem `provisionProject`
 * describes. The project row is ours and the key row is better-auth's; there
 * is no transaction across the two, so a crash between them leaves a project
 * that can never ingest — visible as an empty credential list, and invisible
 * to everybody who is not looking at one. Nothing else in the system notices,
 * which is what makes it worth a reconciler rather than a comment.
 *
 * It is written as a use case rather than inside the worker's job because the
 * repair *is* provisioning's second half, and doing it a second way is how the
 * two drift: this issues through the same store, with the same derivation, and
 * enqueues the same `CredentialIssued` fact.
 *
 * Deliberately not a delete. The alternative repair — remove the orphan and
 * free its slot — cannot be made safe: the same crash can also happen *after*
 * the key exists and before the fact is enqueued, and a repair that deleted on
 * that evidence would destroy a project whose key the customer is already
 * using. Issuing is idempotent in effect; deleting is not.
 */
export type RepairProjectCredentialCommand = {
  readonly project: ProjectId;
  /** Attributed to a real account — usually the workspace's owner. */
  readonly issuedBy: AccountId;
  /** That account's expanded permission set, resolved by the caller. */
  readonly held: readonly Permission[];
  readonly credentialName?: string;
};

export type CredentialRepair =
  /** The project already had a usable ingest key. Nothing was written. */
  | { readonly kind: "already-provisioned" }
  /** Unclaimed and past its grant: it will never ingest again, so it needs no key. */
  | { readonly kind: "lapsed" }
  | { readonly kind: "repaired"; readonly credential: IssuedCredential };

export const repairProjectCredential = async (
  deps: ProjectDependencies,
  command: RepairProjectCredentialCommand,
): Promise<Result<CredentialRepair, ProjectError | IssueFailure>> => {
  const at = deps.clock.now();

  const project = await deps.uow.transact(({ projects }) => projects.find(command.project));
  if (project === null) return err({ kind: "NoSuchProject", project: command.project });
  // An archived project accepts no events, so it needs no key. Repairing one
  // would hand out a credential nothing can use and make the list look wrong.
  if (project.archived) return ok<CredentialRepair>({ kind: "lapsed" });
  if (!project.admitsEvents(at)) return ok<CredentialRepair>({ kind: "lapsed" });

  const existing = await deps.credentials.list({ level: "project", project: command.project });
  if (existing.some((credential) => canIngest([credential], at))) {
    return ok<CredentialRepair>({ kind: "already-provisioned" });
  }

  const grantable = grantableTo("ingest", command.held);
  if (!grantable.ok) return grantable;

  const workspace = project.workspace;
  if (workspace === null) {
    // An unclaimed project's key belongs to the holding workspace, and this
    // use case has not been told which one that is. Reported rather than
    // guessed: the grant expires, so an unrepaired unclaimed project stops
    // admitting events on its own.
    return ok<CredentialRepair>({ kind: "lapsed" });
  }

  const issued = await deps.credentials.issue(
    {
      kind: "ingest",
      name: uniqueName(existing, command.credentialName ?? "default"),
      workspace,
      project: command.project,
      issuedBy: command.issuedBy,
      expiresIn: null,
    },
    at,
  );
  if (!issued.ok) return issued;

  const contained = withinGrant(issued.value.credential.permissions, grantable.value);
  if (!contained.ok) {
    await deps.credentials.revoke(issued.value.credential.id, at);
    return contained;
  }

  await deps.uow.transact(async ({ outbox }) => {
    await outbox.enqueue(
      envelopes(
        [
          {
            kind: "CredentialIssued",
            project: command.project,
            credential: issued.value.credential.id,
            credentialKind: "ingest",
            at,
          },
        ],
        deps.ids,
      ),
    );
  });

  return ok<CredentialRepair>({ kind: "repaired", credential: issued.value });
};

/**
 * A name no revoked key already holds.
 *
 * `nameIsAvailable` counts revoked keys too, so a project whose only key was
 * revoked and then crashed mid-reissue would fail its own repair on a name
 * clash. The suffix is derived from what is there, not random, so a second
 * repair of the same project asks for the same name.
 */
const uniqueName = (
  existing: readonly { readonly name: string }[],
  preferred: string,
): string => {
  const taken = new Set(existing.map((credential) => credential.name));
  if (!taken.has(preferred)) return preferred;
  let n = 2;
  while (taken.has(`${preferred}-${n}`)) n += 1;
  return `${preferred}-${n}`;
};
