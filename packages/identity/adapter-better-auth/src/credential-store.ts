/**
 * `CredentialStore` over `@better-auth/api-key`.
 *
 * The vendor owns key generation, SHA-256 hashing and the row. The domain owns
 * every rule about them. Three of those rules cannot be delegated, and each one
 * explains a piece of this file that looks like it is working around the
 * library rather than with it.
 *
 * **Time is a parameter, not a clock.** Every port method takes the `Instant`
 * the caller already read. `createApiKey` stamps `new Date()` and
 * `verifyApiKey` compares expiry against `Date.now()`. A store that delegated
 * either would answer a different question than the one it was asked, and
 * "expiry is inclusive of its boundary" would be untestable without sleeping.
 * So the domain's instants live in the `counted*` columns (`placement.ts`) and
 * the vendor's stay its own bookkeeping.
 *
 * **Verification is ours for the same reason** — plus one more. Revocation has
 * to outrank expiry, and the vendor models revocation as a boolean with no
 * instant attached. `verify` here resolves the secret through the vendor's own
 * hasher (`defaultKeyHasher`, an exported function, not an internal reached
 * for) and then applies the port's precedence itself.
 *
 * **Issuance goes through the vendor endpoint anyway**, because that endpoint
 * is what runs `permissions.defaultPermissions` — the single site where a key's
 * authority is computed. Skipping it to write the row directly would make that
 * configuration decorative and put a hand-authored permission set back in the
 * codebase, which is the exact defect the derivation chain exists to remove.
 * The cost is one follow-up write to place the key, and a delete if that write
 * fails, so a row that is not a fully-formed credential never survives.
 */

import {
  AccountId,
  CredentialId,
  Duration,
  Instant,
  ProjectId,
  WorkspaceId,
  err,
  ok,
  unbrand,
  type Permission,
  type Result,
} from "@counted/kernel";
import {
  CREDENTIAL_PREFIX,
  credentialKindOf,
  type CredentialKind,
  type CredentialScope,
  type CredentialStore,
  type CredentialSummary,
  type IssueFailure,
  type IssueRequest,
  type IssuedCredential,
  type MembershipDirectory,
  type RevocationFailure,
  type RotatedCredential,
  type RotationFailure,
  type VerificationFailure,
  type VerifiedCredential,
} from "@counted/identity-ports";
import { defaultKeyHasher } from "@better-auth/api-key";
import type { IdentityAuth } from "./auth";
import type { ProjectPlacements } from "./config";
import { fromStatements, parsePermissions, toStatements } from "./permissions";
import { API_KEY_MODEL, CONFIG_ID, ORGANIZATION_MODEL, kindOfConfigId } from "./placement";
import { booleanOf, dateOf, instantOf, type ApiKeyRow, type OrganizationRow } from "./rows";

export type CredentialStoreDeps = {
  readonly identity: IdentityAuth;
  readonly memberships: MembershipDirectory;
  readonly projects: ProjectPlacements;
  /**
   * The workspace an unclaimed project's keys are issued against. See
   * `IdentityConfig.holdingWorkspace` for why this is a workspace and not a
   * nullable field on `IssueRequest`.
   */
  readonly holding: WorkspaceId;
};

/** What `issue` writes onto the row the vendor just created. */
type Placement = {
  readonly workspace: WorkspaceId;
  readonly project: ProjectId | null;
  readonly issuedBy: string;
  readonly issuedAt: Instant;
  readonly expiresAt: Instant | null;
};

export const betterAuthCredentialStore = (deps: CredentialStoreDeps): CredentialStore => {
  const { identity, memberships, projects, holding } = deps;
  const context = async () => await identity.auth.$context;

  /**
   * A row as a summary, or null if the row is not one of ours.
   *
   * "Not one of ours" means no `countedWorkspaceId`: either a key minted
   * through better-auth's own endpoints (which `handler.ts` blocks precisely
   * so this cannot happen over HTTP) or the one-statement-wide window between
   * the vendor's insert and our placement write. Such a row is invisible to
   * `list` and unverifiable by `verify` — a credential with no workspace has
   * no scope, and a scopeless credential must not be usable.
   */
  const toSummary = (row: ApiKeyRow): CredentialSummary | null => {
    const kind = kindOfConfigId(row.configId);
    const workspace = row.countedWorkspaceId;
    if (kind === null || typeof workspace !== "string" || workspace.length === 0) return null;

    return {
      id: CredentialId(row.id),
      kind,
      name: row.name ?? "",
      /**
       * `${start}…` and not a slice of the secret. `start` is stored at
       * exactly prefix-plus-`CREDENTIAL_HINT_REVEALED` characters (see
       * `auth.ts`), so this is character-for-character what `credentialHint`
       * computes — which is how a list that has never seen a secret can still
       * show the same hint issuance did. The ellipsis is load-bearing: it is
       * what makes the hint fail a substring test against the live secret.
       */
      hint:
        typeof row.start === "string" && row.start.length > 0
          ? `${row.start}…`
          : `${CREDENTIAL_PREFIX[kind]}…`,
      workspace: WorkspaceId(workspace),
      project:
        typeof row.countedProjectId === "string" && row.countedProjectId.length > 0
          ? ProjectId(row.countedProjectId)
          : null,
      permissions: parsePermissions(row.permissions),
      issuedBy: AccountId(row.countedIssuedById ?? row.referenceId ?? ""),
      createdAt: instantOf(row.countedIssuedAt) ?? Instant.EPOCH,
      expiresAt: instantOf(row.countedExpiresAt),
      lastUsedAt: instantOf(row.countedLastUsedAt),
      revokedAt: instantOf(row.countedRevokedAt),
    };
  };

  const findRow = async (credential: CredentialId): Promise<ApiKeyRow | null> =>
    (await context()).adapter.findOne<ApiKeyRow>({
      model: API_KEY_MODEL,
      where: [{ field: "id", value: unbrand(credential) }],
    });

  const place = async (id: string, placement: Placement): Promise<void> => {
    await (
      await context()
    ).adapter.update({
      model: API_KEY_MODEL,
      where: [{ field: "id", value: id }],
      update: {
        countedWorkspaceId: unbrand(placement.workspace),
        countedProjectId: placement.project === null ? null : unbrand(placement.project),
        countedIssuedById: placement.issuedBy,
        countedIssuedAt: dateOf(placement.issuedAt),
        countedExpiresAt: placement.expiresAt === null ? null : dateOf(placement.expiresAt),
        countedRevokedAt: null,
        countedLastUsedAt: null,
        countedWindowStartedAt: null,
        countedWindowCount: 0,
      },
    });
  };

  /**
   * Create the vendor row, place it, and read it back.
   *
   * The read-back is not paranoia: the summary must report the permissions
   * that were *stored*, which `defaultPermissions` produced. Returning the set
   * this file computed for its own refusal check would let the two silently
   * disagree, and the stored one is the one verification will use.
   */
  const mint = async (input: {
    kind: CredentialKind;
    name: string;
    issuedBy: string;
    placement: Placement;
    /** Server-derived issuance ceiling, or the inherited grant on rotation. */
    permissions?: readonly Permission[];
  }): Promise<IssuedCredential> => {
    const created = await identity.auth.api.createApiKey({
      body: {
        configId: CONFIG_ID[input.kind],
        name: input.name,
        userId: input.issuedBy,
        metadata: {
          workspaceId: unbrand(input.placement.workspace),
          projectId: input.placement.project === null ? null : unbrand(input.placement.project),
        },
        ...(input.permissions === undefined
          ? {}
          : { permissions: toStatements(input.permissions) }),
      },
    });

    try {
      await place(created.id, input.placement);
    } catch (error) {
      // The row exists and is not a credential. Delete it rather than leave a
      // key that verifies against nothing — this is the only compensation in
      // the file, and it covers exactly one failed statement.
      await (await context()).adapter
        .delete({ model: API_KEY_MODEL, where: [{ field: "id", value: created.id }] })
        .catch(() => undefined);
      throw error;
    }

    const row = await findRow(CredentialId(created.id));
    const summary = row === null ? null : toSummary(row);
    if (summary === null) {
      throw new Error(`identity: credential ${created.id} was created but could not be read back`);
    }
    return { credential: summary, secret: created.key };
  };

  /**
   * The rate limiter, evaluated at `at` rather than at wall-clock now.
   *
   * Only ingest keys carry one, because only ingest keys are public. The
   * window is a fixed one anchored at the first request inside it: simple
   * enough to reason about from two columns, and coarse at the boundary in a
   * way that favours the caller. This is the last line of defence, not the
   * first — a public key deserves a limiter at the edge too — which is why a
   * burst is refused rather than queued.
   *
   * Returns the failure, or null when the request is allowed. Either way it
   * records the use.
   */
  async function meter(row: ApiKeyRow, at: Instant): Promise<VerificationFailure | null> {
    const adapter = (await context()).adapter;
    const windowMillis = row.rateLimitTimeWindow ?? null;
    const max = row.rateLimitMax ?? null;
    const enabled = booleanOf(row.rateLimitEnabled, false) && windowMillis !== null && max !== null;

    if (!enabled) {
      // No limiter, so the only reason to write is `lastUsedAt`, which the
      // port calls advisory and allows to lag. Writing it on every event would
      // put a row update on the ingest hot path for a field nothing authorizes
      // on.
      const lastUsed = instantOf(row.countedLastUsedAt);
      const stale =
        lastUsed === null ||
        !Instant.isBefore(at, Instant.plus(lastUsed, identity.lastUsedResolution));
      if (stale) {
        await adapter.update({
          model: API_KEY_MODEL,
          where: [{ field: "id", value: row.id }],
          update: { countedLastUsedAt: dateOf(at) },
        });
      }
      return null;
    }

    const window = Duration.millis(windowMillis);
    const startedAt = instantOf(row.countedWindowStartedAt);
    const expired = startedAt === null || !Instant.isBefore(at, Instant.plus(startedAt, window));

    if (expired) {
      await adapter.update({
        model: API_KEY_MODEL,
        where: [{ field: "id", value: row.id }],
        update: {
          countedWindowStartedAt: dateOf(at),
          countedWindowCount: 1,
          countedLastUsedAt: dateOf(at),
        },
      });
      return null;
    }

    /**
     * `incrementOne` is the race-safe primitive: the `where` clause is both
     * selector and guard, so two concurrent requests at the limit cannot both
     * be admitted. A plain read-then-write here would let a burst through
     * every time, which on a public key is the only case that matters.
     */
    const admitted = await adapter.incrementOne({
      model: API_KEY_MODEL,
      where: [
        { field: "id", value: row.id },
        { field: "countedWindowCount", operator: "lt", value: max },
      ],
      increment: { countedWindowCount: 1 },
      set: { countedLastUsedAt: dateOf(at) },
    });
    if (admitted !== null) return null;

    // Unreachable: `expired` is true whenever this is null. Written out so the
    // reader does not have to trust control-flow narrowing across a const.
    if (startedAt === null) return null;
    const retryAfter = Instant.between(at, Instant.plus(startedAt, window));
    return { kind: "RateLimited", retryAfter };
  }

  return {
    async issue(request: IssueRequest, at: Instant): Promise<Result<IssuedCredential, IssueFailure>> {
      const organization = await (
        await context()
      ).adapter.findOne<OrganizationRow>({
        model: ORGANIZATION_MODEL,
        where: [{ field: "id", value: unbrand(request.workspace) }],
      });
      if (organization === null) {
        return err({ kind: "NoSuchWorkspace", workspace: request.workspace });
      }

      if (request.project !== null) {
        // A project belonging to another workspace is "no such project", not
        // "forbidden". The issuer has no business learning that another
        // tenant's id resolves to something.
        //
        // An unclaimed project belongs to the holding workspace and to nothing
        // else, so the same comparison covers it: a key for an unclaimed
        // project issued against a real workspace is refused exactly as a
        // cross-tenant one is. Before `ProjectPlacement` existed this read
        // `null` for an unclaimed project and refused every one of them.
        const placement = await projects.placementOf(request.project);
        if (placement === null) {
          return err({ kind: "NoSuchProject", project: request.project });
        }
        const owner = placement.kind === "claimed" ? placement.workspace : holding;
        if (owner !== request.workspace) {
          return err({ kind: "NoSuchProject", project: request.project });
        }
      }

      const role = await memberships.roleOf(request.issuedBy, request.workspace);
      if (role === null) return err({ kind: "IssuerNotAMember", account: request.issuedBy });

      /**
       * The same role/kind derivation as defaultPermissions, intersected with
       * the server-resolved ceiling. A delegated caller never mints the parent
       * account's broader grant, and an empty intersection creates no key.
       */
      const grantable = fromStatements(
        await identity.derive(request.kind, unbrand(request.issuedBy), unbrand(request.workspace)),
      ).filter(permission => request.permissionCeiling === undefined || request.permissionCeiling.includes(permission));
      if (grantable.length === 0) {
        return err({ kind: "NothingGrantable", account: request.issuedBy });
      }

      return ok(
        await mint({
          kind: request.kind,
          name: request.name,
          issuedBy: unbrand(request.issuedBy),
          permissions: grantable,
          placement: {
            workspace: request.workspace,
            project: request.project,
            issuedBy: unbrand(request.issuedBy),
            issuedAt: at,
            expiresAt: request.expiresIn === null ? null : Instant.plus(at, request.expiresIn),
          },
        }),
      );
    },

    async verify(secret: string, at: Instant): Promise<Result<VerifiedCredential, VerificationFailure>> {
      // The prefix is a routing hint and nothing more — an attacker controls
      // this string. It buys one thing: a secret shaped like nothing we issue
      // never reaches the database.
      const kind = credentialKindOf(secret);
      if (kind === null) return err({ kind: "Unknown" });

      const hashed = await defaultKeyHasher(secret);
      const row = await (
        await context()
      ).adapter.findOne<ApiKeyRow>({
        model: API_KEY_MODEL,
        where: [{ field: "key", value: hashed }],
      });
      if (row === null) return err({ kind: "Unknown" });

      const summary = toSummary(row);
      // A row whose configId disagrees with the presented prefix is a key
      // pretending to be the other kind. Unknown, not a distinct failure:
      // telling the caller which of their guesses nearly worked is the whole
      // problem with distinguishable errors here.
      if (summary === null || summary.kind !== kind) return err({ kind: "Unknown" });

      // Revocation outranks expiry. Both can be true; the one an operator
      // caused is the one an incident review needs to see.
      if (summary.revokedAt !== null) return err({ kind: "Revoked", at: summary.revokedAt });
      if (!booleanOf(row.enabled, true)) {
        // Disabled without a revocation instant: somebody turned it off
        // through a path that is not ours. Report it as of now rather than
        // inventing a time.
        return err({ kind: "Revoked", at });
      }
      // Inclusive boundary: `expiresAt` is the first instant at which the key
      // does not work.
      if (summary.expiresAt !== null && !Instant.isBefore(at, summary.expiresAt)) {
        return err({ kind: "Expired", at: summary.expiresAt });
      }

      const limited = await meter(row, at);
      if (limited !== null) return err(limited);

      return ok({
        id: summary.id,
        kind: summary.kind,
        workspace: summary.workspace,
        project: summary.project,
        // Recorded at issuance, not re-expanded from the issuer's current
        // role. A key is a snapshot of authority; re-deriving here would widen
        // every key in circulation the moment somebody is promoted.
        permissions: summary.permissions,
        issuedBy: summary.issuedBy,
      });
    },

    async rotate(
      credential: CredentialId,
      overlap: Duration,
      at: Instant,
    ): Promise<Result<RotatedCredential, RotationFailure>> {
      const row = await findRow(credential);
      const old = row === null ? null : toSummary(row);
      if (row === null || old === null) return err({ kind: "UnknownCredential", credential });
      if (old.revokedAt !== null || !booleanOf(row.enabled, true)) {
        return err({ kind: "AlreadyRevoked", credential });
      }

      /**
       * The replacement gets a fresh copy of the original's lifetime measured
       * from now, so rotating a 90-day key yields another 90-day key rather
       * than one that dies on the original's schedule.
       */
      const lifetime =
        old.expiresAt === null ? null : Instant.between(old.createdAt, old.expiresAt);

      const issued = await mint({
        kind: old.kind,
        name: old.name,
        issuedBy: unbrand(old.issuedBy),
        placement: {
          workspace: old.workspace,
          project: old.project,
          issuedBy: unbrand(old.issuedBy),
          issuedAt: at,
          expiresAt: lifetime === null ? null : Instant.plus(at, lifetime),
        },
        // Inherited, not re-derived: rotation replaces a secret, not a grant.
        // Passing the set explicitly is allowed here and only here, because
        // this call has no request and no headers — `permissions` is rejected
        // outright on anything that does.
        permissions: old.permissions,
      });

      // Never extends: the earlier of what it already had and the end of the
      // overlap. A key three minutes from its natural expiry does not gain a
      // week because somebody rotated it.
      const overlapEnd = Instant.plus(at, overlap);
      const retiringExpiry =
        old.expiresAt === null ? overlapEnd : Instant.min(old.expiresAt, overlapEnd);
      await (
        await context()
      ).adapter.update({
        model: API_KEY_MODEL,
        where: [{ field: "id", value: unbrand(credential) }],
        update: { countedExpiresAt: dateOf(retiringExpiry) },
      });

      return ok({ issued, retiring: { ...old, expiresAt: retiringExpiry } });
    },

    async revoke(credential: CredentialId, at: Instant): Promise<Result<void, RevocationFailure>> {
      const row = await findRow(credential);
      const summary = row === null ? null : toSummary(row);
      if (row === null || summary === null) return err({ kind: "UnknownCredential", credential });
      if (summary.revokedAt !== null || !booleanOf(row.enabled, true)) {
        return err({ kind: "AlreadyRevoked", credential });
      }

      // The instant is ours and the flag is the vendor's. Writing both means
      // any better-auth code path that ever looks at this row also refuses it,
      // while the record of *when* survives for the incident review. The row
      // is never deleted.
      await (
        await context()
      ).adapter.update({
        model: API_KEY_MODEL,
        where: [{ field: "id", value: unbrand(credential) }],
        update: { countedRevokedAt: dateOf(at), enabled: false },
      });
      return ok<void>(undefined);
    },

    async list(scope: CredentialScope): Promise<readonly CredentialSummary[]> {
      /**
       * A workspace scope includes its projects' keys; a project scope does
       * not include the workspace's. That asymmetry is the listing half of the
       * binding rule — a project-bound principal must not discover that a
       * workspace-wide key exists — and it falls straight out of which column
       * is queried.
       */
      const where =
        scope.level === "workspace"
          ? [{ field: "countedWorkspaceId", value: unbrand(scope.workspace) }]
          : [{ field: "countedProjectId", value: unbrand(scope.project) }];

      const rows = await (await context()).adapter.findMany<ApiKeyRow>({
        model: API_KEY_MODEL,
        where,
      });
      const summaries: CredentialSummary[] = [];
      for (const row of rows) {
        const summary = toSummary(row);
        if (summary !== null) summaries.push(summary);
      }
      return summaries;
    },

    async reassignProject(project: ProjectId, workspace: WorkspaceId): Promise<number> {
      /**
       * One column, on the rows bound to one project. The `where` is the
       * guard: a workspace-wide key has no `countedProjectId`, so it cannot be
       * selected here, and a key bound to another project cannot either.
       *
       * Written as an update rather than a re-issue on purpose. Claiming must
       * not invalidate the key the customer was just told to paste, which is
       * what revoke-and-reissue would do.
       */
      const adapter = (await context()).adapter;
      const rows = await adapter.findMany<ApiKeyRow>({
        model: API_KEY_MODEL,
        where: [{ field: "countedProjectId", value: unbrand(project) }],
      });
      const stale = rows.filter((row) => row.countedWorkspaceId !== unbrand(workspace));
      for (const row of stale) {
        await adapter.update({
          model: API_KEY_MODEL,
          where: [{ field: "id", value: row.id }],
          update: { countedWorkspaceId: unbrand(workspace) },
        });
      }
      return stale.length;
    },
  };
};
