/**
 * Standing a real better-auth up, per test.
 *
 * The port contract suites run against this. That is the whole reason they
 * exist: an adapter that only its own bespoke tests exercise is one
 * implementation and a hope, and the suites are written so that a store which
 * hand-authors permissions, or gets the expiry boundary off by one, or lets a
 * project scope see the workspace's keys, fails them.
 *
 * The database is better-auth's in-memory adapter — a real adapter, with real
 * transactions (its `transaction` snapshots and three-way merges), running the
 * real plugin code. What it is not is Postgres, so anything that depends on SQL
 * semantics rather than on the adapter contract is unproven here. The two
 * places that matters are named where they occur: `list` filters on our own
 * columns, and `meter` leans on `incrementOne` being atomic.
 *
 * A fresh instance per test, not a shared one with cleanup between. Cleanup
 * that misses a table produces a suite that passes in order and fails
 * shuffled, and the whole point of these suites is that their failures mean
 * something.
 */

import { AccountId, Instant, ProjectId, WorkspaceId, type Role } from "@counted/kernel";
import type { IdGenerator, Notification, Notifier } from "@counted/kernel/ports";
import { specCredentialGrants, specRoleGrants } from "@counted/identity-ports/testing";
import type { IdentityConfig, ProjectPlacement, ProjectPlacements } from "../config";
import { createIdentityWithAuth, type Identity } from "../identity";
import { MEMBER_MODEL, ORGANIZATION_MODEL } from "../placement";
import type { WorkspaceMirror } from "../provisioning";

export type TestIdentity = Identity & {
  readonly config: IdentityConfig;
  readonly auth: ReturnType<typeof createIdentityWithAuth>["auth"];
  readonly delivered: readonly Notification[];
  readonly logged: readonly { level: string; message: string; details: readonly unknown[] }[];
  /** Register a project so `NoSuchProject` can be provoked by omission. */
  defineProject(project: ProjectId, workspace: WorkspaceId): void;
  /**
   * Register a project that exists and belongs to no workspace — the
   * no-signup path's state. Distinct from a project this harness has never
   * heard of, which is the distinction `ProjectPlacement` exists to make.
   */
  defineUnclaimedProject(project: ProjectId): void;
  /** The workspace unclaimed projects' keys are issued against, per `holding`. */
  readonly holdingWorkspace: WorkspaceId;
  givenAccount(spec: {
    email: string;
    name: string | null;
    emailVerified: boolean;
  }): Promise<AccountId>;
  /** A workspace with no members and, deliberately, no domain mirror row. */
  givenWorkspace(name?: string): Promise<WorkspaceId>;
  givenMember(workspace: WorkspaceId, role: Role, email?: string): Promise<AccountId>;
};

let counter = 0;
const uniqueSuffix = () => `${Date.now().toString(36)}${(counter += 1).toString(36)}`;

/** A mirror that writes nothing. The domain half is another context's package. */
export const noopMirror: WorkspaceMirror = { async place() {} };

export const createTestIdentity = (
  overrides: Partial<IdentityConfig> = {},
  options: { resolveClientAddress?: boolean } = {},
): TestIdentity => {
  // Better Auth's memory limiter is process-wide. Independent test servers
  // represent independent clients; keep their address buckets independent too.
  const client = (counter += 1);
  const fixtureAddress = `198.19.${Math.floor(client / 256) % 256}.${client % 256}`;
  const delivered: Notification[] = [];
  const logged: { level: string; message: string; details: readonly unknown[] }[] = [];
  const notifier: Notifier = {
    async deliver(notification) {
      delivered.push(notification);
    },
  };

  let nextId = 0;
  const ids: IdGenerator = { next: () => `test-${(nextId += 1)}` };

  const placements = new Map<string, ProjectPlacement>();
  const projects: ProjectPlacements = {
    async placementOf(project) {
      return placements.get(project) ?? null;
    },
  };

  /**
   * A fixed id rather than one minted per test: `IdentityConfig` needs it
   * before the instance exists, so it cannot be an organization better-auth
   * created. `ensureHoldingWorkspace` is what makes the rows real, and the
   * suites that need them call it.
   */
  const holdingWorkspace = WorkspaceId("ws-holding");
  const holdingOwner = AccountId("acct-holding-owner");

  const config: IdentityConfig = {
    // The mount included, which is what better-auth resolves a bare origin to
    // and what the composition root passes: the OAuth callback is built from it.
    baseURL: "http://localhost:3000/api/auth",
    secret: "0123456789abcdef0123456789abcdef",
    database: { kind: "memory" },
    grants: specCredentialGrants,
    rolePermissions: specRoleGrants,
    projects,
    holding: { workspace: holdingWorkspace, owner: holdingOwner },
    notifier,
    ids,
    mcpResource: "http://localhost:3000/mcp",
    ...(options.resolveClientAddress === false ? {} : { clientAddress: () => fixtureAddress }),
    // Captured rather than printed. A test that deliberately provokes a vendor
    // error should not decorate the suite's output with it.
    log: (level, message, details) => logged.push({ level, message, details }),
    ...overrides,
  };

  const identity = createIdentityWithAuth(config);

  const adapter = async () => (await identity.auth.auth.$context).adapter;

  return {
    ...identity,
    config,
    delivered,
    logged,

    holdingWorkspace,

    defineProject(project, workspace) {
      placements.set(project, { kind: "claimed", workspace });
    },

    defineUnclaimedProject(project) {
      placements.set(project, { kind: "unclaimed" });
    },

    async givenAccount(spec) {
      const context = await identity.auth.auth.$context;
      const user = await context.internalAdapter.createUser(
        { email: spec.email, name: spec.name ?? "", emailVerified: spec.emailVerified },
        // The provisioning origin better-auth records. Nothing in this package
        // reads it; it is required because `validateUserInfo` would.
        { method: "email-password" },
      );
      return AccountId(user.id);
    },

    async givenWorkspace(name = "Workspace") {
      const row = await (
        await adapter()
      ).create<Record<string, unknown>, { id: string }>({
        model: ORGANIZATION_MODEL,
        data: { name, slug: `${name.toLowerCase()}-${uniqueSuffix()}`, createdAt: new Date() },
      });
      return WorkspaceId(row.id);
    },

    async givenMember(workspace, role, email) {
      const account = await this.givenAccount({
        email: email ?? `${role}-${uniqueSuffix()}@example.com`,
        name: null,
        emailVerified: true,
      });
      await (
        await adapter()
      ).create<Record<string, unknown>, { id: string }>({
        model: MEMBER_MODEL,
        data: {
          organizationId: workspace,
          userId: account,
          role,
          createdAt: Instant.toDate(Instant.fromEpochMillis(1_767_225_600_000)),
        },
      });
      return account;
    },
  };
};
