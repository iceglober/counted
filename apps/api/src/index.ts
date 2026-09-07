/**
 * @counted/api-server — the oRPC router, three hand-written routes, and
 * better-auth's handler.
 *
 * The composition root. This is where the authorization decision runs, before
 * any use case: resolve the principal, ask Q1 (role → permission) and Q2
 * (binding), then call. Use cases assume the decision has already been made,
 * which is why they may not import `@counted/authorization`.
 *
 * `buildApi` is the seam a test uses. It takes ports and returns a Hono app,
 * so the whole surface — authorization, the readout fan-out, the ingest
 * acknowledgement contract — can be exercised over in-memory doubles with no
 * database and no clock that really ticks. `main.ts` is the only caller that
 * supplies real adapters, and the only file that knows a connection string
 * exists.
 */

import { CredentialId } from "@counted/kernel";
import type { DashboardId, MonitorId, ProjectId, WorkspaceId } from "@counted/kernel";
import type { GroupCommit } from "@counted/ingestion-app";
import type { IdGenerator } from "@counted/kernel/ports";
import type { Hono } from "hono";
import type { AuthorizeDeps } from "./auth/authorize";
import type { PlacementReader } from "./auth/placement";
import type { ApiDependencies } from "./deps";
import { createServer, type ApiEnv } from "./server";
import type { ReadinessProbe } from "./health";
import type { RecordBillingEventDeps } from "@counted/tenancy-app";

export type { ApiConfig, ConfigProblem, Environment, LogLevel } from "./config";
export { loadConfig } from "./config";
export type { ApiDependencies, A, Repositories } from "./deps";
export type { ApiContext, AuthorizedContext } from "./context";
export { jsonLogger, silentLogger, type Logger, type LogFields } from "./logging";
export { traceOf, TRACE_HEADER, TRACEPARENT_HEADER, type Trace } from "./tracing";
export {
  HEALTH_PATH,
  READY_PATH,
  alwaysReady,
  health,
  readyBody,
  type Health,
  type Readiness,
  type ReadinessProbe,
  type ServiceIdentity,
} from "./health";
export {
  AUTH_MOUNT,
  EVENTS_PATH,
  STRIPE_WEBHOOK_PATH,
  HAND_WRITTEN_PATHS,
  createServer,
  type ApiEnv,
  type ServerDeps,
} from "./server";
export { createRouter, type ApiRouter } from "./router";
export { authorize, type Authority, type AuthorizeDeps } from "./auth/authorize";
export { resolvePrincipal, bearerToken, type PrincipalDeps } from "./auth/principal";
export { locate, type PlacementReader } from "./auth/placement";
export { reachOf, roleCovering, type ReachDeps } from "./auth/reach";
export { derivedIngestQuota, type QuotaDeps } from "./ingest/quota";
export { handleIngest, ingestKeyOf, UNOWNED_WORKSPACE, type IngestDeps } from "./ingest/route";
export { clientAddress, DEFAULT_TRUSTED_PROXY_HOPS, FORWARDED_FOR } from "./ingest/client-ip";
export { handleStripeWebhook, type WebhookDeps } from "./billing/webhook";
export { ask, readProjectSchema, type Answer, type Question } from "./analysis/ask";
export { toAnalysis, fromAnalysis, toWindow, fromWindow } from "./analysis/wire";
export { eventsThisPeriod, monthToDate } from "./usage";
export * as faults from "./faults";
export * as serialize from "./serialize";

/**
 * The placement reader, over the repositories.
 *
 * Four one-line reads, and they exist as a port rather than as direct
 * repository calls so `auth/placement.ts` can be tested without a database and
 * so the "where does this resource sit" question has exactly one answer per
 * resource type. v1 derived ownership per route with a hand-written join, each
 * written slightly differently, one of which treated a NULL owner as
 * "everyone".
 */
export const placementReader = (deps: ApiDependencies): PlacementReader => ({
  workspaceExists: async (workspace: WorkspaceId) =>
    (await deps.reads.workspaces.find(workspace)) !== null,

  projectPlacement: async (project: ProjectId) => {
    const found = await deps.reads.projects.find(project);
    return found === null ? undefined : { workspace: found.workspace };
  },

  dashboardWorkspace: async (dashboard: DashboardId) =>
    (await deps.reads.dashboards.find(dashboard))?.workspace,

  monitorPlacement: async (monitor: MonitorId) => {
    const found = await deps.reads.monitors.find(monitor);
    return found === null ? undefined : { workspace: found.workspace, project: found.project };
  },
});

/**
 * Everything the authorization middleware needs, from the ports.
 *
 * The share resolver is here rather than in `auth/` because it spans two
 * contexts: the token is digested by `ShareTokens` and the dashboard found by
 * `DashboardRepository`, and the *projects* the link may query come from
 * `projectsReadBy` — the set a share grant's binding is derived from. A link
 * may run the queries the page it shows needs, and no others.
 */
export const authorizeDeps = (deps: ApiDependencies): AuthorizeDeps => ({
  credentials: deps.identity.credentials,
  memberships: deps.identity.memberships,
  session: deps.identity.http,
  placements: placementReader(deps),

  share: {
    resolve: async (token: string) => {
      const digest = await deps.shareTokens.digest(token);
      const dashboard = await deps.reads.dashboards.findByShareDigest(digest);
      if (dashboard === null) return null;

      // The aggregate re-checks that the grant it holds names itself. A
      // repository that resolved a digest with a query missing its dashboard
      // constraint would otherwise hand back a sibling, and nothing downstream
      // could notice.
      const allowed = dashboard.authorizeShareRead(digest, deps.clock.now());
      if (!allowed.ok) return null;

      return {
        // The digest *is* the credential a share link presents: there is no
        // stored key row behind it, so the hash names the principal.
        credential: CredentialId(digest),
        dashboard: dashboard.id,
        projects: await deps.reads.dashboards.projectsReadBy(dashboard.id),
      };
    },
  },

  reach: {
    workspacesFor: (account) => deps.reads.workspaces.listForAccount(account),
    workspaceName: async (workspace) => (await deps.reads.workspaces.find(workspace))?.name ?? null,
  },

  projectWorkspace: async (project: ProjectId) => {
    const found = await deps.reads.projects.find(project);
    return found === null ? undefined : found.workspace;
  },
});

/** The tenancy bundle the Stripe webhook needs. Null when billing is not configured. */
export const billingDeps = (deps: ApiDependencies): RecordBillingEventDeps | null =>
  deps.billing === null
    ? null
    : {
        billing: deps.billing,
        workspaces: deps.reads.workspaces,
        subscriptions: deps.reads.subscriptions,
        memberships: deps.identity.memberships,
        ledger: deps.reads.webhooks,
      };

/** How large a single ingest body may be before it is refused unread. */
export const MAX_INGEST_BODY_BYTES = 1_000_000;

export const buildApi = (
  deps: ApiDependencies,
  commit: GroupCommit,
  ids: IdGenerator,
  readiness?: ReadinessProbe,
): Hono<ApiEnv> => {
  const billing = billingDeps(deps);
  return createServer({
    deps,
    authorize: authorizeDeps(deps),
    ingest: {
      credentials: deps.identity.credentials,
      commit,
      projectWorkspace: async (project: ProjectId) => {
        const found = await deps.reads.projects.find(project);
        return found === null ? undefined : found.workspace;
      },
      logger: deps.logger,
      maxBodyBytes: MAX_INGEST_BODY_BYTES,
      geo: deps.geo,
      trustedProxyHops: deps.config.trustedProxyHops,
    },
    webhook: billing === null ? null : { billing, logger: deps.logger },
    mintTraceId: () => ids.next(),
    ...(readiness === undefined ? {} : { readiness }),
  });
};
