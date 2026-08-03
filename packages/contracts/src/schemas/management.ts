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

// ── Shares ───────────────────────────────────────────────────────────────────

/**
 * Minting a share link.
 *
 * An expiry is mandatory in the sense that there is always one: the default
 * applies when the caller says nothing, and there is no value meaning "never".
 * v1's share tokens did not expire at all.
 */
export const CreateShareRequestSchema = z
  .object({
    expiresInHours: z.number().int().positive().max(24 * 365).default(24 * 30),
  })
  .openapi("CreateShareRequest");

export const ShareGrantedSchema = z
  .object({
    /** Shown exactly once. Only its digest is stored. */
    token: z.string().openapi({ description: "Shown exactly once and never retrievable." }),
    expiresAt: InstantSchema,
    dashboard: DashboardViewSchema,
  })
  .openapi("ShareGranted");

// ── Billing ──────────────────────────────────────────────────────────────────

export const CheckoutSessionRequestSchema = z
  .object({ cadence: z.enum(["monthly", "annual"]).default("monthly") })
  .openapi("CheckoutSessionRequest");

export const HostedSessionSchema = z
  .object({ url: z.string().openapi({ description: "Where to send the browser. Short-lived." }) })
  .openapi("HostedSession");

export const UsageSchema = z
  .object({
    events: z.object({
      used: z.number().int(),
      limit: z.number().int().nullable(),
      /** Named rather than implied — `overage` is stored-but-past-allowance. */
      state: z.enum(["ok", "overage", "rejected"]),
    }),
    projects: z.object({ used: z.number().int(), limit: z.number().int().nullable() }),
    plan: z.enum(["free", "pro"]),
    inGrace: z.boolean(),
  })
  .openapi("Usage");

export const SubscriptionSchema = z
  .object({
    plan: z.enum(["free", "pro"]),
    paymentState: z.enum(["none", "active", "past_due", "canceled"]),
    /** A paid plan honoured despite a payment problem. */
    inGrace: z.boolean(),
    renewsAt: InstantSchema.nullable(),
    limits: z.object({
      eventsPerMonth: z.number().int().nullable(),
      projects: z.number().int().nullable(),
      seats: z.number().int().nullable(),
      retentionDays: z.number().int().nullable(),
    }),
    /** Whether a portal session can be opened. Never the customer id. */
    hasBillingAccount: z.boolean(),
  })
  .openapi("Subscription");

export const WebhookAckSchema = z
  .object({
    received: z.literal(true),
    applied: z.boolean(),
    reason: z.string().optional(),
    entitlementChanged: z.boolean().optional(),
  })
  .openapi("WebhookAck");

/**
 * Starting from nothing.
 *
 * The name is optional but the field is not hidden: a caller that knows what
 * it is building says so at creation, and there is no second "rename it later"
 * step that most people never take. v1 created "My Project" and asked
 * afterwards, so every list read the same.
 */
export const ProvisionRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
  })
  .openapi("ProvisionRequest");

export const ProvisionResponseSchema = z
  .object({
    project: z.object({ id: z.string(), name: z.string(), state: z.literal("unclaimed") }),
    /** Disclosed once. Only its digest is stored. */
    ingestKey: z.string(),
    claimUrl: z.string(),
    claimExpiresAt: z.string().datetime(),
    /** Ready to paste. Built server-side so an agent and a human get the same one. */
    snippet: z.string(),
    docsUrl: z.string(),
  })
  .openapi("ProvisionResponse");

export const ClaimPreviewSchema = z
  .object({
    project: z.object({ id: z.string(), name: z.string() }),
    expiresAt: z.string().datetime().nullable(),
  })
  .openapi("ClaimPreview");

export const RedeemClaimRequestSchema = z
  .object({
    /** Which workspace to adopt into. Absent means the caller's first, or a new one. */
    workspaceId: z.string().optional(),
    /** Names the workspace when one is being opened. */
    workspaceName: z.string().trim().min(1).max(120).optional(),
    /**
     * Renames the project being adopted.
     *
     * Provision suggests a name because it has to call the project something,
     * and the claim page offers it as a placeholder — so the person taking
     * ownership can name the thing at the moment they take it. Carried on the
     * redeem rather than left to a follow-up PATCH: two calls can half-fail,
     * and the half that fails would leave somebody owning a project named
     * something they just declined.
     */
    projectName: z.string().trim().min(1).max(100).optional(),
  })
  .openapi("RedeemClaimRequest");

export const RedeemClaimResponseSchema = z
  .object({
    workspace: z.object({ id: z.string() }),
    project: z.object({ id: z.string(), name: z.string(), state: z.literal("claimed") }),
  })
  .openapi("RedeemClaimResponse");
