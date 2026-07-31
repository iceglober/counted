/**
 * What management endpoints return.
 *
 * These schemas exist to make a specific bug unrepresentable. v1's
 * `GET /projects` returned `SELECT *` — the whole row, including `serverKey`,
 * `apiKey` and `claimToken` — to any member of the workspace. A read endpoint
 * handed out write credentials, and nothing in the code said it should not.
 *
 * Here **there is no field a secret could occupy**. A credential's
 * representation carries its display prefix and its scopes; the digest is not
 * in the type, so leaking it is a compile error rather than an oversight. The
 * one schema that names a secret is `IssuedCredential`, returned only from
 * issue and rotate, and only once.
 *
 * A `claimToken` is likewise absent everywhere. Claiming is its own endpoint
 * with its own single-use grant; a list of projects is not the place to
 * discover how to adopt one.
 */

import { InstantSchema, z } from "./common";

// ── Credentials ──────────────────────────────────────────────────────────────

export const ScopeSchema = z.enum([
  "events:write",
  "events:read",
  "queries:run",
  "projects:read",
  "projects:write",
  "projects:delete",
  "dashboards:read",
  "dashboards:write",
  "monitors:read",
  "monitors:write",
  "credentials:read",
  "credentials:write",
  "workspace:read",
  "workspace:admin",
  "billing:read",
  "billing:write",
]);

/**
 * A credential, as anyone other than its creator ever sees it.
 *
 * Enough to tell two keys apart in a list, decide which to revoke, and see
 * what it may do. Not enough to authenticate with.
 */
export const CredentialViewSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["ingest", "service"]),
    label: z.string(),
    /** The display stub — `ck_aBc123`. Around 36 bits. Useless for guessing. */
    prefix: z.string(),
    scopes: z.array(ScopeSchema),
    issuedAt: InstantSchema,
    /** Set while a rotation's grace window is open. */
    expiresAt: InstantSchema.nullable(),
    revokedAt: InstantSchema.nullable(),
    /** Derived, so a client does not reimplement the three-way rule. */
    status: z.enum(["active", "expiring", "revoked", "expired"]),
  })
  .openapi("Credential");

/**
 * The one shape that carries a secret, returned only at issue and rotation.
 *
 * Named separately from `Credential` on purpose: a reader can see at a glance
 * which endpoints can possibly disclose one, and the type system agrees.
 */
export const IssuedCredentialSchema = z
  .object({
    credential: CredentialViewSchema,
    /** Shown exactly once. Only its digest is stored. */
    secret: z.string().openapi({
      description: "Shown exactly once and never retrievable. Store it now.",
    }),
  })
  .openapi("IssuedCredential");

export const IssueCredentialRequestSchema = z
  .object({
    kind: z.enum(["ingest", "service"]),
    label: z.string().min(1).max(100),
    /** Ignored for ingest keys, which carry events:write and nothing else. */
    scopes: z.array(ScopeSchema).optional(),
  })
  .openapi("IssueCredentialRequest");

export const RotateCredentialRequestSchema = z
  .object({
    label: z.string().min(1).max(100),
    /**
     * How long the old secret keeps working. Rotation without an overlap
     * breaks every deployed client the instant someone clicks the button,
     * which is what v1 did by overwriting in place.
     */
    overlapHours: z.number().int().min(0).max(720).default(24),
  })
  .openapi("RotateCredentialRequest");

// ── Projects ─────────────────────────────────────────────────────────────────

export const ProjectViewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** Null while unclaimed. Claiming is its own endpoint. */
    workspaceId: z.string().nullable(),
    state: z.enum(["unclaimed", "claimed"]),
    credentials: z.array(CredentialViewSchema),
  })
  .openapi("Project");

export const CreateProjectRequestSchema = z
  .object({
    /** Required at creation. v1 created projects named "My Project" and left
     *  renaming to a settings page most people never opened. */
    name: z.string().min(1).max(100),
  })
  .openapi("CreateProjectRequest");

export const UpdateProjectRequestSchema = z
  .object({ name: z.string().min(1).max(100) })
  .openapi("UpdateProjectRequest");

// ── Workspaces ───────────────────────────────────────────────────────────────

export const MemberViewSchema = z
  .object({
    accountId: z.string(),
    role: z.enum(["owner", "admin", "member"]),
    since: InstantSchema,
  })
  .openapi("Member");

export const WorkspaceViewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    members: z.array(MemberViewSchema),
    projects: z.array(
      z.object({ id: z.string(), name: z.string(), state: z.enum(["active", "archived"]) }),
    ),
    limits: z.object({
      maxProjects: z.number().int().nullable(),
      maxSeats: z.number().int().nullable(),
    }),
  })
  .openapi("Workspace");

export const UpdateWorkspaceRequestSchema = z
  .object({ name: z.string().min(1).max(100) })
  .openapi("UpdateWorkspaceRequest");

// ── Dashboards ───────────────────────────────────────────────────────────────

export const TileViewSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    /** Required. Never inherited — v1 made it optional on an insight and
     *  `dashboard.projectId ?? ""` then reached a uuid parameter. */
    projectId: z.string(),
    /** Twelfths of a row. The one width vocabulary. */
    width: z.number().int().min(1).max(12),
    content: z.unknown(),
  })
  .openapi("Tile");

export const DashboardViewSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string(),
    isDefault: z.boolean(),
    tiles: z.array(TileViewSchema),
    /**
     * Whether a share link exists, and when it lapses. Never the token —
     * anyone who can read the dashboard would otherwise be handed a URL that
     * works without logging in.
     */
    share: z.object({ active: z.boolean(), expiresAt: InstantSchema.nullable() }),
  })
  .openapi("Dashboard");

export const CreateDashboardRequestSchema = z
  .object({
    name: z.string().min(1).max(100),
    isDefault: z.boolean().optional(),
  })
  .openapi("CreateDashboardRequest");

export const UpdateDashboardRequestSchema = z
  .object({ name: z.string().min(1).max(100) })
  .openapi("UpdateDashboardRequest");

// ── Monitors ─────────────────────────────────────────────────────────────────

export const MonitorViewSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    analysis: z.unknown(),
    threshold: z.unknown(),
    cooldownMs: z.number().int(),
    /**
     * Delivery targets with their secrets removed: a webhook's URL can carry a
     * token in its path, and an email address is personal data.
     */
    channels: z.array(z.object({ kind: z.enum(["email", "webhook"]), target: z.string() })),
    enabled: z.boolean(),
    state: z.enum(["ok", "breaching"]),
    lastNotifiedAt: InstantSchema.nullable(),
    lastValue: z.number().nullable(),
  })
  .openapi("Monitor");

export const UpdateMonitorRequestSchema = z
  .object({ enabled: z.boolean() })
  .openapi("UpdateMonitorRequest");

// ── Collections ──────────────────────────────────────────────────────────────

/**
 * One envelope for every list. v1 returned bare arrays from some endpoints and
 * `{data, meta}` from others, so a client could not write one helper.
 */
export const listOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });

export const ProjectListSchema = listOf(ProjectViewSchema).openapi("ProjectList");
export const CredentialListSchema = listOf(CredentialViewSchema).openapi("CredentialList");
export const DashboardListSchema = listOf(DashboardViewSchema).openapi("DashboardList");
export const MonitorListSchema = listOf(MonitorViewSchema).openapi("MonitorList");
