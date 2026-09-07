/**
 * A CredentialStore backed by Maps.
 *
 * It keeps plaintext secrets, which a real store must never do — it is a fake,
 * and the contract suite it passes cannot tell the difference because hashing
 * is not observable through the port. Everything that *is* observable is
 * implemented for real: the permission derivation, the expiry boundary, the
 * revoked-outranks-expired precedence, rotation's shortening rule, and the
 * asymmetry between workspace and project listing.
 *
 * The world it issues into is declared explicitly with `defineWorkspace` and
 * `defineProject`. That is not ceremony: `NoSuchWorkspace` and `NoSuchProject`
 * are outcomes the contract suite has to be able to provoke, and a fake where
 * every id exists cannot produce them.
 */

import {
  CredentialId,
  Instant,
  err,
  ok,
  type Duration,
  type ProjectId,
  type Result,
  type WorkspaceId,
} from "@counted/kernel";
import type { IdGenerator } from "@counted/kernel/ports";
import {
  CREDENTIAL_PREFIX,
  credentialHint,
  type CredentialGrants,
} from "../credential-kind";
import type {
  CredentialStore,
  CredentialSummary,
  IssueFailure,
  IssueRequest,
  IssuedCredential,
  RevocationFailure,
  RotatedCredential,
  RotationFailure,
  VerificationFailure,
  VerifiedCredential,
} from "../credential-store";
import type { MembershipDirectory } from "../membership-directory";

export type InMemoryCredentialStoreOptions = {
  /**
   * The workspace unclaimed projects' keys are issued against. A project with
   * no workspace is placed here and nowhere else, so a key for one issued
   * against a real workspace is refused exactly as a cross-tenant one is.
   */
  readonly holding: WorkspaceId;
  /** Where roles come from. The same directory the rest of the test uses, so
   *  "promote them and re-issue" is expressible. */
  readonly memberships: MembershipDirectory;
  /**
   * Role and kind to permissions, already composed. `specCredentialGrants`
   * unless a test is probing the derivation itself.
   */
  readonly grants: CredentialGrants;
  readonly ids: IdGenerator;
};

export type InMemoryCredentialStore = CredentialStore & {
  defineWorkspace(workspace: WorkspaceId): void;
  defineProject(project: ProjectId, workspace: WorkspaceId): void;
  /** A project that exists and belongs to no workspace yet. */
  defineUnclaimedProject(project: ProjectId): void;
  clear(): void;
};

type Record_ = { summary: CredentialSummary; readonly secret: string };

export const inMemoryCredentialStore = (
  options: InMemoryCredentialStoreOptions,
): InMemoryCredentialStore => {
  const { memberships, grants, ids, holding } = options;

  const workspaces = new Set<WorkspaceId>();
  /** `null` is "exists, unclaimed"; absent is "no such project". */
  const projects = new Map<ProjectId, WorkspaceId | null>();
  const byId = new Map<CredentialId, Record_>();
  const bySecret = new Map<string, Record_>();

  const store = (record: Record_): void => {
    byId.set(record.summary.id, record);
    bySecret.set(record.secret, record);
  };

  const mint = (
    seed: Omit<CredentialSummary, "id" | "hint" | "createdAt" | "lastUsedAt" | "revokedAt">,
    at: Instant,
  ): IssuedCredential => {
    const secret = `${CREDENTIAL_PREFIX[seed.kind]}${ids.next()}`;
    const summary: CredentialSummary = {
      ...seed,
      id: CredentialId(ids.next()),
      hint: credentialHint(secret),
      createdAt: at,
      lastUsedAt: null,
      revokedAt: null,
    };
    store({ summary, secret });
    return { credential: summary, secret };
  };

  return {
    defineWorkspace(workspace) {
      workspaces.add(workspace);
    },
    defineProject(project, workspace) {
      workspaces.add(workspace);
      projects.set(project, workspace);
    },
    defineUnclaimedProject(project) {
      projects.set(project, null);
    },
    clear() {
      workspaces.clear();
      projects.clear();
      byId.clear();
      bySecret.clear();
    },

    async issue(
      request: IssueRequest,
      at: Instant,
    ): Promise<Result<IssuedCredential, IssueFailure>> {
      if (!workspaces.has(request.workspace)) {
        return err({ kind: "NoSuchWorkspace", workspace: request.workspace });
      }
      if (request.project !== null) {
        // A project of another workspace is "no such project" here, not
        // "forbidden": the issuer has no business learning it exists. An
        // unclaimed project belongs to the holding workspace and to nothing
        // else, so one comparison covers both.
        const placed = projects.has(request.project);
        const owner = placed ? (projects.get(request.project) ?? holding) : null;
        if (owner !== request.workspace) {
          return err({ kind: "NoSuchProject", project: request.project });
        }
      }

      const role = await memberships.roleOf(request.issuedBy, request.workspace);
      if (role === null) return err({ kind: "IssuerNotAMember", account: request.issuedBy });

      const permissions = grants(request.kind, role).filter(permission => request.permissionCeiling === undefined || request.permissionCeiling.includes(permission));
      if (permissions.length === 0) {
        return err({ kind: "NothingGrantable", account: request.issuedBy });
      }

      return ok(
        mint(
          {
            kind: request.kind,
            name: request.name,
            workspace: request.workspace,
            project: request.project,
            permissions,
            issuedBy: request.issuedBy,
            expiresAt:
              request.expiresIn === null ? null : Instant.plus(at, request.expiresIn),
          },
          at,
        ),
      );
    },

    async verify(
      secret: string,
      at: Instant,
    ): Promise<Result<VerifiedCredential, VerificationFailure>> {
      const record = bySecret.get(secret);
      if (record === undefined) return err({ kind: "Unknown" });

      // Revocation outranks expiry: an operator revoked this, and that is the
      // fact worth reporting even after the key would have lapsed anyway.
      const { revokedAt, expiresAt } = record.summary;
      if (revokedAt !== null) return err({ kind: "Revoked", at: revokedAt });
      // Inclusive boundary: at `expiresAt` the key already fails.
      if (expiresAt !== null && !Instant.isBefore(at, expiresAt)) {
        return err({ kind: "Expired", at: expiresAt });
      }

      record.summary = { ...record.summary, lastUsedAt: at };
      byId.set(record.summary.id, record);

      return ok({
        id: record.summary.id,
        kind: record.summary.kind,
        workspace: record.summary.workspace,
        project: record.summary.project,
        permissions: record.summary.permissions,
        issuedBy: record.summary.issuedBy,
      });
    },

    async rotate(
      credential: CredentialId,
      overlap: Duration,
      at: Instant,
    ): Promise<Result<RotatedCredential, RotationFailure>> {
      const record = byId.get(credential);
      if (record === undefined) return err({ kind: "UnknownCredential", credential });
      if (record.summary.revokedAt !== null) {
        return err({ kind: "AlreadyRevoked", credential });
      }

      const old = record.summary;

      // The replacement gets a fresh copy of the original's lifetime measured
      // from now, so rotating a 90-day key yields another 90-day key rather
      // than one that expires on the original's schedule.
      const lifetime =
        old.expiresAt === null ? null : Instant.between(old.createdAt, old.expiresAt);

      const issued = mint(
        {
          kind: old.kind,
          name: old.name,
          workspace: old.workspace,
          project: old.project,
          // Inherited, not re-derived. Rotation replaces a secret; re-expanding
          // the issuer's current role here would silently widen a key whose
          // owner has since been promoted.
          permissions: old.permissions,
          issuedBy: old.issuedBy,
          expiresAt: lifetime === null ? null : Instant.plus(at, lifetime),
        },
        at,
      );

      // Never extends: the earlier of what it had and the end of the overlap.
      const overlapEnd = Instant.plus(at, overlap);
      const retiring: CredentialSummary = {
        ...old,
        expiresAt: old.expiresAt === null ? overlapEnd : Instant.min(old.expiresAt, overlapEnd),
      };
      record.summary = retiring;
      byId.set(retiring.id, record);

      return ok({ issued, retiring });
    },

    async revoke(
      credential: CredentialId,
      at: Instant,
    ): Promise<Result<void, RevocationFailure>> {
      const record = byId.get(credential);
      if (record === undefined) return err({ kind: "UnknownCredential", credential });
      if (record.summary.revokedAt !== null) {
        return err({ kind: "AlreadyRevoked", credential });
      }
      record.summary = { ...record.summary, revokedAt: at };
      byId.set(record.summary.id, record);
      return ok<void>(undefined);
    },

    async reassignProject(project, workspace) {
      let moved = 0;
      for (const record of byId.values()) {
        if (record.summary.project !== project) continue;
        if (record.summary.workspace === workspace) continue;
        record.summary = { ...record.summary, workspace };
        byId.set(record.summary.id, record);
        moved += 1;
      }
      return moved;
    },

    async list(scope) {
      const all = [...byId.values()].map((r) => r.summary);
      return scope.level === "workspace"
        ? all.filter((s) => s.workspace === scope.workspace)
        : // A project scope sees only its own keys. The workspace-wide ones are
          // deliberately invisible — that is the binding rule, in a list.
          all.filter((s) => s.project === scope.project);
    },
  };
};
