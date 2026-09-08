/**
 * What any CredentialStore must do.
 *
 * This is the suite the better-auth adapter runs, and the reason the adapter is
 * replaceable. Most of it is not about storage at all — it pins the two timing
 * conventions (expiry inclusive of its boundary, revocation outranking expiry),
 * the rotation rules (never extends, inherits the grant), the listing asymmetry
 * that keeps a project-bound principal from discovering workspace-wide keys,
 * and the derivation rule that closes v2's privilege-escalation hole.
 *
 * The suite never asserts a specific permission set. It asserts that the set is
 * whatever the harness's own `CredentialGrants` computes — which is what makes
 * it survive the table and the ceiling changing, and what makes a store that
 * hand-writes permissions fail.
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import {
  Duration,
  Instant,
  ROLES,
  type AccountId,
  type CredentialId,
  type Permission,
  type ProjectId,
  type Role,
  type WorkspaceId,
} from "@counted/kernel";
import {
  CREDENTIAL_KINDS,
  CREDENTIAL_PREFIX,
  type CredentialGrants,
  type CredentialKind,
} from "../credential-kind";
import type { CredentialStore, CredentialSummary } from "../credential-store";
import { expectErr, expectOk } from "./result";

/**
 * The world a credential suite needs standing before it starts. Spelled out
 * rather than created through the port, because `NoSuchWorkspace`,
 * `NoSuchProject` and `IssuerNotAMember` are outcomes the suite has to be able
 * to provoke, and it cannot provoke them in a world where everything exists.
 */
export type CredentialStoreWorld = {
  readonly workspace: WorkspaceId;
  /** A project inside `workspace`. */
  readonly project: ProjectId;
  /** One account per role, each a member of `workspace`. */
  readonly accounts: Readonly<Record<Role, AccountId>>;
  /** A real account that belongs to no workspace in this world. */
  readonly stranger: AccountId;
  /** A second tenant, for the isolation checks. */
  readonly otherWorkspace: WorkspaceId;
  readonly otherProject: ProjectId;
  /** An owner of `otherWorkspace`. */
  readonly otherOwner: AccountId;

  /**
   * A project that exists and belongs to no workspace — the state the
   * no-signup path leaves behind between provisioning and claiming.
   *
   * It is in the world because the difference between "unclaimed" and "no such
   * project" is not observable through the port and every store has to get it
   * right: a store that collapses them refuses to mint the ingest key
   * anonymous provisioning hands back, which is what the better-auth adapter
   * did until `ProjectPlacement` existed.
   */
  readonly unclaimedProject: ProjectId;
  /** The workspace unclaimed projects' keys are issued against. */
  readonly holdingWorkspace: WorkspaceId;
  /** An owner of `holdingWorkspace`, senior enough to mint an ingest key. */
  readonly holdingOwner: AccountId;
};

export type CredentialStoreHarness = {
  readonly store: CredentialStore;
  readonly world: CredentialStoreWorld;
  /** The same derivation the store computes permissions with. */
  readonly grants: CredentialGrants;
  /**
   * What a role holds — the grant table alone, before any credential-kind
   * ceiling. The suite needs both: `grants` is what the store must produce,
   * and this is the set that production must never exceed. Deriving one from
   * the other here would make the subset property vacuous.
   */
  readonly held: (role: Role) => readonly Permission[];
  unknownCredential(): CredentialId;
  unknownWorkspace(): WorkspaceId;
  unknownProject(): ProjectId;
  teardown?(): Promise<void>;
};

/** A fixed timeline. Every `at` in this suite is derived from it. */
const T0 = Instant.fromEpochMillis(1_767_225_600_000);
const MINUTE = Duration.minutes(1);
const HOUR = Duration.hours(1);
const DAY = Duration.days(1);

export const credentialStoreContract = (
  label: string,
  create: () => Promise<CredentialStoreHarness> | CredentialStoreHarness,
): void => {
  describe(`CredentialStore contract: ${label}`, () => {
    let h!: CredentialStoreHarness;

    beforeEach(async () => {
      h = await create();
    });
    afterEach(async () => {
      await h.teardown?.();
    });

    /** Issue with the world's defaults, failing loudly if the store refuses. */
    const issue = async (over: {
      kind: CredentialKind;
      role?: Role;
      project?: ProjectId | null;
      workspace?: WorkspaceId;
      expiresIn?: Duration | null;
      at?: Instant;
      name?: string;
    }) => {
      const w = h.world;
      const result = await h.store.issue(
        {
          kind: over.kind,
          name: over.name ?? "key",
          workspace: over.workspace ?? w.workspace,
          project: over.project === undefined ? null : over.project,
          issuedBy: w.accounts[over.role ?? "owner"],
          expiresIn: over.expiresIn === undefined ? null : over.expiresIn,
        },
        over.at ?? T0,
      );
      return expectOk(result, `issue ${over.kind}`);
    };

    // ---- derivation ------------------------------------------------------

    test("a delegation ceiling narrows the role-derived grant and cannot add authority", async () => {
      const request = { kind: "service" as const, name: "narrow", workspace: h.world.workspace, project: h.world.project, issuedBy: h.world.accounts.owner, expiresIn: null };
      const issued = expectOk(await h.store.issue({ ...request, permissionCeiling: ["queries:run"] }, T0), "issue narrowed key");
      expect(issued.credential.permissions).toEqual(["queries:run"]);
      const verified = expectOk(await h.store.verify(issued.secret, T0), "verify narrowed key");
      expect(verified.permissions).toEqual(["queries:run"]);
      const excessive = expectOk(await h.store.issue({ ...request, name: "cannot widen", permissionCeiling: ["queries:run", "workspace:admin"] }, T0), "issue with ungrantable ceiling entry");
      expect(excessive.credential.permissions).toEqual(["queries:run"]);
      const empty = await h.store.issue({ ...request, name: "empty", permissionCeiling: [] }, T0);
      expect(expectErr(empty, "empty intersection").kind).toBe("NothingGrantable");
    });

    test("a secret announces its kind in its prefix", async () => {
      // A key found in a log or a git history has to be classifiable without a
      // database lookup — that is what makes automated secret scanning work.
      for (const kind of CREDENTIAL_KINDS) {
        const role: Role = kind === "ingest" ? "owner" : "member";
        const { secret } = await issue({ kind, role });
        expect(secret.startsWith(CREDENTIAL_PREFIX[kind])).toBe(true);
      }
    });

    test("permissions are derived, never authored", async () => {
      for (const role of ROLES) {
        for (const kind of CREDENTIAL_KINDS) {
          const expected = h.grants(kind, role);
          const result = await h.store.issue(
            {
              kind,
              name: `${role}-${kind}`,
              workspace: h.world.workspace,
              project: null,
              issuedBy: h.world.accounts[role],
              expiresIn: null,
            },
            T0,
          );

          if (expected.length === 0) {
            expect(expectErr(result, `${role} issuing ${kind}`).kind).toBe("NothingGrantable");
            continue;
          }
          const { credential } = expectOk(result, `${role} issuing ${kind}`);
          expect([...credential.permissions].sort()).toEqual([...expected].sort());
        }
      }
    });

    test("an ingest key is capped at events:write however senior the issuer", async () => {
      // Ingest keys ship inside browser bundles. A leaked one adds junk events
      // and nothing else, and that is the entire security argument for
      // embedding them.
      const { credential } = await issue({ kind: "ingest", role: "owner" });
      expect(credential.permissions).toEqual(["events:write"]);
    });

    test("a member cannot mint an ingest key", async () => {
      const result = await h.store.issue(
        {
          kind: "ingest",
          name: "no",
          workspace: h.world.workspace,
          project: null,
          issuedBy: h.world.accounts.member,
          expiresIn: null,
        },
        T0,
      );
      expect(expectErr(result, "member issuing ingest").kind).toBe("NothingGrantable");
    });

    test("no key carries a permission its issuer does not hold", async () => {
      for (const role of ROLES) {
        const held = new Set<Permission>(h.held(role));
        for (const kind of CREDENTIAL_KINDS) {
          const result = await h.store.issue(
            {
              kind,
              name: "subset",
              workspace: h.world.workspace,
              project: null,
              issuedBy: h.world.accounts[role],
              expiresIn: null,
            },
            T0,
          );
          if (!result.ok) continue;
          for (const permission of result.value.credential.permissions) {
            expect(held.has(permission)).toBe(true);
          }
        }
      }
    });

    test("an admin cannot mint a key carrying owner-only permissions", async () => {
      // This is v2's escalation, named. Issuing needed `credentials:write`,
      // which an admin holds; the request body then chose the scopes. The body
      // no longer has the field, and this is the test that says so.
      const adminHolds = new Set<Permission>(h.held("admin"));
      const ownerOnly = h.held("owner").filter((p) => !adminHolds.has(p));
      expect(ownerOnly.length).toBeGreaterThan(0);

      const { credential } = await issue({ kind: "service", role: "admin" });
      for (const permission of ownerOnly) {
        expect(credential.permissions).not.toContain(permission);
      }
    });

    // ---- issuance bookkeeping -------------------------------------------

    test("a new key is created now, unused and unrevoked", async () => {
      const { credential } = await issue({ kind: "service", role: "owner", at: T0 });
      expect(credential.createdAt).toBe(T0);
      expect(credential.lastUsedAt).toBeNull();
      expect(credential.revokedAt).toBeNull();
    });

    test("expiresIn is measured from the issuance instant", async () => {
      const forever = await issue({ kind: "service", role: "owner", expiresIn: null });
      expect(forever.credential.expiresAt).toBeNull();

      const dated = await issue({ kind: "service", role: "owner", expiresIn: DAY, at: T0 });
      expect(dated.credential.expiresAt).toBe(Instant.plus(T0, DAY));
    });

    test("two keys are never the same key", async () => {
      const a = await issue({ kind: "service", role: "owner" });
      const b = await issue({ kind: "service", role: "owner" });
      expect(a.credential.id).not.toBe(b.credential.id);
      expect(a.secret).not.toBe(b.secret);
    });

    test("the hint identifies the key without being a slice of it", async () => {
      // A hint that is a verbatim substring of a live secret is a leak in a
      // smaller font.
      const { credential, secret } = await issue({ kind: "service", role: "owner" });
      expect(credential.hint.length).toBeGreaterThan(0);
      expect(credential.hint.startsWith(CREDENTIAL_PREFIX.service)).toBe(true);
      expect(credential.hint).not.toBe(secret);
      expect(secret.includes(credential.hint)).toBe(false);
    });

    test("no summary the store hands back contains the secret", async () => {
      const { secret } = await issue({ kind: "service", role: "owner" });
      const listed = await h.store.list({ level: "workspace", workspace: h.world.workspace });
      for (const summary of listed) {
        expect(JSON.stringify(summary).includes(secret)).toBe(false);
      }
    });

    // ---- issuance refusals ----------------------------------------------

    test("a workspace that does not exist refuses", async () => {
      const result = await h.store.issue(
        {
          kind: "service",
          name: "x",
          workspace: h.unknownWorkspace(),
          project: null,
          issuedBy: h.world.accounts.owner,
          expiresIn: null,
        },
        T0,
      );
      expect(expectErr(result, "unknown workspace").kind).toBe("NoSuchWorkspace");
    });

    test("a project of another workspace is no such project, not forbidden", async () => {
      // The issuer has no business learning that another tenant's project id
      // resolves to something.
      const result = await h.store.issue(
        {
          kind: "service",
          name: "x",
          workspace: h.world.workspace,
          project: h.world.otherProject,
          issuedBy: h.world.accounts.owner,
          expiresIn: null,
        },
        T0,
      );
      expect(expectErr(result, "foreign project").kind).toBe("NoSuchProject");
    });

    test("an unclaimed project takes a key issued against the holding workspace", async () => {
      // The whole of the no-signup path depends on this. An anonymously
      // provisioned project belongs to nobody, and its key still has to carry
      // a derived permission set — which needs a role, which only exists
      // inside a workspace. The holding workspace is that workspace.
      const issued = expectOk(
        await h.store.issue(
          {
            kind: "ingest",
            name: "default",
            workspace: h.world.holdingWorkspace,
            project: h.world.unclaimedProject,
            issuedBy: h.world.holdingOwner,
            expiresIn: null,
          },
          T0,
        ),
        "unclaimed project, holding workspace",
      );
      expect(issued.credential.project).toBe(h.world.unclaimedProject);
      expect(issued.credential.permissions).toEqual(["events:write"]);
    });

    test("an unclaimed project refuses a key issued against any other workspace", async () => {
      // Otherwise any admin who learned an unclaimed project's id could mint
      // an ingest key on a stranger's project and write events into it. Being
      // owned by nobody is not the same as being open to everybody.
      const result = await h.store.issue(
        {
          kind: "ingest",
          name: "poach",
          workspace: h.world.workspace,
          project: h.world.unclaimedProject,
          issuedBy: h.world.accounts.owner,
          expiresIn: null,
        },
        T0,
      );
      expect(expectErr(result, "unclaimed project, wrong workspace").kind).toBe("NoSuchProject");
    });

    test("a project that does not exist refuses", async () => {
      const result = await h.store.issue(
        {
          kind: "service",
          name: "x",
          workspace: h.world.workspace,
          project: h.unknownProject(),
          issuedBy: h.world.accounts.owner,
          expiresIn: null,
        },
        T0,
      );
      expect(expectErr(result, "unknown project").kind).toBe("NoSuchProject");
    });

    test("claiming moves a project's keys into the workspace that now owns them", async () => {
      // An unclaimed project's key is issued against the holding workspace
      // because it has nowhere else to go. If it stayed there, the customer's
      // own ingest key would be absent from their workspace's listing and
      // `credentials.self` would name a workspace they have never seen.
      const issued = expectOk(
        await h.store.issue(
          {
            kind: "ingest",
            name: "default",
            workspace: h.world.holdingWorkspace,
            project: h.world.unclaimedProject,
            issuedBy: h.world.holdingOwner,
            expiresIn: null,
          },
          T0,
        ),
        "issue on unclaimed",
      );

      const moved = await h.store.reassignProject(h.world.unclaimedProject, h.world.workspace);
      expect(moved).toBe(1);

      const listed = await h.store.list({ level: "workspace", workspace: h.world.workspace });
      expect(listed.map((c) => c.id)).toContain(issued.credential.id);
      // The secret still resolves: this moved a column, not the key.
      const verified = expectOk(await h.store.verify(issued.secret, T0), "verify after claim");
      expect(verified.workspace).toBe(h.world.workspace);
      expect(verified.project).toBe(h.world.unclaimedProject);

      // Idempotent — a second claim, or a retried one, moves nothing.
      expect(await h.store.reassignProject(h.world.unclaimedProject, h.world.workspace)).toBe(0);
    });

    test("reassignment never touches a workspace-wide key", async () => {
      // The `where` is the guard. A key with no project cannot be selected by
      // a project id, so no amount of claiming can drag one across a tenant
      // boundary.
      const wide = expectOk(
        await h.store.issue(
          {
            kind: "service",
            name: "wide",
            workspace: h.world.workspace,
            project: null,
            issuedBy: h.world.accounts.owner,
            expiresIn: null,
          },
          T0,
        ),
        "issue workspace-wide",
      );

      await h.store.reassignProject(h.world.project, h.world.otherWorkspace);

      const listed = await h.store.list({ level: "workspace", workspace: h.world.workspace });
      expect(listed.map((c) => c.id)).toContain(wide.credential.id);
    });

    test("a non-member cannot issue", async () => {
      const result = await h.store.issue(
        {
          kind: "service",
          name: "x",
          workspace: h.world.workspace,
          project: null,
          issuedBy: h.world.stranger,
          expiresIn: null,
        },
        T0,
      );
      expect(expectErr(result, "stranger issuing").kind).toBe("IssuerNotAMember");
    });

    // ---- verification ----------------------------------------------------

    test("a fresh secret resolves to what was issued", async () => {
      const { credential, secret } = await issue({
        kind: "service",
        role: "owner",
        project: h.world.project,
      });
      const verified = expectOk(await h.store.verify(secret, T0), "verify");

      expect(verified.id).toBe(credential.id);
      expect(verified.kind).toBe(credential.kind);
      expect(verified.workspace).toBe(credential.workspace);
      expect(verified.project).toBe(credential.project);
      expect(verified.issuedBy).toBe(credential.issuedBy);
      expect([...verified.permissions].sort()).toEqual([...credential.permissions].sort());
    });

    test("a secret nobody issued is Unknown", async () => {
      for (const guess of ["", "not-a-key", `${CREDENTIAL_PREFIX.service}nonsense`]) {
        expect(expectErr(await h.store.verify(guess, T0), `verify ${guess}`).kind).toBe("Unknown");
      }
    });

    test("expiry is inclusive of its boundary", async () => {
      // `expiresAt` is the first instant at which the key does not work. A fake
      // and a real store that disagree here produce green tests and a broken
      // system.
      const { credential, secret } = await issue({
        kind: "service",
        role: "owner",
        expiresIn: HOUR,
        at: T0,
      });
      const expiresAt = credential.expiresAt;
      expect(expiresAt).not.toBeNull();
      if (expiresAt === null) return;

      expectOk(await h.store.verify(secret, Instant.minus(expiresAt, Duration.millis(1))), "before");
      expect(expectErr(await h.store.verify(secret, expiresAt), "at").kind).toBe("Expired");
      expect(
        expectErr(await h.store.verify(secret, Instant.plus(expiresAt, HOUR)), "after").kind,
      ).toBe("Expired");
    });

    test("a revoked secret reports Revoked, at the instant it was revoked", async () => {
      const { credential, secret } = await issue({ kind: "service", role: "owner" });
      const revokedAt = Instant.plus(T0, HOUR);
      expectOk(await h.store.revoke(credential.id, revokedAt), "revoke");

      const failure = expectErr(await h.store.verify(secret, Instant.plus(revokedAt, MINUTE)), "verify");
      expect(failure.kind).toBe("Revoked");
      if (failure.kind === "Revoked") expect(failure.at).toBe(revokedAt);
    });

    test("revocation outranks expiry", async () => {
      // Both are true; the one an operator caused is the one an incident
      // review needs to see.
      const { credential, secret } = await issue({
        kind: "service",
        role: "owner",
        expiresIn: HOUR,
        at: T0,
      });
      expectOk(await h.store.revoke(credential.id, Instant.plus(T0, MINUTE)), "revoke");
      expect(expectErr(await h.store.verify(secret, Instant.plus(T0, DAY)), "verify").kind).toBe(
        "Revoked",
      );
    });

    // ---- rotation --------------------------------------------------------

    test("rotation issues a working replacement and keeps the old one alive for the overlap", async () => {
      const { credential, secret } = await issue({ kind: "ingest", role: "owner", at: T0 });
      const rotated = expectOk(await h.store.rotate(credential.id, HOUR, T0), "rotate");

      expectOk(await h.store.verify(rotated.issued.secret, T0), "new secret");
      expectOk(await h.store.verify(secret, Instant.plus(T0, MINUTE)), "old secret in overlap");
    });

    test("the retiring secret stops working when the overlap ends", async () => {
      const { credential, secret } = await issue({ kind: "ingest", role: "owner", at: T0 });
      const rotated = expectOk(await h.store.rotate(credential.id, HOUR, T0), "rotate");

      expect(rotated.retiring.expiresAt).toBe(Instant.plus(T0, HOUR));
      expect(
        expectErr(await h.store.verify(secret, Instant.plus(T0, HOUR)), "after overlap").kind,
      ).toBe("Expired");
    });

    test("rotation replaces a secret, not a grant", async () => {
      const { credential, secret } = await issue({
        kind: "service",
        role: "admin",
        project: h.world.project,
      });
      const rotated = expectOk(await h.store.rotate(credential.id, HOUR, T0), "rotate");
      const replacement = rotated.issued.credential;

      expect(replacement.id).not.toBe(credential.id);
      expect(rotated.issued.secret).not.toBe(secret);
      expect(replacement.kind).toBe(credential.kind);
      expect(replacement.workspace).toBe(credential.workspace);
      expect(replacement.project).toBe(credential.project);
      expect(replacement.issuedBy).toBe(credential.issuedBy);
      expect([...replacement.permissions].sort()).toEqual([...credential.permissions].sort());
    });

    test("rotation never extends a credential's life", async () => {
      // A key three minutes from its natural expiry does not gain an hour
      // because somebody rotated it.
      const { credential } = await issue({
        kind: "service",
        role: "owner",
        expiresIn: MINUTE,
        at: T0,
      });
      const rotated = expectOk(await h.store.rotate(credential.id, DAY, T0), "rotate");
      expect(rotated.retiring.expiresAt).toBe(credential.expiresAt);
    });

    test("rotating something that is not there, or already revoked, refuses", async () => {
      expect(
        expectErr(await h.store.rotate(h.unknownCredential(), HOUR, T0), "unknown").kind,
      ).toBe("UnknownCredential");

      const { credential } = await issue({ kind: "service", role: "owner" });
      expectOk(await h.store.revoke(credential.id, T0), "revoke");
      expect(expectErr(await h.store.rotate(credential.id, HOUR, T0), "revoked").kind).toBe(
        "AlreadyRevoked",
      );
    });

    // ---- revocation ------------------------------------------------------

    test("revoking twice refuses the second time", async () => {
      const { credential } = await issue({ kind: "service", role: "owner" });
      expectOk(await h.store.revoke(credential.id, T0), "first");
      expect(
        expectErr(await h.store.revoke(credential.id, Instant.plus(T0, MINUTE)), "second").kind,
      ).toBe("AlreadyRevoked");
    });

    test("revoking something that is not there refuses", async () => {
      expect(expectErr(await h.store.revoke(h.unknownCredential(), T0), "unknown").kind).toBe(
        "UnknownCredential",
      );
    });

    test("a revoked key stays in the list, with the instant it died", async () => {
      // "Which key was this, and who issued it" is asked after the key is gone.
      const { credential } = await issue({ kind: "service", role: "owner" });
      expectOk(await h.store.revoke(credential.id, Instant.plus(T0, HOUR)), "revoke");

      const listed = await h.store.list({ level: "workspace", workspace: h.world.workspace });
      const found = listed.find((s: CredentialSummary) => s.id === credential.id);
      expect(found).toBeDefined();
      expect(found?.revokedAt).toBe(Instant.plus(T0, HOUR));
    });

    // ---- listing ---------------------------------------------------------

    test("a workspace scope includes its projects' keys", async () => {
      const wide = await issue({ kind: "service", role: "owner", project: null });
      const narrow = await issue({ kind: "ingest", role: "owner", project: h.world.project });

      const listed = await h.store.list({ level: "workspace", workspace: h.world.workspace });
      const ids = listed.map((s: CredentialSummary) => s.id);
      expect(ids).toContain(wide.credential.id);
      expect(ids).toContain(narrow.credential.id);
    });

    test("a workspace scope excludes another tenant's keys", async () => {
      const mine = await issue({ kind: "service", role: "owner" });
      const theirs = expectOk(
        await h.store.issue(
          {
            kind: "service",
            name: "theirs",
            workspace: h.world.otherWorkspace,
            project: null,
            issuedBy: h.world.otherOwner,
            expiresIn: null,
          },
          T0,
        ),
        "other tenant issue",
      );

      const listed = await h.store.list({ level: "workspace", workspace: h.world.workspace });
      const ids = listed.map((s: CredentialSummary) => s.id);
      expect(ids).toContain(mine.credential.id);
      expect(ids).not.toContain(theirs.credential.id);
    });

    test("a project scope does not see the workspace's own keys", async () => {
      // The listing half of the binding rule. A workspace-placed credential is
      // not reachable — or discoverable — through a project-bound principal,
      // which is the v2 assumption this asymmetry exists to break.
      const wide = await issue({ kind: "service", role: "owner", project: null });
      const narrow = await issue({ kind: "ingest", role: "owner", project: h.world.project });

      const listed = await h.store.list({ level: "project", project: h.world.project });
      const ids = listed.map((s: CredentialSummary) => s.id);
      expect(ids).toContain(narrow.credential.id);
      expect(ids).not.toContain(wide.credential.id);
    });
  });
};
