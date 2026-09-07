/**
 * The rows every suite here needs before it can test anything.
 *
 * Built through the aggregates rather than through raw INSERTs, so a fixture
 * cannot set up a state the domain would refuse — a test that starts from an
 * impossible row proves nothing about the code that has to load a real one.
 */

import { AccountId, Instant, ProjectId, WorkspaceId, type Result } from "@counted/kernel";
import { Project } from "@counted/projects-domain";
import { Workspace } from "@counted/tenancy-domain";
import type { UnitOfWork } from "@counted/persistence-ports";
import type { Pool } from "pg";
import { unvalidatedAnalysisCodec } from "./decode";
import type { AccountMembership, WorkspaceMemberships } from "./memberships";
import { liveDatabase, resetDatabase } from "./testing";
import type { TenancyTree } from "./tenancy-tree";
import {
  pooledRepositories,
  postgresUnitOfWork,
  type CountedRepositories,
} from "./unit-of-work";

/** What the analysis looks like to this package: opaque, and round-tripped. */
export type TestAnalysis = { readonly metric: string; readonly window?: number };

export const T0 = Instant.fromEpochMillis(Date.UTC(2026, 0, 1));

export const at = (minutes: number): Instant =>
  Instant.fromEpochMillis(Instant.toEpochMillis(T0) + minutes * 60_000);

/** Unwrap a domain Result in a fixture, where a refusal means the test is wrong. */
export const must = <T, E>(result: Result<T, E>): T => {
  if (!result.ok) throw new Error(`fixture refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const anAccount = (name = "ada"): AccountId => AccountId(`acct_${name}`);

export const givenWorkspace = async (
  repositories: CountedRepositories<TestAnalysis>,
  id = "ws_1",
  name = "Acme",
): Promise<WorkspaceId> => {
  const workspace = WorkspaceId(id);
  const opened = must(Workspace.open(workspace, name, anAccount(), T0));
  await repositories.workspaces.save(opened.workspace, opened.events);
  return workspace;
};

export const givenProject = async (
  repositories: CountedRepositories<TestAnalysis>,
  workspace: WorkspaceId,
  id = "prj_1",
  name = "Web",
): Promise<ProjectId> => {
  const project = ProjectId(id);
  const created = must(Project.create(project, name, workspace, T0));
  await repositories.projects.save(created.project, created.events);
  return project;
};

/**
 * A membership lookup the test controls.
 *
 * The real one reads better-auth's rows; this one is the seam that lets a
 * workspace-listing test say "this account is an admin here" without standing
 * up an identity provider to say it.
 */
export class StubMemberships implements WorkspaceMemberships {
  private readonly byAccount = new Map<string, AccountMembership[]>();

  put(account: AccountId, membership: AccountMembership): void {
    const existing = this.byAccount.get(account) ?? [];
    existing.push(membership);
    this.byAccount.set(account, existing);
  }

  async forAccount(account: AccountId): Promise<readonly AccountMembership[]> {
    return this.byAccount.get(account) ?? [];
  }
}

/**
 * The `TenancyTree` the live suites inject, over the host table `testing.ts`
 * creates.
 *
 * A double of what `apps/api` wires from `@counted/analytics-adapter-litics`,
 * and deliberately not `noTenancyTree`: the thing worth proving is that the
 * statements run on the connection the repository was handed, so they commit
 * and roll back with the aggregate row rather than beside it.
 */
export const testTenancyTree: TenancyTree = {
  place: (id, parent) => ({
    sql: `INSERT INTO analytics_org (id, parent_id) VALUES ($1, $2)
          ON CONFLICT (id) DO UPDATE SET parent_id = excluded.parent_id`,
    parameters: [id, parent],
  }),
  remove: (id) => ({ sql: `DELETE FROM analytics_org WHERE id = $1`, parameters: [id] }),
};

export type Harness = {
  readonly pool: Pool;
  readonly repositories: CountedRepositories<TestAnalysis>;
  readonly unitOfWork: UnitOfWork<CountedRepositories<TestAnalysis>>;
  readonly memberships: StubMemberships;
  reset(): Promise<void>;
};

/** Everything a suite in this package needs, against the live database. */
export const liveHarness = async (): Promise<Harness> => {
  const pool = await liveDatabase();
  const memberships = new StubMemberships();
  const options = {
    analysis: unvalidatedAnalysisCodec<TestAnalysis>(),
    memberships,
    tenancy: testTenancyTree,
  };
  return {
    pool,
    memberships,
    repositories: pooledRepositories(pool, options),
    unitOfWork: postgresUnitOfWork(pool, options),
    reset: () => resetDatabase(pool),
  };
};
