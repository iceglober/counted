/**
 * Project — a stream of events, placed in a workspace.
 *
 * What it is **not**, and this is the v3 change: a holder of credentials.
 * better-auth owns every credential row, so the aggregate no
 * longer carries a list of them, and every credential rule in this package is a
 * pure function over `CredentialFacts` the caller loaded from `CredentialStore`.
 * The rules did not move; the rows did.
 *
 * Ownership stays a two-state union rather than a nullable workspace id, for
 * the same reason as v2: "unclaimed" is a lifecycle state with its own rules,
 * not an absence. v1 modelled it as a nullable `claimToken` and the claim link
 * then never expired for any project that had events.
 *
 * Invariants held here:
 *   1. A claim grant is single-use and expires.
 *   2. An unclaimed project stops accepting events once its grant lapses —
 *      otherwise anonymous provisioning is an unbounded free tier.
 *   3. An archived project accepts nothing, writes or events.
 *   4. Retention may only ever shorten what the plan grants (see retention.ts).
 *
 * The invariant that is no longer holdable here — "an active project always has
 * at least one usable ingest credential" — moved to `@counted/projects-app`,
 * because the credentials live in another store and one aggregate cannot span
 * two transactions. `provisionProject` compensates rather than pretending.
 */

import {
  err,
  Instant,
  ok,
  type Brand,
  type ProjectId,
  type Result,
  type WorkspaceId,
} from "@counted/kernel";
import type { ProjectError } from "./errors";
import type { ProjectEvent } from "./events";
import { RETENTION_INHERIT, retentionEquals, type RetentionPolicy } from "./retention";

/**
 * The hash of a claim token. Never the token.
 *
 * The domain never sees a secret: an adapter mints the token and hashes it, and
 * what arrives here is a digest to compare. That is also why there is no
 * `mintGrant` — randomness is an adapter's, by rule.
 */
export type ClaimDigest = Brand<string, "ClaimDigest">;
export const ClaimDigest = (raw: string): ClaimDigest => raw as ClaimDigest;

/** A single-use, expiring capability to adopt an unclaimed project into a workspace. */
export type ClaimGrant = {
  readonly digest: ClaimDigest;
  readonly expiresAt: Instant;
};

export type Ownership =
  | { readonly state: "unclaimed"; readonly grant: ClaimGrant }
  | {
      readonly state: "claimed";
      readonly workspace: WorkspaceId;
      readonly claimedAt: Instant;
    };

/** Everything needed to rebuild a Project from a row, and nothing else. */
export type ProjectSnapshot = {
  readonly id: ProjectId;
  readonly name: string;
  readonly ownership: Ownership;
  readonly archived: boolean;
  readonly retention: RetentionPolicy;
};

/** A command's result: the next state, and what happened. */
export type ProjectApplied = {
  readonly project: Project;
  readonly events: readonly ProjectEvent[];
};

/**
 * Compare two digests without leaking, through timing, how much of a guess was
 * right. Pure and dependency-free, because a domain may not reach for
 * `node:crypto` — and this is a string compare over fixed-length hex, so there
 * is nothing a library would do better.
 */
const digestsMatch = (a: ClaimDigest, b: ClaimDigest): boolean => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
};

export class Project {
  private constructor(
    readonly id: ProjectId,
    readonly name: string,
    readonly ownership: Ownership,
    readonly archived: boolean,
    readonly retention: RetentionPolicy,
  ) {}

  /**
   * Create a project that already belongs to a workspace.
   *
   * No credential is minted here. It cannot be: the key lives in another store
   * and the caller has to sequence the two. `provisionProject` in
   * `@counted/projects-app` is the only supported way to create one, and it is
   * the thing that guarantees a first ingest key exists.
   */
  static create(
    id: ProjectId,
    name: string,
    workspace: WorkspaceId,
    at: Instant,
  ): Result<ProjectApplied, ProjectError> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });

    const project = new Project(
      id,
      trimmed,
      { state: "claimed", workspace, claimedAt: at },
      false,
      RETENTION_INHERIT,
    );
    return ok({
      project,
      events: [{ kind: "ProjectCreated", project: id, workspace, name: trimmed, at }],
    });
  }

  /**
   * Create an unclaimed project — the no-signup path, where an agent gets a
   * working ingest key from one unauthenticated call and attaches it to a
   * workspace later.
   */
  static provisionUnclaimed(
    id: ProjectId,
    name: string,
    grant: ClaimGrant,
    at: Instant,
  ): Result<ProjectApplied, ProjectError> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });
    if (!Instant.isAfter(grant.expiresAt, at)) return err({ kind: "GrantExpired" });

    const project = new Project(
      id,
      trimmed,
      { state: "unclaimed", grant },
      false,
      RETENTION_INHERIT,
    );
    return ok({
      project,
      events: [
        {
          kind: "ProjectProvisionedUnclaimed",
          project: id,
          name: trimmed,
          grantExpiresAt: grant.expiresAt,
          at,
        },
      ],
    });
  }

  static rehydrate(s: ProjectSnapshot): Project {
    return new Project(s.id, s.name, s.ownership, s.archived, s.retention);
  }

  snapshot(): ProjectSnapshot {
    return {
      id: this.id,
      name: this.name,
      ownership: this.ownership,
      archived: this.archived,
      retention: this.retention,
    };
  }

  // ── reads ────────────────────────────────────────────────────────────────

  get workspace(): WorkspaceId | null {
    return this.ownership.state === "claimed" ? this.ownership.workspace : null;
  }

  get isClaimed(): boolean {
    return this.ownership.state === "claimed";
  }

  /**
   * Whether the project's *placement* permits ingest at this instant. The other
   * half of the question — is there a usable ingest key — is `canIngest` in
   * credential.ts, because the keys are not here. Both must hold.
   */
  admitsEvents(at: Instant): boolean {
    if (this.archived) return false;
    if (this.ownership.state === "unclaimed") {
      return Instant.isAfter(this.ownership.grant.expiresAt, at);
    }
    return true;
  }

  // ── commands ─────────────────────────────────────────────────────────────

  rename(name: string, at: Instant): Result<ProjectApplied, ProjectError> {
    if (this.archived) return err({ kind: "ProjectArchived", project: this.id });
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });
    if (trimmed === this.name) return err({ kind: "NameUnchanged" });
    return ok({
      project: new Project(this.id, trimmed, this.ownership, false, this.retention),
      events: [{ kind: "ProjectRenamed", project: this.id, name: trimmed, at }],
    });
  }

  /**
   * Stop the project without destroying it. Archiving is the reversible answer
   * to "we are done with this"; deleting is not, and offering only the second
   * makes people keep dead projects forever rather than risk the button.
   */
  archive(at: Instant): Result<ProjectApplied, ProjectError> {
    if (this.archived) return err({ kind: "ProjectArchived", project: this.id });
    return ok({
      project: new Project(this.id, this.name, this.ownership, true, this.retention),
      events: [{ kind: "ProjectArchived", project: this.id, at }],
    });
  }

  restore(at: Instant): Result<ProjectApplied, ProjectError> {
    if (!this.archived) return err({ kind: "ProjectNotArchived", project: this.id });
    return ok({
      project: new Project(this.id, this.name, this.ownership, false, this.retention),
      events: [{ kind: "ProjectRestored", project: this.id, at }],
    });
  }

  setRetention(policy: RetentionPolicy, at: Instant): Result<ProjectApplied, ProjectError> {
    if (this.archived) return err({ kind: "ProjectArchived", project: this.id });
    if (retentionEquals(policy, this.retention)) return err({ kind: "RetentionUnchanged" });
    return ok({
      project: new Project(this.id, this.name, this.ownership, false, policy),
      events: [
        {
          kind: "ProjectRetentionChanged",
          project: this.id,
          days: policy.kind === "days" ? policy.days : null,
          at,
        },
      ],
    });
  }

  /**
   * Adopt an unclaimed project into a workspace. Single use, and it expires.
   *
   * The grant is dropped from the aggregate on success, which is what makes it
   * single-use: there is no longer a digest to present.
   */
  claim(
    presented: ClaimDigest,
    into: WorkspaceId,
    at: Instant,
  ): Result<ProjectApplied, ProjectError> {
    if (this.ownership.state === "claimed") return err({ kind: "AlreadyClaimed" });
    const { grant } = this.ownership;
    if (!Instant.isAfter(grant.expiresAt, at)) return err({ kind: "GrantExpired" });
    if (!digestsMatch(grant.digest, presented)) return err({ kind: "GrantMismatch" });

    return ok({
      project: new Project(
        this.id,
        this.name,
        { state: "claimed", workspace: into, claimedAt: at },
        this.archived,
        this.retention,
      ),
      events: [{ kind: "ProjectClaimed", project: this.id, workspace: into, at }],
    });
  }
}
