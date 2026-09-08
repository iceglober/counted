/**
 * The dependency bundles each context's use cases expect, assembled from the
 * one `ApiDependencies`.
 *
 * Every context declares its own bundle — `DashboardDeps<A>`,
 * `ProjectDependencies`, `TenancyRepositories` — and none of them may import
 * another. This is where they are built, which is the composition root's actual
 * job: not "wire ports to adapters" in the abstract, but decide which
 * repositories a given command sees and inside which transaction.
 *
 * `readers` and `writers` differ in exactly one thing: a writer's repositories
 * are bound to a transaction, so the project cap's read-then-write cannot
 * interleave with another one's. A reader's are on the pool. Handing a reader
 * to a command is the mistake this split exists to make visible.
 */

import { Analysis, type Analysis as AnalysisType } from "@counted/analytics-domain";
import { err, isErr, ok, type Result, type WorkspaceId } from "@counted/kernel";
import type { MonitorError } from "@counted/dashboarding-domain";
import type { DashboardDeps, MonitorDeps } from "@counted/dashboarding-app";
import type { ProjectDependencies, ProjectRepositories } from "@counted/projects-app";
import type { EntitlementDeps } from "@counted/tenancy-app";
import type { UnitOfWork } from "@counted/persistence-ports";
import { PlanCatalog } from "@counted/tenancy-domain";
import type { A, ApiDependencies, Repositories } from "./deps";

/**
 * "This analysis produces a single number a threshold can be compared against."
 *
 * Supplied to `@counted/dashboarding-app` as a function because answering it
 * means reading the Analysis IR, which lives in another context's domain
 * (V3-SPEC §7). Structural validity is checked first so a malformed analysis is
 * `InvalidAnalysis` rather than `AnalysisMustBeScalar` — the second would tell
 * someone to change the shape when the problem is a broken window.
 */
export const isScalarAnalysis = (analysis: AnalysisType): Result<AnalysisType, MonitorError> => {
  const validated = Analysis.validate(analysis);
  if (isErr(validated)) {
    return validated.error.kind === "InvalidAnalysis"
      ? err({ kind: "InvalidAnalysis", detail: validated.error.detail })
      : err({ kind: "InvalidAnalysis", detail: describeAnalysisError(validated.error) });
  }
  return Analysis.isScalar(analysis) ? ok(analysis) : err({ kind: "AnalysisMustBeScalar" });
};

const describeAnalysisError = (
  error: Exclude<import("@counted/analytics-domain").AnalysisError, { kind: "InvalidAnalysis" }>,
): string => {
  switch (error.kind) {
    case "WindowTooLarge":
      return `the window is longer than the maximum of ${error.max}ms`;
    case "UnknownDimension":
      return `no such dimension: ${error.dimension}`;
    case "UnknownMeasure":
      return `no such measure: ${error.measure}`;
  }
};

export const dashboardDeps = (
  deps: ApiDependencies,
  repositories: Repositories,
): DashboardDeps<A> => ({
  dashboards: repositories.dashboards,
  clock: deps.clock,
  ids: deps.ids,
  shareTokens: deps.shareTokens,
});

export const monitorDeps = (
  deps: ApiDependencies,
  repositories: Repositories,
): MonitorDeps<A> => ({
  monitors: repositories.monitors,
  clock: deps.clock,
  ids: deps.ids,
  isScalar: isScalarAnalysis,
});

/**
 * The projects context's bundle.
 *
 * It takes a `UnitOfWork` rather than repositories because its use cases open
 * their own transactions — the credential store is better-auth's tables and
 * shares none of them, so `provisionProject` is a saga that has to commit the
 * project before it can mint a key. `UnitOfWork<Repositories>` satisfies
 * `UnitOfWork<ProjectRepositories>` because a callback that wants fewer
 * repositories accepts a bundle that has more.
 */
export const projectDeps = (deps: ApiDependencies): ProjectDependencies => ({
  uow: deps.uow as UnitOfWork<ProjectRepositories>,
  credentials: deps.identity.credentials,
  clock: deps.clock,
  ids: deps.ids,
});

export const entitlementDeps = (
  deps: ApiDependencies,
  repositories: Repositories,
): EntitlementDeps => ({
  workspaces: repositories.workspaces,
  memberships: deps.identity.memberships,
});

/**
 * How long a project's events are kept, before its own policy narrows it.
 *
 * `null` for an unclaimed project: it belongs to no workspace, so no plan
 * applies. That is not "keep forever" — an unclaimed project's grant expires
 * and the project goes with it — it is "the plan has nothing to say".
 */
export const planRetentionDays = async (
  deps: ApiDependencies,
  repositories: Repositories,
  workspace: WorkspaceId | null,
): Promise<number | null> => {
  if (workspace === null) return null;
  const found = await repositories.workspaces.find(workspace);
  if (found === null) return null;
  return PlanCatalog.limitsFor(found.entitlement.plan).retentionDays;
};
