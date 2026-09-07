/**
 * Issuing, rotating, revoking and listing a project's credentials.
 *
 * The rows are better-auth's; every rule below comes from
 * `@counted/projects-domain` and is checked here, before the store is touched.
 * Two things are worth reading closely.
 *
 * **The permission set is computed twice, on purpose.** `grantableTo` is the
 * policy — one grant table, expanded once. `@better-auth/api-key` computes its
 * own set from `permissions.defaultPermissions`, because the client is not
 * allowed to name permissions at all. Those are two *representations* of one
 * decision, and `issueCredential` asserts they agree: a key that came back
 * carrying more than the issuer holds is revoked immediately and the call
 * fails. If that assertion ever fires, someone has hand-authored a permission
 * set and there are now two policies with no rule about which wins.
 *
 * **There is no shared transaction.** The credential store is better-auth's
 * tables; the project is ours. So each use case orders its writes so that the
 * surviving intermediate state is the safe one, and says which state that is.
 */

import {
  credentialStatus,
  grantableTo,
  mayRevoke,
  mayRotate,
  nameIsAvailable,
  withinGrant,
  type CredentialKind,
  type CredentialStatus,
  type ProjectError,
} from "@counted/projects-domain";
import {
  err,
  Instant,
  ok,
  type AccountId,
  type CredentialId,
  type Duration,
  type Permission,
  type ProjectId,
  type Result,
  type WorkspaceId,
} from "@counted/kernel";
import type {
  CredentialSummary,
  IssueFailure,
  IssuedCredential,
  RevocationFailure,
  RotationFailure,
} from "@counted/identity-ports";
import { envelopes } from "./envelopes";
import type { ProjectDependencies } from "./ports";
import { resolveOverlap } from "./rotation";

/** Anything a credential use case can refuse with. */
export type CredentialFailure = ProjectError | IssueFailure;

/**
 * A store failure and a domain refusal can describe the same fact — the
 * precondition passed and then lost a race with a concurrent revoke. Collapse
 * to the domain's vocabulary so a caller has one error union to handle.
 */
const asProjectError = (failure: RotationFailure | RevocationFailure): ProjectError =>
  failure.kind === "AlreadyRevoked"
    ? { kind: "CredentialRevoked", credential: failure.credential }
    : { kind: "UnknownCredential", credential: failure.credential };

/**
 * What a credential list should look like everywhere.
 *
 * The status is attached here rather than left to the caller. That is the whole
 * point of the four-state function: the v2 console re-derived a two-state
 * version from `revokedAt`, so a key mid-rotation rendered as if nothing had
 * happened. A client handed `status` has no reason to compute one.
 */
export type CredentialListing = {
  readonly credential: CredentialSummary;
  readonly status: CredentialStatus;
};

export const listCredentials = async (
  deps: ProjectDependencies,
  project: ProjectId,
): Promise<readonly CredentialListing[]> => {
  const at = deps.clock.now();
  const summaries = await deps.credentials.list({ level: "project", project });
  return summaries.map((credential) => ({ credential, status: credentialStatus(credential, at) }));
};

export type IssueCredentialCommand = {
  readonly project: ProjectId;
  readonly kind: CredentialKind;
  readonly name: string;
  readonly issuedBy: AccountId;
  /** The issuer's expanded permission set, resolved in `apps/*` from their role. */
  readonly held: readonly Permission[];
  /** Optional customer-requested subset. Ingest keys remain exactly events:write. */
  readonly requested?: readonly Permission[];
  readonly expiresIn: Duration | null;
};

export const issueCredential = async (
  deps: ProjectDependencies,
  command: IssueCredentialCommand,
): Promise<Result<IssuedCredential, CredentialFailure>> => {
  const at = deps.clock.now();

  const project = await deps.uow.transact(({ projects }) => projects.find(command.project));
  if (project === null) return err({ kind: "NoSuchProject", project: command.project });
  if (project.archived) return err({ kind: "ProjectArchived", project: command.project });
  const workspace = project.workspace;
  if (workspace === null) {
    // An unclaimed project's keys were minted with it; issuing more before it
    // belongs to anybody would be an unattributable credential.
    return err({ kind: "GrantMismatch" });
  }

  // Q3 first, before any name lookup or write: an escalating request should
  // fail on the escalation, not on a name clash it also happens to have.
  const grantable = grantableTo(command.kind, command.held);
  if (!grantable.ok) return grantable;
  const narrowed = withinGrant(command.kind === "service" ? command.requested ?? grantable.value : grantable.value, grantable.value);
  if (!narrowed.ok) return narrowed;

  const existing = await deps.credentials.list({ level: "project", project: command.project });
  const name = nameIsAvailable(existing, command.name, at);
  if (!name.ok) return name;

  const issued = await deps.credentials.issue(
    {
      kind: command.kind,
      name: name.value,
      workspace,
      project: command.project,
      issuedBy: command.issuedBy,
      permissionCeiling: narrowed.value,
      expiresIn: command.expiresIn,
    },
    at,
  );
  if (!issued.ok) return issued;

  // The containment check. A subset is a bug we can live with — the key simply
  // does less than it could. A superset is privilege escalation, and the key
  // already exists, so the only safe response is to kill it before returning.
  const contained = withinGrant(issued.value.credential.permissions, narrowed.value);
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
            credentialKind: command.kind,
            at,
          },
        ],
        deps.ids,
      ),
    );
  });

  return ok(issued.value);
};

export type RotateCredentialCommand = {
  readonly project: ProjectId;
  readonly credential: CredentialId;
  /** Rotation returns a new secret, so the caller must hold every retained grant. */
  readonly held: readonly Permission[];
  /** Refuse if the credential is not this kind. Null when the caller genuinely does not care. */
  readonly expected: CredentialKind | null;
  /** Null takes the default window; anything longer than the maximum is clamped. */
  readonly overlap: Duration | null;
};

export type RotationOutcome = {
  readonly issued: IssuedCredential;
  readonly retiring: CredentialSummary;
  /** The instant the outgoing secret stops working. Show this to the operator. */
  readonly graceEndsAt: Instant;
};

/**
 * Rotate with overlap.
 *
 * Underneath this is two writes to the credential store — mint the
 * replacement, then give the outgoing key an expiry — which is why the store
 * exposes it as one call it can make atomic and this layer supplies only the
 * window.
 */
export const rotateCredential = async (
  deps: ProjectDependencies,
  command: RotateCredentialCommand,
): Promise<Result<RotationOutcome, CredentialFailure>> => {
  const at = deps.clock.now();

  const project = await deps.uow.transact(({ projects }) => projects.find(command.project));
  if (project === null) return err({ kind: "NoSuchProject", project: command.project });
  if (project.archived) return err({ kind: "ProjectArchived", project: command.project });

  const existing = await deps.credentials.list({ level: "project", project: command.project });
  const rotatable = mayRotate(existing, command.credential, command.expected, at);
  if (!rotatable.ok) return rotatable;
  const contained = withinGrant(rotatable.value.permissions, command.held);
  if (!contained.ok) return contained;

  const overlap = resolveOverlap(command.overlap);
  const rotated = await deps.credentials.rotate(command.credential, overlap, at);
  if (!rotated.ok) return err(asProjectError(rotated.error));

  const graceEndsAt = Instant.plus(at, overlap);
  await deps.uow.transact(async ({ outbox }) => {
    await outbox.enqueue(
      envelopes(
        [
          {
            kind: "CredentialIssued",
            project: command.project,
            credential: rotated.value.issued.credential.id,
            credentialKind: rotatable.value.kind,
            at,
          },
          {
            kind: "CredentialRotated",
            project: command.project,
            outgoing: command.credential,
            replacement: rotated.value.issued.credential.id,
            graceEndsAt,
            at,
          },
        ],
        deps.ids,
      ),
    );
  });

  return ok({ issued: rotated.value.issued, retiring: rotated.value.retiring, graceEndsAt });
};

export type RevokeCredentialCommand = {
  readonly project: ProjectId;
  readonly credential: CredentialId;
};

/**
 * Revoke immediately — refusing the last usable ingest key.
 *
 * The precondition is checked here, before the store is asked, because the
 * store cannot know it: "this project would stop receiving events" is a
 * business rule, not a property of a row. It returns a typed refusal rather
 * than throwing, so the console can say what happened instead of showing a 500.
 */
export const revokeCredential = async (
  deps: ProjectDependencies,
  command: RevokeCredentialCommand,
): Promise<Result<CredentialSummary, CredentialFailure>> => {
  const at = deps.clock.now();

  const project = await deps.uow.transact(({ projects }) => projects.find(command.project));
  if (project === null) return err({ kind: "NoSuchProject", project: command.project });

  const existing = await deps.credentials.list({ level: "project", project: command.project });
  const revocable = mayRevoke(existing, command.credential, at);
  if (!revocable.ok) return revocable;

  const revoked = await deps.credentials.revoke(command.credential, at);
  if (!revoked.ok) return err(asProjectError(revoked.error));

  await deps.uow.transact(async ({ outbox }) => {
    await outbox.enqueue(
      envelopes(
        [
          {
            kind: "CredentialRevoked",
            project: command.project,
            credential: command.credential,
            at,
          },
        ],
        deps.ids,
      ),
    );
  });

  // `mayRevoke` is generic in the record it was given, so this is the caller's
  // own `CredentialSummary` with the one field the revoke changed.
  return ok({ ...revocable.value, revokedAt: at });
};

/**
 * A key placed on the whole workspace, not on one project.
 *
 * **This is what makes claiming reachable with a credential.** Every key
 * `issueCredential` mints is project-bound, and Q2 refuses a project-bound
 * principal anything placed at the workspace — on purpose, since reading "no
 * project" as "no restriction" is the v2 escalation. Claiming is authorized on
 * the *destination workspace*, so before this existed no key any route could
 * issue was able to claim: an agent could provision a project through the
 * no-signup path and had no way to keep it, which is the asymmetry that most
 * contradicts "API-first".
 *
 * It lives in this package with the rest of the credential lifecycle rather
 * than in tenancy, because every rule it applies — `grantableTo`,
 * `withinGrant`, `nameIsAvailable` — is `@counted/projects-domain`'s. Issuing
 * from two packages would put the escalation check in two places, and the
 * looser one would win.
 *
 * The kind is always `service` and is not a parameter. An ingest key with no
 * project is inert by construction — an ingest principal with a null project
 * reaches nothing — so the other value would mint a key that cannot do
 * anything, and a parameter whose second value is useless is a 400 waiting to
 * happen.
 */
export type IssueWorkspaceCredentialCommand = {
  readonly workspace: WorkspaceId;
  readonly name: string;
  readonly issuedBy: AccountId;
  /** The issuer's expanded permission set, resolved in `apps/*` from their role. */
  readonly held: readonly Permission[];
  readonly expiresIn: Duration | null;
};

export const issueWorkspaceCredential = async (
  deps: ProjectDependencies,
  command: IssueWorkspaceCredentialCommand,
): Promise<Result<IssuedCredential, CredentialFailure>> => {
  const at = deps.clock.now();

  // Q3 first, before any name lookup or write: an escalating request should
  // fail on the escalation, not on a name clash it also happens to have.
  const grantable = grantableTo("service", command.held);
  if (!grantable.ok) return grantable;

  const existing = await deps.credentials.list({
    level: "workspace",
    workspace: command.workspace,
  });
  // Checked against every key in the workspace, its projects' included. A
  // workspace-wide key sharing a name with a project's would make the two
  // indistinguishable in exactly the list this route exists to produce.
  const name = nameIsAvailable(existing, command.name, at);
  if (!name.ok) return name;

  const issued = await deps.credentials.issue(
    {
      kind: "service",
      name: name.value,
      workspace: command.workspace,
      project: null,
      issuedBy: command.issuedBy,
      permissionCeiling: grantable.value,
      expiresIn: command.expiresIn,
    },
    at,
  );
  if (!issued.ok) return issued;

  // A superset is privilege escalation and the key already exists, so the only
  // safe response is to kill it before returning. This is the check that would
  // fire if `defaultPermissions` and `grantableTo` ever disagreed.
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
            kind: "WorkspaceCredentialIssued",
            workspace: command.workspace,
            credential: issued.value.credential.id,
            credentialKind: "service",
            at,
          },
        ],
        deps.ids,
      ),
    );
  });

  return ok(issued.value);
};

/**
 * Every key in the workspace, its projects' included.
 *
 * The asymmetry with `listCredentials` runs one way and only one way: a
 * workspace scope sees a project's keys, a project scope does not see the
 * workspace's. That is the listing half of the binding rule — a project-bound
 * principal must not discover that a workspace-wide key exists — and it is the
 * store's own contract, not a filter applied here.
 */
export const listWorkspaceCredentials = async (
  deps: ProjectDependencies,
  workspace: WorkspaceId,
): Promise<readonly CredentialListing[]> => {
  const at = deps.clock.now();
  const summaries = await deps.credentials.list({ level: "workspace", workspace });
  return summaries.map((credential) => ({ credential, status: credentialStatus(credential, at) }));
};
