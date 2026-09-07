/**
 * The small things every handler does, written once.
 *
 * Chiefly: turning a `Result` into either a value or a thrown oRPC error. The
 * domain never throws — every refusal a caller can cause is a value — and the
 * wire needs a status, so exactly one place performs that conversion and it is
 * this one. A handler that wrote its own `if (!result.ok) throw new ORPCError(…)`
 * would be a second mapping table, and the two would disagree the first time a
 * domain error was renamed.
 */

import type { ProjectId, Result, WorkspaceId } from "@counted/kernel";
import type { Principal } from "@counted/authorization";
import type { AnalysisError } from "@counted/analytics-domain";
import type { DashboardError, MonitorError } from "@counted/dashboarding-domain";
import type { IssueFailure } from "@counted/identity-ports";
import type { ProjectError } from "@counted/projects-domain";
import type { BillingError, WorkspaceError } from "@counted/tenancy-domain";
import {
  fromAnalysisError,
  fromBillingError,
  fromDashboardError,
  fromIssueFailure,
  fromMonitorError,
  fromProjectError,
  fromWorkspaceError,
  raise,
  type Fault,
} from "../faults";

/** Unwrap or throw, with the mapping the error's own union decides. */
export const unwrap = <T, E>(result: Result<T, E>, toFault: (error: E) => Fault): T => {
  if (!result.ok) raise(toFault(result.error));
  return result.value;
};

export const orWorkspaceFault = <T>(result: Result<T, WorkspaceError>): T =>
  unwrap(result, fromWorkspaceError);
export const orProjectFault = <T>(result: Result<T, ProjectError>): T =>
  unwrap(result, fromProjectError);
export const orDashboardFault = <T>(result: Result<T, DashboardError>): T =>
  unwrap(result, fromDashboardError);
export const orMonitorFault = <T>(result: Result<T, MonitorError>): T =>
  unwrap(result, fromMonitorError);
export const orAnalysisFault = <T>(result: Result<T, AnalysisError>): T =>
  unwrap(result, fromAnalysisError);
export const orBillingFault = <T>(result: Result<T, BillingError>): T =>
  unwrap(result, fromBillingError);

/**
 * The credential use cases can refuse with either union, so the mapper picks by
 * shape rather than by a discriminant neither one carries. `IssueFailure`'s
 * four kinds are disjoint from `ProjectError`'s, which is what makes this safe
 * — and a test in `faults.test.ts` asserts they stay disjoint.
 */
const ISSUE_KINDS: readonly string[] = [
  "NoSuchWorkspace",
  "IssuerNotAMember",
  "NothingGrantable",
];

export const orCredentialFault = <T>(result: Result<T, ProjectError | IssueFailure>): T =>
  unwrap(result, (error) =>
    ISSUE_KINDS.includes(error.kind)
      ? fromIssueFailure(error as IssueFailure)
      : fromProjectError(error as ProjectError),
  );

/**
 * The account a principal acts as.
 *
 * A service key acts for the account that issued it — that is what makes an
 * audit trail possible without a session, and why there is no synthetic user
 * here. An ingest or share credential authors nothing, and reaching this with
 * one is a route whose requirement said `account` and got something else,
 * which the authorization middleware has already refused.
 */
export const actingAccount = (principal: Principal): import("@counted/kernel").AccountId => {
  const account = principalActor(principal);
  if (account === null) {
    raise({
      code: "INTERNAL_SERVER_ERROR",
      message: "This route needs an acting account and the credential has none.",
      data: { reason: "NoActingAccount", principal: principal.kind },
    });
  }
  return account;
};

const principalActor = (principal: Principal): import("@counted/kernel").AccountId | null => {
  switch (principal.kind) {
    case "account":
      return principal.account;
    case "service":
      return principal.onBehalfOf;
    default:
      return null;
  }
};

/** The workspace a `resource`-kind requirement resolved to. */
export const locatedWorkspace = (
  located: { placement: { workspace: WorkspaceId | null } } | null,
): WorkspaceId => {
  if (located === null || located.placement.workspace === null) {
    raise({
      code: "INTERNAL_SERVER_ERROR",
      message: "This route needs a placed resource and the requirement resolved none.",
      data: { reason: "UnplacedResource" },
    });
  }
  return located.placement.workspace;
};

export const locatedProject = (
  located: { placement: { project: ProjectId | null } } | null,
): ProjectId => {
  if (located === null || located.placement.project === null) {
    raise({
      code: "INTERNAL_SERVER_ERROR",
      message: "This route needs a project-placed resource and the requirement resolved none.",
      data: { reason: "UnplacedResource" },
    });
  }
  return located.placement.project;
};

/** A short, URL-safe slug, unique by construction rather than by retry. */
export const slugify = (name: string, unique: string): string => {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const suffix = unique.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toLowerCase();
  return stem.length === 0 ? `workspace-${suffix}` : `${stem}-${suffix}`;
};
