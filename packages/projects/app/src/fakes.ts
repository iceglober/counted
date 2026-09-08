/**
 * In-memory stand-ins for the four ports these use cases need.
 *
 * Test support, deliberately **not** re-exported from `index.ts` — a fake that
 * ships as public API eventually gets imported by something that is not a test.
 * Import it by path from a `*.test.ts` in this package.
 *
 * They are fakes rather than mocks: they hold state and behave, so a test can
 * assert on what ended up in the outbox rather than on which method was called.
 * The credential store in particular reproduces the two writes a rotation makes
 * — mint a replacement, expire the outgoing key — because the overlap window is
 * the thing most of these tests are about.
 */

import {
  CredentialId,
  err,
  Instant,
  ok,
  type Duration,
  type EventEnvelope,
  type ProjectId,
  type Result,
  type WorkspaceId,
} from "@counted/kernel";
import type { Clock, IdGenerator } from "@counted/kernel/ports";
import type {
  CredentialScope,
  CredentialStore,
  CredentialSummary,
  IssueRequest,
  IssueFailure,
  IssuedCredential,
  RevocationFailure,
  RotatedCredential,
  RotationFailure,
  VerificationFailure,
  VerifiedCredential,
} from "@counted/identity-ports";
import type { Outbox } from "@counted/persistence-ports";
import type { ProjectSummary } from "@counted/projects-ports";
import type { Project, ProjectEvent } from "@counted/projects-domain";
import type { ProjectDependencies, ProjectRepositories, ProjectUnitOfWork } from "./ports";

export const sequentialIds = (prefix: string): IdGenerator => {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `${prefix}_${n}`;
    },
  };
};

export class FakeProjectRepository {
  readonly rows = new Map<string, Project>();
  readonly saved: ProjectEvent[] = [];

  async find(id: ProjectId): Promise<Project | null> {
    return this.rows.get(id) ?? null;
  }

  async listForWorkspace(workspace: string): Promise<readonly Project[]> {
    return [...this.rows.values()].filter((p) => p.workspace === workspace);
  }

  async summariesForWorkspace(workspace: string): Promise<readonly ProjectSummary[]> {
    const projects = await this.listForWorkspace(workspace);
    return projects.map((p) => ({
      id: p.id,
      workspace: p.workspace as NonNullable<Project["workspace"]>,
      name: p.name,
      archived: p.archived,
    }));
  }

  async save(project: Project, events: readonly ProjectEvent[]): Promise<void> {
    this.rows.set(project.id, project);
    this.saved.push(...events);
  }

  async delete(id: ProjectId): Promise<void> {
    this.rows.delete(id);
  }
}

export class FakeOutbox implements Outbox {
  readonly enqueued: EventEnvelope[] = [];

  async enqueue(events: readonly EventEnvelope[]): Promise<void> {
    this.enqueued.push(...events);
  }
  async claim(limit: number): Promise<readonly EventEnvelope[]> {
    return this.enqueued.slice(0, limit);
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

/**
 * Options for making the credential store misbehave in the specific ways the
 * sagas have to survive.
 */
export type FakeCredentialStoreOptions = {
  /** Fail the next `issue` with this, then behave normally. */
  readonly failNextIssue?: IssueFailure;
  /** Hand back a key carrying these permissions, whatever was asked for. */
  readonly grantInstead?: CredentialSummary["permissions"];
};

export class FakeCredentialStore implements CredentialStore {
  readonly rows = new Map<string, CredentialSummary>();
  private counter = 0;
  constructor(private options: FakeCredentialStoreOptions = {}) {}

  configure(options: FakeCredentialStoreOptions): void {
    this.options = options;
  }

  async issue(request: IssueRequest, at: Instant): Promise<Result<IssuedCredential, IssueFailure>> {
    if (this.options.failNextIssue !== undefined) {
      const failure = this.options.failNextIssue;
      const { failNextIssue: _spent, ...rest } = this.options;
      this.options = rest;
      return err(failure);
    }
    this.counter += 1;
    const id = CredentialId(`cred_${this.counter}`);
    const summary: CredentialSummary = {
      id,
      kind: request.kind,
      name: request.name,
      hint: `${request.kind === "ingest" ? "ck" : "sk"}_${this.counter}…`,
      workspace: request.workspace,
      project: request.project,
      // Server-derived, exactly as @better-auth/api-key does it: the request has
      // no permissions field to copy from.
      permissions: this.options.grantInstead ?? request.permissionCeiling ?? (request.kind === "ingest" ? ["events:write"] : ["queries:run"]),
      issuedBy: request.issuedBy,
      createdAt: at,
      expiresAt: request.expiresIn === null ? null : Instant.plus(at, request.expiresIn),
      lastUsedAt: null,
      revokedAt: null,
    };
    this.rows.set(id, summary);
    return ok({ credential: summary, secret: `secret_${this.counter}` });
  }

  async verify(): Promise<Result<VerifiedCredential, VerificationFailure>> {
    return err({ kind: "Unknown" });
  }

  async rotate(
    credential: CredentialId,
    overlap: Duration,
    at: Instant,
  ): Promise<Result<RotatedCredential, RotationFailure>> {
    const outgoing = this.rows.get(credential);
    if (outgoing === undefined) return err({ kind: "UnknownCredential", credential });
    if (outgoing.revokedAt !== null) return err({ kind: "AlreadyRevoked", credential });

    const issued = await this.issue(
      {
        kind: outgoing.kind,
        name: `${outgoing.name} (rotated)`,
        workspace: outgoing.workspace,
        project: outgoing.project,
        issuedBy: outgoing.issuedBy,
        expiresIn: null,
      },
      at,
    );
    if (!issued.ok) return err({ kind: "UnknownCredential", credential });

    const retiring: CredentialSummary = { ...outgoing, expiresAt: Instant.plus(at, overlap) };
    this.rows.set(credential, retiring);
    return ok({ issued: issued.value, retiring });
  }

  async revoke(credential: CredentialId, at: Instant): Promise<Result<void, RevocationFailure>> {
    const row = this.rows.get(credential);
    if (row === undefined) return err({ kind: "UnknownCredential", credential });
    if (row.revokedAt !== null) return err({ kind: "AlreadyRevoked", credential });
    this.rows.set(credential, { ...row, revokedAt: at });
    return ok(undefined);
  }

  async reassignProject(project: ProjectId, workspace: WorkspaceId): Promise<number> {
    let moved = 0;
    for (const [id, row] of this.rows) {
      if (row.project !== project || row.workspace === workspace) continue;
      this.rows.set(id, { ...row, workspace });
      moved += 1;
    }
    return moved;
  }

  async list(scope: CredentialScope): Promise<readonly CredentialSummary[]> {
    return [...this.rows.values()].filter((c) =>
      scope.level === "project" ? c.project === scope.project : c.workspace === scope.workspace,
    );
  }
}

/**
 * A unit of work that really does roll back: repository and outbox state are
 * snapshotted before `work` runs and restored if it throws. Without that, a
 * test asserting "nothing was written" would pass against a fake that never
 * could have written anything.
 */
export const fakeUnitOfWork = (
  projects: FakeProjectRepository,
  outbox: FakeOutbox,
): ProjectUnitOfWork => ({
  async transact<T>(work: (repositories: ProjectRepositories) => Promise<T>): Promise<T> {
    const rows = new Map(projects.rows);
    const saved = [...projects.saved];
    const enqueued = [...outbox.enqueued];
    try {
      return await work({ projects, outbox });
    } catch (error) {
      projects.rows.clear();
      for (const [k, v] of rows) projects.rows.set(k, v);
      projects.saved.length = 0;
      projects.saved.push(...saved);
      outbox.enqueued.length = 0;
      outbox.enqueued.push(...enqueued);
      throw error;
    }
  },
});

export type Harness = {
  readonly deps: ProjectDependencies;
  readonly projects: FakeProjectRepository;
  readonly outbox: FakeOutbox;
  readonly credentials: FakeCredentialStore;
  readonly clock: Clock;
};

export const harness = (at: Instant, options: FakeCredentialStoreOptions = {}): Harness => {
  const projects = new FakeProjectRepository();
  const outbox = new FakeOutbox();
  const credentials = new FakeCredentialStore(options);
  const clock: Clock = { now: () => at };
  return {
    projects,
    outbox,
    credentials,
    clock,
    deps: {
      uow: fakeUnitOfWork(projects, outbox),
      credentials,
      clock,
      ids: sequentialIds("id"),
    },
  };
};
