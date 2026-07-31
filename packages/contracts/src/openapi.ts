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
import { IngestReceiptSchema, IngestRequestSchema } from "./schemas/ingest";
import { QueryRequestSchema, QueryResponseSchema } from "./schemas/query";
import { LivenessSchema, PrincipalSchema, ReadinessSchema } from "./schemas/health";
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

  return registry;
};

export const buildOpenApiDocument = (): object =>
  new OpenApiGeneratorV31(buildRegistry().definitions).generateDocument({
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
    ],
  });
