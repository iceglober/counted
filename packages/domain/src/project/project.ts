/**
 * Project — a source of events, and the holder of its own credentials.
 *
 * Ownership is a two-state union rather than a nullable workspace id, because
 * "unclaimed" is a real lifecycle state with its own rules, not an absence.
 * v1 modelled it as a nullable `claimToken` and the claim link then never
 * expired for any project that had events.
 *
 * Invariants held here:
 *   1. An active project always has at least one usable ingest credential.
 *   2. Ingest credentials carry `events:write` and nothing else.
 *   3. A claim grant is single-use and expires.
 *   4. An unclaimed project stops accepting events once its grant lapses.
 */

import { err, ok, type Result } from "../shared/result";
import type { CredentialId, ProjectId, WorkspaceId } from "../shared/ids";
import type { Duration } from "../shared/duration";
import { Instant } from "../shared/instant";
import {
  Credential,
  type CredentialDigest,
  type CredentialKind,
  type CredentialPrefix,
  INGEST_SCOPES,
  type Scope,
} from "./credential";
import type { ProjectError } from "./errors";
import type { ProjectEvent } from "./events";

/**
 * A single-use, expiring capability to adopt an unclaimed project into a
 * workspace. The digest is stored, never the token itself.
 */
export type ClaimGrant = {
  readonly digest: CredentialDigest;
  readonly expiresAt: Instant;
};

export type Ownership =
  | { readonly state: "unclaimed"; readonly grant: ClaimGrant }
  | { readonly state: "claimed"; readonly workspace: WorkspaceId; readonly claimedAt: Instant };

/** What the caller must supply to mint a credential; secrets never originate here. */
export type IssueRequest = {
  readonly id: CredentialId;
  readonly kind: CredentialKind;
  readonly label: string;
  readonly digest: CredentialDigest;
  readonly prefix: CredentialPrefix;
  /** Ignored for ingest credentials, which are always exactly `events:write`. */
  readonly scopes?: readonly Scope[];
};

export type ProjectSnapshot = {
  readonly id: ProjectId;
  readonly name: string;
  readonly ownership: Ownership;
  readonly credentials: readonly Credential[];
};

export type ProjectApplied = { readonly project: Project; readonly events: readonly ProjectEvent[] };
export type CredentialIssuance = ProjectApplied & { readonly credential: Credential };

export class Project {
  private constructor(
    readonly id: ProjectId,
    readonly name: string,
    readonly ownership: Ownership,
    private readonly credentials: readonly Credential[],
  ) {}

  /**
   * Create a project that already belongs to a workspace, with its first
   * ingest credential. The credential is not optional: a project without one
   * cannot receive events, which is the state v1's signup path shipped.
   */
  static create(
    id: ProjectId,
    name: string,
    workspace: WorkspaceId,
    first: IssueRequest,
    at: Instant,
  ): Result<CredentialIssuance, ProjectError> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });
    if (first.kind !== "ingest") return err({ kind: "FirstCredentialMustIngest" });

    const credential = build(first, at);
    const project = new Project(
      id,
      trimmed,
      { state: "claimed", workspace, claimedAt: at },
      [credential],
    );
    return ok({
      project,
      credential,
      events: [
        { kind: "ProjectCreated", project: id, workspace, name: trimmed, at },
        { kind: "CredentialIssued", project: id, credential: credential.id, credentialKind: "ingest", at },
      ],
    });
  }

  /**
   * Create an unclaimed project — the no-signup path. It ingests immediately
   * and can be adopted into a workspace until the grant expires.
   */
  static provisionUnclaimed(
    id: ProjectId,
    name: string,
    grant: ClaimGrant,
    first: IssueRequest,
    at: Instant,
  ): Result<CredentialIssuance, ProjectError> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });
    if (first.kind !== "ingest") return err({ kind: "FirstCredentialMustIngest" });
    if (grant.expiresAt <= at) return err({ kind: "GrantExpired" });

    const credential = build(first, at);
    const project = new Project(id, trimmed, { state: "unclaimed", grant }, [credential]);
    return ok({
      project,
      credential,
      events: [
        { kind: "ProjectProvisionedUnclaimed", project: id, name: trimmed, at },
        { kind: "CredentialIssued", project: id, credential: credential.id, credentialKind: "ingest", at },
      ],
    });
  }

  static rehydrate(s: ProjectSnapshot): Project {
    return new Project(s.id, s.name, s.ownership, s.credentials);
  }

  snapshot(): ProjectSnapshot {
    return { id: this.id, name: this.name, ownership: this.ownership, credentials: this.credentials };
  }

  // ── reads ────────────────────────────────────────────────────────────────

  get workspace(): WorkspaceId | null {
    return this.ownership.state === "claimed" ? this.ownership.workspace : null;
  }

  get isClaimed(): boolean {
    return this.ownership.state === "claimed";
  }

  usableCredentials(at: Instant): readonly Credential[] {
    return this.credentials.filter((c) => Credential.isUsable(c, at));
  }

  usableIngestCredentials(at: Instant): readonly Credential[] {
    return this.usableCredentials(at).filter((c) => c.kind === "ingest");
  }

  /**
   * Resolve a presented digest. Returns the credential only if it is usable
   * right now — this is the single place a key becomes an authorization.
   */
  authenticate(digest: CredentialDigest, at: Instant): Result<Credential, ProjectError> {
    const found = this.credentials.find((c) => c.digest === digest);
    if (found === undefined) return err({ kind: "UnknownCredential" });
    if (found.revokedAt !== null) return err({ kind: "CredentialRevoked", credential: found.id });
    if (!Credential.isUsable(found, at)) return err({ kind: "CredentialExpired", credential: found.id });
    return ok(found);
  }

  /**
   * Whether the project may accept events at this instant. An unclaimed
   * project stops ingesting once its grant lapses — otherwise anonymous
   * provisioning is an unbounded free tier.
   */
  acceptsEvents(at: Instant): boolean {
    if (this.ownership.state === "unclaimed" && this.ownership.grant.expiresAt <= at) return false;
    return this.usableIngestCredentials(at).length > 0;
  }

  // ── commands ─────────────────────────────────────────────────────────────

  issue(request: IssueRequest, at: Instant): Result<CredentialIssuance, ProjectError> {
    if (this.credentials.some((c) => c.id === request.id)) {
      return err({ kind: "CredentialExists", credential: request.id });
    }
    if (request.kind === "service" && (request.scopes ?? []).length === 0) {
      return err({ kind: "ScopesRequired" });
    }

    const credential = build(request, at);
    return ok({
      project: this.with([...this.credentials, credential]),
      credential,
      events: [
        { kind: "CredentialIssued", project: this.id, credential: credential.id, credentialKind: credential.kind, at },
      ],
    });
  }

  /**
   * Rotate with an overlap window: mint a replacement and give the outgoing
   * credential a grace period during which both work. v1 rotated by
   * overwriting in place, so every deployed client broke the instant someone
   * clicked the button.
   */
  rotate(
    outgoing: CredentialId,
    replacement: IssueRequest,
    grace: Duration,
    at: Instant,
  ): Result<CredentialIssuance, ProjectError> {
    const current = this.credentials.find((c) => c.id === outgoing);
    if (current === undefined) return err({ kind: "UnknownCredential" });
    if (current.revokedAt !== null) return err({ kind: "CredentialRevoked", credential: outgoing });
    if (replacement.kind !== current.kind) return err({ kind: "RotationKindMismatch" });

    const issued = build(replacement, at);
    const graceEnd = Instant.plus(at, grace);
    const credentials = this.credentials.map((c) =>
      c.id === outgoing ? Credential.expireAt(c, graceEnd) : c,
    );

    return ok({
      project: this.with([...credentials, issued]),
      credential: issued,
      events: [
        { kind: "CredentialIssued", project: this.id, credential: issued.id, credentialKind: issued.kind, at },
        { kind: "CredentialRotated", project: this.id, outgoing, replacement: issued.id, graceEndsAt: graceEnd, at },
      ],
    });
  }

  /**
   * Revoke immediately. Refuses to remove the last usable ingest credential —
   * a project that cannot receive events is not a state a single click should
   * be able to reach.
   */
  revoke(id: CredentialId, at: Instant): Result<ProjectApplied, ProjectError> {
    const current = this.credentials.find((c) => c.id === id);
    if (current === undefined) return err({ kind: "UnknownCredential" });
    if (current.revokedAt !== null) return err({ kind: "CredentialRevoked", credential: id });

    if (current.kind === "ingest") {
      const remaining = this.usableIngestCredentials(at).filter((c) => c.id !== id);
      if (remaining.length === 0) return err({ kind: "LastIngestCredential", credential: id });
    }

    const credentials = this.credentials.map((c) => (c.id === id ? Credential.revoke(c, at) : c));
    return ok({
      project: this.with(credentials),
      events: [{ kind: "CredentialRevoked", project: this.id, credential: id, at }],
    });
  }

  /** Adopt an unclaimed project into a workspace. Single use, and it expires. */
  claim(
    presented: CredentialDigest,
    into: WorkspaceId,
    at: Instant,
  ): Result<ProjectApplied, ProjectError> {
    if (this.ownership.state === "claimed") return err({ kind: "AlreadyClaimed" });
    const { grant } = this.ownership;
    if (grant.expiresAt <= at) return err({ kind: "GrantExpired" });
    if (grant.digest !== presented) return err({ kind: "GrantMismatch" });

    return ok({
      project: new Project(
        this.id,
        this.name,
        { state: "claimed", workspace: into, claimedAt: at },
        this.credentials,
      ),
      events: [{ kind: "ProjectClaimed", project: this.id, workspace: into, at }],
    });
  }

  rename(name: string, at: Instant): Result<ProjectApplied, ProjectError> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });
    if (trimmed === this.name) return err({ kind: "NameUnchanged" });
    return ok({
      project: new Project(this.id, trimmed, this.ownership, this.credentials),
      events: [{ kind: "ProjectRenamed", project: this.id, name: trimmed, at }],
    });
  }

  private with(credentials: readonly Credential[]): Project {
    return new Project(this.id, this.name, this.ownership, credentials);
  }
}

/** Ingest credentials are always exactly `events:write`, whatever was asked for. */
const build = (r: IssueRequest, at: Instant): Credential => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  digest: r.digest,
  prefix: r.prefix,
  scopes: r.kind === "ingest" ? INGEST_SCOPES : [...(r.scopes ?? [])],
  issuedAt: at,
  expiresAt: null,
  revokedAt: null,
});
