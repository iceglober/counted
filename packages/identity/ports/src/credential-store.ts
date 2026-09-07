/**
 * CredentialStore — issuing, verifying and retiring machine credentials.
 *
 * **better-auth owns every credential row; the domain owns every rule about
 * them.** `@better-auth/api-key` stores keys
 * as SHA-256 hashes resolved by a single lookup, supports several named
 * configurations through `configId` (which is exactly the ingest/service
 * distinction), and treats `permissions` as a **server-only property** — a
 * client request that names permissions is rejected outright.
 *
 * That last property is why `IssueRequest` below has **no `permissions`
 * field**. Its server-resolved `permissionCeiling` can only remove permissions
 * from the derived grant. See `credential-kind.ts` for the escalation this removes and for
 * `CredentialGrants`, the one function every implementation derives the set
 * with.
 *
 * The invariant to protect: **no key's permissions are ever authored by hand.**
 * `accesscontrol` is the single grant table; a key's permission set is a
 * *representation* derived from it at issuance, and verification is then a
 * containment check rather than a decision. The moment someone types a
 * permission set onto a key there are two policies and no rule about which
 * wins.
 *
 * Two timing conventions are pinned here rather than left to each adapter,
 * because a fake and a real store that disagree about them produce tests that
 * pass and a system that does not:
 *
 * - **Expiry is inclusive of the boundary**: a credential is expired when
 *   `at >= expiresAt`. An `expiresAt` is the first instant at which the key
 *   does not work.
 * - **Revocation outranks expiry.** A credential that is both revoked and past
 *   its expiry reports `Revoked`, because that is the fact an operator caused
 *   and the one an incident review needs to see.
 */

import type {
  AccountId,
  CredentialId,
  Duration,
  Instant,
  Permission,
  ProjectId,
  Result,
  WorkspaceId,
} from "@counted/kernel";
import type { CredentialKind } from "./credential-kind";

/** What a human sees in a key list. Contains no secret and no digest. */
export type CredentialSummary = {
  readonly id: CredentialId;
  readonly kind: CredentialKind;
  readonly name: string;
  /** The masked display stub, e.g. `ck_a1b2…`. Never a verbatim slice of the
   *  secret — see `credentialHint`. */
  readonly hint: string;
  readonly workspace: WorkspaceId;
  /**
   * The project this key was issued on, or null for a workspace-wide key. This
   * field is half of the answer to authorization's second question — see
   * `Binding` in @counted/authorization. A workspace-placed resource is NOT
   * automatically reachable by a project-bound key; that assumption is the v2
   * defect this field exists to make explicit rather than implicit.
   */
  readonly project: ProjectId | null;
  readonly permissions: readonly Permission[];
  /**
   * The account whose authority this key carries. Recorded as the author of
   * anything the key creates — there is no synthetic user, so a key's actions
   * are attributable to a human even after that human's role changes.
   */
  readonly issuedBy: AccountId;
  readonly createdAt: Instant;
  readonly expiresAt: Instant | null;
  /**
   * Advisory and allowed to lag: an implementation may batch this write, and
   * the port contract does not require `verify` to update it synchronously.
   * Use it to spot dormant keys, never to make an authorization decision.
   */
  readonly lastUsedAt: Instant | null;
  readonly revokedAt: Instant | null;
};

/**
 * Note what is absent: `permissions`. The store derives the set from `kind` and
 * the issuer's role through the `CredentialGrants` it was configured with,
 * then intersects the optional delegation ceiling.
 */
export type IssueRequest = {
  readonly kind: CredentialKind;
  readonly name: string;
  readonly workspace: WorkspaceId;
  /** Null places the key on the whole workspace. */
  readonly project: ProjectId | null;
  readonly issuedBy: AccountId;
  /** Server-resolved delegation ceiling; it can only narrow the role-derived grant. */
  readonly permissionCeiling?: readonly Permission[];
  /** Null means it does not expire on its own. */
  readonly expiresIn: Duration | null;
};

export type IssuedCredential = {
  readonly credential: CredentialSummary;
  /**
   * The plaintext secret. Returned exactly once, at issuance, and never
   * recoverable — the store keeps only a hash. Nothing else in this file ever
   * carries it, which is the property the contract suite checks by walking
   * every summary a store hands back.
   */
  readonly secret: string;
};

export type IssueFailure =
  | { readonly kind: "NoSuchWorkspace"; readonly workspace: WorkspaceId }
  | { readonly kind: "NoSuchProject"; readonly project: ProjectId }
  | { readonly kind: "IssuerNotAMember"; readonly account: AccountId }
  /** The issuer's role grants nothing this kind of key could carry. A member
   *  asking for an ingest key lands here: `events:write` is admin-and-up. */
  | { readonly kind: "NothingGrantable"; readonly account: AccountId };

/** What a presented secret resolves to. Never contains the secret. */
export type VerifiedCredential = {
  readonly id: CredentialId;
  readonly kind: CredentialKind;
  readonly workspace: WorkspaceId;
  readonly project: ProjectId | null;
  readonly permissions: readonly Permission[];
  readonly issuedBy: AccountId;
};

/**
 * Why a secret did not resolve.
 *
 * `Unknown`, `Revoked` and `Expired` are reported separately here and
 * **collapsed into `anonymous` by the caller that builds a Principal**. Keeping
 * them distinct at this layer is what lets the audit log say which happened;
 * collapsing them at the boundary is what stops a message or timing difference
 * telling an attacker which of their guesses exists. `RateLimited` does not
 * collapse — it is a 429 and the caller must be told to back off.
 */
export type VerificationFailure =
  | { readonly kind: "Unknown" }
  | { readonly kind: "Revoked"; readonly at: Instant }
  | { readonly kind: "Expired"; readonly at: Instant }
  | { readonly kind: "RateLimited"; readonly retryAfter: Duration };

/**
 * The outcome of a rotation: a new secret to start using, and the old key with
 * a short expiry so in-flight callers are not cut off mid-request.
 */
export type RotatedCredential = {
  readonly issued: IssuedCredential;
  readonly retiring: CredentialSummary;
};

export type RotationFailure =
  | { readonly kind: "UnknownCredential"; readonly credential: CredentialId }
  | { readonly kind: "AlreadyRevoked"; readonly credential: CredentialId };

export type RevocationFailure =
  | { readonly kind: "UnknownCredential"; readonly credential: CredentialId }
  | { readonly kind: "AlreadyRevoked"; readonly credential: CredentialId };

/**
 * Whose keys to list.
 *
 * A workspace scope includes its projects' keys; a project scope does **not**
 * include the workspace's. The asymmetry is deliberate and is the listing half
 * of the binding rule: a project-bound principal must not discover that a
 * workspace-wide key exists.
 */
export type CredentialScope =
  | { readonly level: "workspace"; readonly workspace: WorkspaceId }
  | { readonly level: "project"; readonly project: ProjectId };

export interface CredentialStore {
  /**
   * Mint a credential. The permission set is computed, never accepted.
   *
   * `at` is the issuance instant and becomes `createdAt`; `expiresIn` is added
   * to it to produce `expiresAt`. Time is a parameter because the caller has
   * already read a clock and two reads of a clock inside one operation is how
   * a key gets an expiry earlier than its creation.
   */
  issue(request: IssueRequest, at: Instant): Promise<Result<IssuedCredential, IssueFailure>>;

  /**
   * Resolve a presented secret. This is the ingest hot path: one lookup on the
   * hash, optionally served from secondary storage in front of Postgres.
   *
   * Takes the secret rather than a digest because the hashing scheme belongs to
   * the store — a caller that hashes first has to know which algorithm, and
   * that knowledge then has to be kept in step with the vendor's.
   *
   * Returns the permissions recorded at issuance, not a fresh expansion of the
   * issuer's current role. A key is a snapshot of authority; re-expanding it on
   * every request would silently widen every key in circulation the moment
   * somebody is promoted.
   */
  verify(secret: string, at: Instant): Promise<Result<VerifiedCredential, VerificationFailure>>;

  /**
   * Rotate with overlap: mint a replacement, then give the old secret
   * `overlap` more of life.
   *
   * There is no rotate primitive underneath — this is create-new plus
   * expire-old, and that is the right place for the policy, because "how long
   * does the old key keep working" is a product decision and not a storage one.
   *
   * **Rotation never extends a credential's life.** The retiring key's expiry
   * becomes the earlier of what it already had and `at + overlap`; a key three
   * hours from its natural expiry does not gain a week because somebody
   * rotated it. The replacement inherits kind, placement, issuer and
   * permissions — rotation replaces a secret, not a grant.
   */
  rotate(
    credential: CredentialId,
    overlap: Duration,
    at: Instant,
  ): Promise<Result<RotatedCredential, RotationFailure>>;

  /**
   * Revoke immediately. The rule "you may not revoke your last usable ingest
   * key" is a precondition the projects use case checks *before* calling this;
   * the store does not know about it, because it is a business rule and not a
   * property of storage.
   *
   * A revoked credential is **not** deleted. It keeps appearing in `list` with
   * `revokedAt` set, because "which key was this and who issued it" is the
   * question an incident review asks after the key is already gone.
   */
  revoke(credential: CredentialId, at: Instant): Promise<Result<void, RevocationFailure>>;

  /**
   * Every credential in scope, revoked ones included, in no guaranteed order.
   * Ordering is a presentation choice and pinning one here would make it an
   * adapter obligation for no gain.
   */
  list(scope: CredentialScope): Promise<readonly CredentialSummary[]>;

  /**
   * Record that a project's keys now belong to a different workspace.
   *
   * Exists for exactly one caller: claiming. An unclaimed project's ingest key
   * has to be issued somewhere, and that somewhere is the holding workspace
   * (see `IssueRequest.workspace`) — so the moment the project is adopted, the
   * workspace recorded on its keys is the wrong one. Nothing about what the
   * key *can do* changes, because an ingest principal's binding is read from
   * the project and never from the key row; what changes is whether the
   * customer can see the key at all. Without this, their own ingest key is
   * missing from their workspace's credential listing and `credentials.self`
   * reports a workspace id belonging to the installation.
   *
   * **Only the keys bound to this project move**, so it can never pull a
   * workspace-wide key across a tenant boundary. Revoked keys move too: they
   * stay in the record where the audit will look for them.
   *
   * Returns how many rows it changed, so a caller can log a repair that did
   * nothing differently from one that did something. Idempotent — running it
   * twice moves nothing the second time.
   */
  reassignProject(project: ProjectId, workspace: WorkspaceId): Promise<number>;
}
