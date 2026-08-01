/**
 * The name of every operation, and the cache tags it touches.
 *
 * An `operationId` is what a generated client calls its methods, so these
 * names are public API — changing one renames a method for every consumer.
 * They live in one table rather than beside each `registerPath` call so that
 * the whole vocabulary can be read at once, and so a duplicate is obvious.
 *
 * **Both directions are checked.** A path with no entry here and an entry for
 * a path that no longer exists are both build failures. That is the point: a
 * table beside a route list is exactly the shape that goes stale, and the way
 * it goes stale is a client method that silently disappears.
 *
 * ## Tags
 *
 * `invalidates` is the other half. The design requires cache invalidation to
 * be *derived from the contract* rather than hand-maintained in the web app —
 * so `PATCH /v1/dashboards/{id}` declares here that it invalidates that
 * dashboard and the list it appears in, and the client wires it up without the
 * app naming a key. A hand-written key map in the UI is a third list, and it
 * would drift from these two.
 *
 * A tag is a template: `{param}` is substituted from the request's own path
 * parameters, so `dashboard:{dashboardId}` becomes `dashboard:d_123`.
 */

export type OperationSpec = {
  readonly operationId: string;
  /** Cache tags this response *is*. Reads only. */
  readonly provides?: readonly string[];
  /** Cache tags this operation makes stale. Writes only. */
  readonly invalidates?: readonly string[];
};

/** Keyed by `METHOD path`, exactly as the OpenAPI document spells them. */
export const OPERATIONS: Readonly<Record<string, OperationSpec>> = {
  "GET /health": { operationId: "getLiveness" },
  "GET /health/ready": { operationId: "getReadiness" },
  "GET /v1/openapi.json": { operationId: "getOpenApiDocument" },
  "GET /.well-known/oauth-protected-resource": { operationId: "getProtectedResourceMetadata" },

  "POST /v1/auth/sign-in": { operationId: "requestSignInLink" },
  "POST /v1/auth/session": { operationId: "createSession", invalidates: ["me"] },
  "DELETE /v1/auth/session": { operationId: "endSession", invalidates: ["me"] },

  "GET /v1/me": { operationId: "describeCaller", provides: ["me"] },

  "POST /v1/provision": { operationId: "provisionProject" },
  "GET /v1/claims/{token}": { operationId: "previewClaim" },
  // Adopting a project changes which workspaces exist and what is in them.
  "POST /v1/claims/{token}/redeem": { operationId: "redeemClaim", invalidates: ["me", "projects"] },

  "POST /v1/events": { operationId: "ingestEvents" },

  "GET /v1/workspaces/{workspaceId}": {
    operationId: "getWorkspace",
    provides: ["workspace:{workspaceId}"],
  },
  "PATCH /v1/workspaces/{workspaceId}": {
    operationId: "updateWorkspace",
    invalidates: ["workspace:{workspaceId}"],
  },
  "GET /v1/workspaces/{workspaceId}/projects": {
    operationId: "listProjects",
    provides: ["projects:{workspaceId}"],
  },
  "POST /v1/workspaces/{workspaceId}/projects": {
    operationId: "createProject",
    invalidates: ["projects:{workspaceId}"],
  },
  "GET /v1/workspaces/{workspaceId}/dashboards": {
    operationId: "listDashboards",
    provides: ["dashboards:{workspaceId}"],
  },
  "POST /v1/workspaces/{workspaceId}/dashboards": {
    operationId: "createDashboard",
    invalidates: ["dashboards:{workspaceId}"],
  },
  "GET /v1/workspaces/{workspaceId}/subscription": {
    operationId: "getSubscription",
    provides: ["subscription:{workspaceId}"],
  },
  "GET /v1/workspaces/{workspaceId}/usage": {
    operationId: "getUsage",
    provides: ["usage:{workspaceId}"],
  },
  "POST /v1/workspaces/{workspaceId}/billing/checkout-sessions": {
    operationId: "createCheckoutSession",
  },
  "POST /v1/workspaces/{workspaceId}/billing/portal-sessions": {
    operationId: "createPortalSession",
  },

  "GET /v1/projects/{projectId}": { operationId: "getProject", provides: ["project:{projectId}"] },
  "PATCH /v1/projects/{projectId}": {
    operationId: "updateProject",
    // The list too: a rename changes what the list shows.
    invalidates: ["project:{projectId}", "projects"],
  },
  "POST /v1/projects/{projectId}/query": { operationId: "runQuery" },
  "GET /v1/projects/{projectId}/credentials": {
    operationId: "listCredentials",
    provides: ["credentials:{projectId}"],
  },
  "POST /v1/projects/{projectId}/credentials": {
    operationId: "issueCredential",
    invalidates: ["credentials:{projectId}"],
  },
  "DELETE /v1/projects/{projectId}/credentials/{credentialId}": {
    operationId: "revokeCredential",
    invalidates: ["credentials:{projectId}"],
  },
  "POST /v1/projects/{projectId}/credentials/{credentialId}/rotate": {
    operationId: "rotateCredential",
    invalidates: ["credentials:{projectId}"],
  },
  "GET /v1/projects/{projectId}/monitors": {
    operationId: "listMonitors",
    provides: ["monitors:{projectId}"],
  },

  "GET /v1/dashboards/{dashboardId}": {
    operationId: "getDashboard",
    provides: ["dashboard:{dashboardId}"],
  },
  "PATCH /v1/dashboards/{dashboardId}": {
    operationId: "updateDashboard",
    invalidates: ["dashboard:{dashboardId}", "dashboards"],
  },
  "DELETE /v1/dashboards/{dashboardId}": {
    operationId: "deleteDashboard",
    invalidates: ["dashboard:{dashboardId}", "dashboards"],
  },
  "POST /v1/dashboards/{dashboardId}/data": { operationId: "renderDashboard" },
  "POST /v1/dashboards/{dashboardId}/share": {
    operationId: "createShareLink",
    invalidates: ["dashboard:{dashboardId}"],
  },
  "DELETE /v1/dashboards/{dashboardId}/share": {
    operationId: "revokeShareLink",
    invalidates: ["dashboard:{dashboardId}"],
  },

  "GET /v1/monitors/{monitorId}": { operationId: "getMonitor", provides: ["monitor:{monitorId}"] },
  "PATCH /v1/monitors/{monitorId}": {
    operationId: "updateMonitor",
    invalidates: ["monitor:{monitorId}", "monitors"],
  },

  "GET /v1/shared/dashboard": { operationId: "getSharedDashboard" },
  "POST /v1/shared/dashboard/render": { operationId: "renderSharedDashboard" },

  "POST /v1/webhooks/stripe": { operationId: "receiveStripeWebhook" },

  // The compatibility edge. Named like everything else so the operation table
  // stays exhaustive — the generator fails on a path with no entry.
  "POST /api/v0/event": { operationId: "ingestAptabaseEvent" },
  "POST /api/v0/events": { operationId: "ingestAptabaseEvents" },
  "GET /api/v0/events-list": { operationId: "goneEventsList" },
  "POST /api/v0/events-list": { operationId: "goneEventsListPost" },
  "GET /api/v0/dashboard-data": { operationId: "goneDashboardData" },
  "POST /api/v0/dashboard-data": { operationId: "goneDashboardDataPost" },
  "GET /api/v0/query": { operationId: "goneQuery" },
  "POST /api/v0/query": { operationId: "goneQueryPost" },
  "GET /api/v0/usage": { operationId: "goneUsage" },
  "POST /api/v0/usage": { operationId: "goneUsagePost" },
  "GET /api/v0/projects": { operationId: "goneProjects" },
  "POST /api/v0/projects": { operationId: "goneProjectsPost" },
  "GET /api/v0/dashboards": { operationId: "goneDashboards" },
  "POST /api/v0/dashboards": { operationId: "goneDashboardsPost" },
  "GET /api/v0/alerts": { operationId: "goneAlerts" },
  "POST /api/v0/alerts": { operationId: "goneAlertsPost" },
  "GET /api/v0/provision": { operationId: "goneProvisionV0" },
  "POST /api/v0/provision": { operationId: "goneProvisionV0Post" },
};

/** Fill `{param}` placeholders in a tag from a request's path parameters. */
export const resolveTag = (template: string, params: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? `{${name}}`);
