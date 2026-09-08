/**
 * The provisioning reconciler, against fakes.
 *
 * The state it looks for cannot be produced by any use case on purpose — it is
 * what a *crash* leaves behind — so the fixture writes a project row and no
 * credential, which is exactly the residue of dying between the two stores.
 */

import { describe, expect, test } from "bun:test";
import {
  AccountId,
  Duration,
  Instant,
  ProjectId,
  WorkspaceId,
  type Permission,
} from "@counted/kernel";
import { Project, type ProjectEvent } from "@counted/projects-domain";
import { provisionProject, type ProjectRepositories } from "@counted/projects-app";
import type {
  CredentialScope,
  CredentialStore,
  CredentialSummary,
  IssueRequest,
  IssuedCredential,
  Membership,
  MembershipDirectory,
} from "@counted/identity-ports";
import type { EventEnvelope, Result } from "@counted/kernel";
import { CredentialId, ok } from "@counted/kernel";
import type { Outbox } from "@counted/persistence-ports";
import type { UnitOfWork } from "@counted/persistence-ports";

/**
 * Local fakes, not `@counted/projects-app`'s. That package keeps its fakes out
 * of its public surface on purpose — a fake that ships as API eventually gets
 * imported by something that is not a test — so the worker declares the three
 * it needs, small enough to read.
 */
class FakeProjects {
  readonly rows = new Map<string, Project>();
  async find(id: ProjectId): Promise<Project | null> {
    return this.rows.get(String(id)) ?? null;
  }
  async listForWorkspace(): Promise<readonly Project[]> {
    return [...this.rows.values()];
  }
  async summariesForWorkspace(): Promise<readonly never[]> {
    return [];
  }
  async save(project: Project, _events: readonly ProjectEvent[]): Promise<void> {
    this.rows.set(String(project.id), project);
  }
  async delete(id: ProjectId): Promise<void> {
    this.rows.delete(String(id));
  }
}

class FakeOutbox implements Outbox {
  readonly enqueued: EventEnvelope[] = [];
  async enqueue(events: readonly EventEnvelope[]): Promise<void> {
    this.enqueued.push(...events);
  }
  async claim(): Promise<readonly EventEnvelope[]> {
    return [];
  }
  async markDispatched(): Promise<void> {}
  async recordFailure(): Promise<number> {
    return 1;
  }
  async pendingCount(): Promise<number> {
    return this.enqueued.length;
  }
  kinds(): readonly string[] {
    return this.enqueued.map((e) => e.type);
  }
}

class FakeCredentials implements CredentialStore {
  readonly rows = new Map<string, CredentialSummary>();
  #n = 0;

  async issue(request: IssueRequest, at: Instant): Promise<Result<IssuedCredential, never>> {
    this.#n += 1;
    const id = CredentialId(`cred_${this.#n}`);
    const summary: CredentialSummary = {
      id,
      kind: request.kind,
      name: request.name,
      hint: `${request.kind === "ingest" ? "ck" : "sk"}_${this.#n}…`,
      workspace: request.workspace,
      project: request.project,
      // Derived server-side, exactly as the real store does it.
      permissions: request.kind === "ingest" ? ["events:write"] : ["queries:run"],
      issuedBy: request.issuedBy,
      createdAt: at,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    };
    this.rows.set(String(id), summary);
    return ok({ credential: summary, secret: `secret_${this.#n}` });
  }
  async verify(): Promise<never> {
    throw new Error("not used");
  }
  async rotate(): Promise<never> {
    throw new Error("not used");
  }
  async revoke(credential: CredentialId, at: Instant): Promise<Result<void, never>> {
    const row = this.rows.get(String(credential));
    if (row !== undefined) this.rows.set(String(credential), { ...row, revokedAt: at });
    return ok<void>(undefined);
  }
  async list(scope: CredentialScope): Promise<readonly CredentialSummary[]> {
    return [...this.rows.values()].filter((c) =>
      scope.level === "project" ? c.project === scope.project : c.workspace === scope.workspace,
    );
  }
  async reassignProject(): Promise<number> {
    return 0;
  }
}

const fakeUow = (projects: FakeProjects, outbox: FakeOutbox): UnitOfWork<ProjectRepositories> => ({
  async transact(work) {
    return work({ projects, outbox });
  },
});

const sequentialIds = (prefix: string) => {
  let n = 0;
  return { next: () => `${prefix}_${(n += 1)}` };
};

import { reconcileProvisioning } from "./provisioning";
import { recordingLogger } from "../logging";
import type { ProjectRecord, RecentProjects } from "../ports";
import { T0 } from "../testing";

const WS = WorkspaceId("ws_1");
const OWNER = AccountId("acc_owner");
const ADMIN: readonly Permission[] = [
  "queries:run",
  "projects:read",
  "projects:write",
  "dashboards:read",
  "dashboards:write",
  "monitors:read",
  "monitors:write",
  "workspace:read",
  "events:write",
  "credentials:read",
  "credentials:write",
  "billing:read",
];

const memberships = (members: readonly Membership[]): MembershipDirectory => ({
  async roleOf(account, workspace) {
    if (workspace !== WS) return null;
    return members.find((m) => m.account === account)?.role ?? null;
  },
  async membersOf(workspace) {
    return workspace === WS ? members : [];
  },
});

const OWNERS = memberships([{ account: OWNER, role: "owner", since: T0 }]);

const stand = () => {
  const projects = new FakeProjects();
  const outbox = new FakeOutbox();
  const credentials = new FakeCredentials();
  const uow = fakeUow(projects, outbox);
  const projectDeps = { uow, credentials, clock: { now: () => T0 }, ids: sequentialIds("id") };
  const logger = recordingLogger();

  const recent: RecentProjects = {
    async createdSince(): Promise<readonly ProjectRecord[]> {
      return [...projects.rows.values()]
        .filter((project) => project.workspace !== null)
        .map((project) => ({
          project: project.id,
          workspace: WS,
          name: project.name,
          createdAt: T0,
        }));
    },
  };

  const deps = {
    projects: recent,
    credentials,
    memberships: OWNERS,
    projectDeps,
    logger,
    lookback: Duration.hours(1),
    batch: 50,
    repair: true,
  };

  return { projects, outbox, credentials, projectDeps, logger, deps };
};

/** A project row with no credential: what a crash between the two stores leaves. */
const orphan = async (w: ReturnType<typeof stand>, id = "prj_orphan") => {
  const created = Project.create(ProjectId(id), "Orphan", WS, T0);
  if (!created.ok) throw new Error("fixture");
  await w.projectDeps.uow.transact(({ projects }) => projects.save(created.value.project, []));
  return created.value.project.id;
};

describe("the provisioning reconciler", () => {
  test("says it cannot see rather than reporting a healthy database", async () => {
    // The failure mode this replaces: a reconciler with no credential store
    // scans, finds nothing wrong because it can see nothing, and logs a clean
    // report every fifteen minutes forever.
    const w = stand();
    const report = await reconcileProvisioning(
      { ...w.deps, credentials: null, memberships: null, projectDeps: null },
      T0,
    );
    expect(report.kind).toBe("unavailable");
    if (report.kind !== "unavailable") return;
    expect(report.missing).toContain("CredentialStore");
  });

  test("a project with no ingest key gets one, attributed to the workspace's owner", async () => {
    const w = stand();
    const project = await orphan(w);

    const report = await reconcileProvisioning(w.deps, T0);

    expect(report.kind).toBe("checked");
    if (report.kind !== "checked") return;
    expect(report.unprovisioned).toBe(1);
    expect(report.repaired).toBe(1);
    expect(report.failures).toBe(0);

    const issued = await w.credentials.list({ level: "project", project });
    expect(issued).toHaveLength(1);
    expect(issued[0]?.kind).toBe("ingest");
    // Not a synthetic issuer. v1 wrote an empty string into created_by for a
    // year, and the rows are still unattributable.
    expect(issued[0]?.issuedBy).toBe(OWNER);
    expect(w.outbox.kinds()).toContain("projects.CredentialIssued");
  });

  test("a healthy project is not touched, so a sweep is idempotent", async () => {
    const w = stand();
    const provisioned = await provisionProject(w.projectDeps, {
      workspace: WS,
      name: "Healthy",
      issuedBy: OWNER,
      held: ADMIN,
    });
    expect(provisioned.ok).toBe(true);
    const before = w.credentials.rows.size;

    const first = await reconcileProvisioning(w.deps, T0);
    const second = await reconcileProvisioning(w.deps, T0);

    expect(w.credentials.rows.size).toBe(before);
    if (first.kind !== "checked" || second.kind !== "checked") return;
    expect(first.unprovisioned).toBe(0);
    expect(second.repaired).toBe(0);
  });

  test("with repair off it reports and writes nothing", async () => {
    // The honest default. A key issued by mistake is a live credential nobody
    // asked for, and the finding alone is enough for somebody to look.
    const w = stand();
    await orphan(w);

    const report = await reconcileProvisioning({ ...w.deps, repair: false }, T0);

    expect(report.kind).toBe("checked");
    if (report.kind !== "checked") return;
    expect(report.unprovisioned).toBe(1);
    expect(report.repaired).toBe(0);
    expect(w.credentials.rows.size).toBe(0);
    expect(w.logger.lines.some((line) => line.event === "provisioning.unprovisioned")).toBe(true);
  });

  test("a workspace with no members is reported and never repaired", async () => {
    // There is nobody to attribute the key to, and inventing an issuer is
    // worse than a visible gap — the same rule the workspace reconciler
    // applies to an organization with no owner.
    const w = stand();
    await orphan(w);

    const report = await reconcileProvisioning(
      { ...w.deps, memberships: memberships([]) },
      T0,
    );

    expect(report.kind).toBe("checked");
    if (report.kind !== "checked") return;
    expect(report.unrepairable).toBe(1);
    expect(report.repaired).toBe(0);
    expect(w.credentials.rows.size).toBe(0);
  });

  test("a member-only workspace cannot have a key issued into it", async () => {
    // `events:write` is admin-and-up, so the most senior member holding only
    // `member` grants nothing an ingest key could carry. Q3 refuses it here
    // exactly as it would refuse a human asking.
    const w = stand();
    await orphan(w);

    const report = await reconcileProvisioning(
      { ...w.deps, memberships: memberships([{ account: OWNER, role: "member", since: T0 }]) },
      T0,
    );

    expect(report.kind).toBe("checked");
    if (report.kind !== "checked") return;
    expect(report.unrepairable).toBe(1);
    expect(w.credentials.rows.size).toBe(0);
  });

  test("one project's failure does not stop the sweep", async () => {
    const w = stand();
    await orphan(w, "prj_a");
    await orphan(w, "prj_b");
    let calls = 0;
    // Delegating explicitly rather than spreading the instance: the methods
    // live on the prototype, so `{ ...store }` would produce an object with a
    // `rows` field and no behaviour, and every project would "fail".
    const flaky: CredentialStore = {
      issue: (request, at) => w.credentials.issue(request, at),
      verify: () => w.credentials.verify(),
      rotate: () => w.credentials.rotate(),
      revoke: (credential, at) => w.credentials.revoke(credential, at),
      reassignProject: () => w.credentials.reassignProject(),
      list: async (scope) => {
        calls += 1;
        if (calls === 1) throw new Error("the store blinked");
        return w.credentials.list(scope);
      },
    };

    const report = await reconcileProvisioning(
      { ...w.deps, credentials: flaky, projectDeps: { ...w.projectDeps, credentials: flaky } },
      T0,
    );

    expect(report.kind).toBe("checked");
    if (report.kind !== "checked") return;
    expect(report.scanned).toBe(2);
    expect(report.failures).toBe(1);
    expect(report.repaired).toBe(1);
  });

  test("the window is a window: nothing outside the lookback is asked for", async () => {
    const w = stand();
    const asked: Instant[] = [];
    const recording: RecentProjects = {
      createdSince: async (since: Instant) => {
        asked.push(since);
        return [];
      },
    };

    await reconcileProvisioning({ ...w.deps, projects: recording }, T0);
    expect(asked).toEqual([Instant.minus(T0, Duration.hours(1))]);
  });
});
