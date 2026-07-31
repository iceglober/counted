/**
 * The OpenAPI document, generated from the Zod schemas.
 *
 * Nothing here is hand-written prose about what the API does — the shapes come
 * from the same schemas the server validates with, so the document cannot
 * describe an endpoint that does not exist or omit one that does.
 *
 * `openapi.json` is a committed build artifact. CI regenerates it and fails on
 * any difference, which is what makes drift impossible rather than merely
 * discouraged.
 */

import { OpenApiGeneratorV31, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { ProblemSchema } from "./schemas/common";
import { OPERATIONS } from "./operations";
import { IngestReceiptSchema, IngestRequestSchema } from "./schemas/ingest";
import { QueryRequestSchema, QueryResponseSchema } from "./schemas/query";
import { LivenessSchema, PrincipalSchema, ReadinessSchema } from "./schemas/health";
import { RedeemSessionRequestSchema, SessionSchema, SignInRequestSchema } from "./schemas/auth";
import { DashboardDataResponseSchema } from "./schemas/query";
import {
  CreateDashboardRequestSchema,
  CreateProjectRequestSchema,
  CredentialListSchema,
  DashboardListSchema,
  DashboardViewSchema,
  IssueCredentialRequestSchema,
  IssuedCredentialSchema,
  MonitorListSchema,
  MonitorViewSchema,
  ProjectListSchema,
  ProjectViewSchema,
  RotateCredentialRequestSchema,
  UpdateDashboardRequestSchema,
  UpdateMonitorRequestSchema,
  UpdateProjectRequestSchema,
  UpdateWorkspaceRequestSchema,
  WorkspaceViewSchema,
  CreateShareRequestSchema,
  ShareGrantedSchema,
  CheckoutSessionRequestSchema,
  HostedSessionSchema,
  SubscriptionSchema,
  UsageSchema,
  WebhookAckSchema,
} from "./schemas/management";
import { z } from "./schemas/common";

const ProjectPathSchema = z.object({ projectId: z.string().uuid() });
const DashboardPathSchema = z.object({ dashboardId: z.string().uuid() });
const WorkspacePathSchema = z.object({ workspaceId: z.string().uuid() });
const MonitorPathSchema = z.object({ monitorId: z.string().uuid() });
const CredentialPathSchema = z.object({ projectId: z.string().uuid(), credentialId: z.string().uuid() });

export const OPENAPI_VERSION = "3.1.0";
export const API_VERSION = "0.1.0";

const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});

export const buildRegistry = (): OpenAPIRegistry => {
  const registry = new OpenAPIRegistry();

  const ingestKey = registry.registerComponent("securitySchemes", "ingestKey", {
    type: "apiKey",
    in: "header",
    name: "Project-Key",
    description: "A public ingest credential. Safe to embed; grants events:write and nothing else.",
  });
  const serviceKey = registry.registerComponent("securitySchemes", "serviceKey", {
    type: "http",
    scheme: "bearer",
    description: "A secret service credential, scoped to the operations it was issued for.",
  });

  registry.registerPath({
    method: "get",
    path: "/health",
    summary: "Liveness",
    description:
      "Is this process running? Never touches the database, so a database blip cannot cause a restart loop.",
    tags: ["health"],
    responses: { 200: { description: "Alive", ...json(LivenessSchema) } },
  });

  registry.registerPath({
    method: "get",
    path: "/health/ready",
    summary: "Readiness",
    description: "Can this instance serve traffic? Pings the store and reports what it verified at boot.",
    tags: ["health"],
    responses: {
      200: { description: "Ready", ...json(ReadinessSchema) },
      503: { description: "Not ready", ...json(ReadinessSchema) },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/auth/sign-in",
    summary: "Request a sign-in link",
    description:
      "Mails a single-use link. Answers 202 for any valid address whether or not an account exists — telling " +
      "the two apart would be an oracle for discovering who uses Counted. Signing up and signing in are one flow.",
    tags: ["auth"],
    request: { body: { content: json(SignInRequestSchema).content } },
    responses: {
      202: { description: "The link has been sent, if the address can receive mail." },
      422: problem("Not a valid email address"),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/auth/session",
    summary: "Redeem a sign-in link",
    description:
      "Spends the token once and sets an HttpOnly session cookie on the registrable domain, so the console " +
      "and the API share it. An unknown token and an expired one are refused identically.",
    tags: ["auth"],
    request: { body: { content: json(RedeemSessionRequestSchema).content } },
    responses: {
      200: { description: "Signed in", ...json(SessionSchema) },
      401: problem("The link is expired, spent, or was never issued"),
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/v1/auth/session",
    summary: "Sign out",
    description: "Ends this session and clears the cookie. Succeeds even if the session had already expired.",
    tags: ["auth"],
    responses: { 204: { description: "Signed out" } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/events",
    summary: "Ingest events",
    description:
      "Accepts up to 50 events. Resolves only after the batch is durably committed, so a 202 means the " +
      "data is written. Every event gets its own outcome, and the quota state is named rather than implied.",
    tags: ["ingest"],
    security: [{ [ingestKey.name]: [] }],
    request: { body: json(IngestRequestSchema) },
    responses: {
      202: { description: "Committed", ...json(IngestReceiptSchema) },
      400: problem("The batch could not be read"),
      401: problem("Missing or unknown credential"),
      403: problem("The credential may not write events"),
      413: problem("Payload too large"),
      429: problem("Rate limited; see Retry-After"),
      503: problem("The store is unavailable; retry"),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/projects/{projectId}/query",
    summary: "Run an analysis",
    description:
      "Answers one question — an analysis, a funnel or a retention grid. The response is tagged with its shape; the caller never has to infer it.",
    tags: ["read"],
    security: [{ [serviceKey.name]: [] }],
    request: {
      params: ProjectPathSchema,
      body: json(QueryRequestSchema),
    },
    responses: {
      200: { description: "The answer", ...json(QueryResponseSchema) },
      400: problem("The analysis is not well formed"),
      401: problem("Missing or unknown credential"),
      403: problem("The credential may not read this project"),
      504: problem("The query exceeded its budget"),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/dashboards/{dashboardId}/data",
    summary: "Render a dashboard",
    description:
      "Answers every tile on a dashboard in one batch. A tile that fails comes back as a failed readout rather than as an empty one, so a broken query is distinguishable from a project with no events.",
    tags: ["read"],
    security: [{ [serviceKey.name]: [] }],
    request: { params: DashboardPathSchema },
    responses: {
      200: { description: "One readout per tile", ...json(DashboardDataResponseSchema) },
      401: problem("Missing or unknown credential"),
      403: problem("The credential may not read this dashboard"),
      404: problem("No such dashboard"),
      503: problem("The store is unavailable"),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/me",
    summary: "Describe the caller",
    description:
      "Reports who the credential belongs to and which scopes it carries, so a 403 can be diagnosed without guesswork. An anonymous caller is told it is anonymous rather than refused.",
    tags: ["read"],
    responses: {
      200: { description: "The caller", ...json(PrincipalSchema) },
    },
  });

  // ── Management ─────────────────────────────────────────────────────────
  //
  // Every representation here comes from `schemas/management.ts`, whose types
  // have no field a secret could occupy. The two endpoints that can disclose a
  // secret both return `IssuedCredential`, and both say so in their summary.

  const managed = (
    method: "get" | "post" | "patch" | "delete",
    path: string,
    summary: string,
    options: {
      params?: z.AnyZodObject;
      body?: z.ZodTypeAny;
      ok?: { status: number; description: string; schema?: z.ZodTypeAny };
      description?: string;
    },
  ) =>
    registry.registerPath({
      method,
      path,
      summary,
      ...(options.description === undefined ? {} : { description: options.description }),
      tags: ["manage"],
      security: [{ [serviceKey.name]: [] }],
      request: {
        ...(options.params === undefined ? {} : { params: options.params }),
        ...(options.body === undefined ? {} : { body: json(options.body) }),
      },
      responses: {
        [options.ok?.status ?? 200]:
          options.ok?.schema === undefined
            ? { description: options.ok?.description ?? "Done" }
            : { description: options.ok.description, ...json(options.ok.schema) },
        401: problem("Missing or unknown credential"),
        403: problem("The credential lacks the required scope"),
        404: problem("No such resource, or it is not yours"),
      },
    });

  managed("get", "/v1/workspaces/{workspaceId}", "Read a workspace", {
    params: WorkspacePathSchema,
    ok: { status: 200, description: "The workspace", schema: WorkspaceViewSchema },
  });
  managed("patch", "/v1/workspaces/{workspaceId}", "Rename a workspace", {
    params: WorkspacePathSchema,
    body: UpdateWorkspaceRequestSchema,
    ok: { status: 200, description: "The workspace", schema: WorkspaceViewSchema },
  });

  managed("get", "/v1/workspaces/{workspaceId}/projects", "List projects", {
    params: WorkspacePathSchema,
    description:
      "Metadata only. Credentials appear as prefixes and scopes; no secret, digest or claim token is ever included.",
    ok: { status: 200, description: "The workspace's projects", schema: ProjectListSchema },
  });
  managed("post", "/v1/workspaces/{workspaceId}/projects", "Create a project", {
    params: WorkspacePathSchema,
    body: CreateProjectRequestSchema,
    description: "Returns the project and its first ingest credential. The secret is shown exactly once.",
    ok: { status: 201, description: "The project and its first credential", schema: IssuedCredentialSchema },
  });
  managed("get", "/v1/projects/{projectId}", "Read a project", {
    params: ProjectPathSchema,
    ok: { status: 200, description: "The project", schema: ProjectViewSchema },
  });
  managed("patch", "/v1/projects/{projectId}", "Rename a project", {
    params: ProjectPathSchema,
    body: UpdateProjectRequestSchema,
    ok: { status: 200, description: "The project", schema: ProjectViewSchema },
  });

  managed("get", "/v1/projects/{projectId}/credentials", "List credentials", {
    params: ProjectPathSchema,
    description: "Metadata only — prefix, scopes and status. A secret is never retrievable after it is issued.",
    ok: { status: 200, description: "The project's credentials", schema: CredentialListSchema },
  });
  managed("post", "/v1/projects/{projectId}/credentials", "Issue a credential", {
    params: ProjectPathSchema,
    body: IssueCredentialRequestSchema,
    description: "The secret is returned once, here, and never again.",
    ok: { status: 201, description: "The credential and its secret", schema: IssuedCredentialSchema },
  });
  managed("post", "/v1/projects/{projectId}/credentials/{credentialId}/rotate", "Rotate a credential", {
    params: CredentialPathSchema,
    body: RotateCredentialRequestSchema,
    description:
      "Issues a replacement while the old secret keeps working for the overlap window, so deployed clients are not broken at the instant of the click.",
    ok: { status: 201, description: "The new credential and its secret", schema: IssuedCredentialSchema },
  });
  managed("delete", "/v1/projects/{projectId}/credentials/{credentialId}", "Revoke a credential", {
    params: CredentialPathSchema,
    ok: { status: 204, description: "Revoked" },
  });

  managed("get", "/v1/workspaces/{workspaceId}/dashboards", "List dashboards", {
    params: WorkspacePathSchema,
    ok: { status: 200, description: "The workspace's dashboards", schema: DashboardListSchema },
  });
  managed("post", "/v1/workspaces/{workspaceId}/dashboards", "Create a dashboard", {
    params: WorkspacePathSchema,
    body: CreateDashboardRequestSchema,
    description: "Created empty. Tiles are added deliberately rather than guessed at.",
    ok: { status: 201, description: "The dashboard", schema: DashboardViewSchema },
  });
  managed("get", "/v1/dashboards/{dashboardId}", "Read a dashboard", {
    params: DashboardPathSchema,
    ok: { status: 200, description: "The dashboard", schema: DashboardViewSchema },
  });
  managed("patch", "/v1/dashboards/{dashboardId}", "Rename a dashboard", {
    params: DashboardPathSchema,
    body: UpdateDashboardRequestSchema,
    ok: { status: 200, description: "The dashboard", schema: DashboardViewSchema },
  });
  managed("delete", "/v1/dashboards/{dashboardId}", "Delete a dashboard", {
    params: DashboardPathSchema,
    ok: { status: 204, description: "Deleted" },
  });

  managed("get", "/v1/projects/{projectId}/monitors", "List monitors", {
    params: ProjectPathSchema,
    description: "Delivery targets are reduced to a host or a masked address; a webhook URL can carry a token.",
    ok: { status: 200, description: "The project's monitors", schema: MonitorListSchema },
  });
  managed("get", "/v1/monitors/{monitorId}", "Read a monitor", {
    params: MonitorPathSchema,
    ok: { status: 200, description: "The monitor", schema: MonitorViewSchema },
  });
  managed("patch", "/v1/monitors/{monitorId}", "Enable or disable a monitor", {
    params: MonitorPathSchema,
    body: UpdateMonitorRequestSchema,
    ok: { status: 200, description: "The monitor", schema: MonitorViewSchema },
  });

  // ── Shares ─────────────────────────────────────────────────────────────
  //
  // A share link is a real credential: prefixed, hashed, expiring, revocable,
  // and scoped to reading one dashboard. The two `/v1/shared` endpoints take
  // no id — the token is the dashboard, so a link cannot name another one.

  const shareToken = registry.registerComponent("securitySchemes", "shareToken", {
    type: "http",
    scheme: "bearer",
    description:
      "A share link token (st_…). Read-only, bound to one dashboard and the projects its tiles read, and expiring.",
  });

  managed("post", "/v1/dashboards/{dashboardId}/share", "Mint a share link", {
    params: DashboardPathSchema,
    body: CreateShareRequestSchema,
    description:
      "Returns the token exactly once. Minting a second link revokes the first, so this is also how a link is rotated.",
    ok: { status: 201, description: "The link and its expiry", schema: ShareGrantedSchema },
  });
  managed("delete", "/v1/dashboards/{dashboardId}/share", "Revoke a share link", {
    params: DashboardPathSchema,
    description: "Immediate. Revoking a dashboard that is not shared is not an error.",
    ok: { status: 204, description: "Revoked" },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/shared/dashboard",
    summary: "Read the shared dashboard",
    description:
      "What the presented share link points at. Responses carry X-Robots-Tag: noindex, nofollow, noarchive.",
    tags: ["share"],
    security: [{ [shareToken.name]: [] }],
    responses: {
      200: { description: "The dashboard", ...json(DashboardViewSchema) },
      401: problem("The link is unknown, revoked or expired"),
      404: problem("The dashboard no longer exists"),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/shared/dashboard/render",
    summary: "Render the shared dashboard",
    description:
      "Answers every tile in one batch, exactly as the owned render does. Responses carry X-Robots-Tag: noindex, nofollow, noarchive.",
    tags: ["share"],
    security: [{ [shareToken.name]: [] }],
    responses: {
      200: { description: "One readout per tile", ...json(DashboardDataResponseSchema) },
      401: problem("The link is unknown, revoked or expired"),
      404: problem("The dashboard no longer exists"),
    },
  });

  // ── Billing ────────────────────────────────────────────────────────────
  //
  // Stripe reports payment state; the domain decides what that entitles a
  // workspace to. Nothing here returns a customer id — only whether one exists.

  managed("get", "/v1/workspaces/{workspaceId}/usage", "Read usage against the allowance", {
    params: WorkspacePathSchema,
    description: "The same count the ingest path enforces on, so the bar cannot disagree with a rejection.",
    ok: { status: 200, description: "Usage this period", schema: UsageSchema },
  });
  managed("get", "/v1/workspaces/{workspaceId}/subscription", "Read the subscription", {
    params: WorkspacePathSchema,
    description:
      "A workspace with no subscription reads as free rather than erroring. `inGrace` is true when a paid plan is being honoured despite a payment problem.",
    ok: { status: 200, description: "The subscription", schema: SubscriptionSchema },
  });
  managed("post", "/v1/workspaces/{workspaceId}/billing/checkout-sessions", "Open checkout", {
    params: WorkspacePathSchema,
    body: CheckoutSessionRequestSchema,
    ok: { status: 201, description: "Where to send the browser", schema: HostedSessionSchema },
  });
  managed("post", "/v1/workspaces/{workspaceId}/billing/portal-sessions", "Open the billing portal", {
    params: WorkspacePathSchema,
    description:
      "Refused with billing.no_account when the workspace has never been to checkout. The provider returns the browser to a page that renders rather than one that redirects.",
    ok: { status: 201, description: "Where to send the browser", schema: HostedSessionSchema },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/webhooks/stripe",
    summary: "Stripe webhook",
    description:
      "Authenticated by HMAC signature over the raw body with a five-minute window, not by a credential. Deduplicated by event id: a replay is acknowledged and changes nothing. An event we do not act on is acknowledged rather than retried.",
    tags: ["billing"],
    responses: {
      200: { description: "Received", ...json(WebhookAckSchema) },
      400: problem("The signature did not verify, or the body is malformed"),
    },
  });

  return registry;
};

/**
 * Stamp the operation names on, and check both lists at once.
 *
 * Done here rather than on each `registerPath` so the whole vocabulary lives
 * in one readable table — and so that a path with no name, or a name for a
 * path that no longer exists, is a build failure rather than a client method
 * that silently vanished.
 */
const applyOperationIds = (document: OpenApiDocument): OpenApiDocument => {
  const unnamed: string[] = [];
  const seen = new Set<string>();
  const duplicated: string[] = [];
  const covered = new Set<string>();

  for (const [path, operations] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!HTTP_METHODS.has(method)) continue;
      const key = `${method.toUpperCase()} ${path}`;
      const spec = OPERATIONS[key];
      if (spec === undefined) {
        unnamed.push(key);
        continue;
      }
      covered.add(key);
      if (seen.has(spec.operationId)) duplicated.push(spec.operationId);
      seen.add(spec.operationId);

      const target = operation as Record<string, unknown>;
      target["operationId"] = spec.operationId;
      // Carried into the document so a generated client can derive its cache
      // keys from the contract rather than from a map somebody maintains.
      if (spec.provides !== undefined) target["x-counted-provides"] = spec.provides;
      if (spec.invalidates !== undefined) target["x-counted-invalidates"] = spec.invalidates;
    }
  }

  const orphaned = Object.keys(OPERATIONS).filter((key) => !covered.has(key));
  const problems = [
    unnamed.length > 0 ? `no operationId declared for: ${unnamed.join(", ")}` : "",
    orphaned.length > 0 ? `declared for a path that does not exist: ${orphaned.join(", ")}` : "",
    duplicated.length > 0 ? `duplicate operationId: ${duplicated.join(", ")}` : "",
  ].filter((line) => line.length > 0);

  if (problems.length > 0) throw new Error(`operation table is out of step:\n  ${problems.join("\n  ")}`);
  return document;
};

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

type OpenApiDocument = { paths?: Record<string, Record<string, unknown>> };

export const buildOpenApiDocument = (): object =>
  applyOperationIds(new OpenApiGeneratorV31(buildRegistry().definitions).generateDocument({
    openapi: OPENAPI_VERSION,
    info: {
      title: "Counted API",
      version: API_VERSION,
      description:
        "Privacy-first product analytics. No cookies, no fingerprinting, no PII. " +
        "Identity is optional and always supplied by the caller.",
    },
    servers: [{ url: "https://api.counted.dev" }],
    tags: [
      { name: "health", description: "Liveness and readiness" },
      { name: "ingest", description: "Writing events" },
      { name: "read", description: "Asking questions" },
      { name: "auth", description: "Signing in to the console" },
    ],
  }) as unknown as OpenApiDocument);
