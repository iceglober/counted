/**
 * V3-SPEC §6's mapping table, as data.
 *
 * Three rules from that table hold everywhere in this file:
 *
 *   1. `.errors({...})` keys come from oRPC's closed 22-code vocabulary.
 *      `TOO_MANY_TILES` is a type error, not a code. The domain error's name
 *      travels in `data.reason`.
 *   2. `ErrorMapItem` is `{ message?, data? }` — there is no `status` field.
 *      The status is implied by the code, and a declared error appears in the
 *      generated document at that status with `data` fully expanded.
 *   3. Every `data` is discriminated by `reason`, whose literal is exactly the
 *      domain error's `kind`. Where several kinds share a code, `reason` is a
 *      union of literals and the code is declared once.
 *
 * `errorMap()` folds the authorization failures into every declaration rather
 * than leaving each route to remember them. That is not tidiness: oRPC merges
 * error maps with the later definition winning, so a route that declared its
 * own `FORBIDDEN` for `PermissionEscalation` would have *replaced* a shared
 * `FORBIDDEN` carrying `NotPermitted` — and the document would then claim a 403
 * can only ever mean escalation. Folding at construction makes that
 * unrepresentable.
 */

import * as z from "zod";
import {
  AccountIdSchema,
  CredentialIdSchema,
  DashboardIdSchema,
  DurationMsSchema,
  PermissionSchema,
  ProjectIdSchema,
  RoleSchema,
  TileIdSchema,
  WorkspaceIdSchema,
} from "./primitives";

/** One domain error kind, as it appears inside an error response's `data`. */
const reason = <K extends string, S extends z.ZodRawShape>(kind: K, shape: S) =>
  z.object({ reason: z.literal(kind), ...shape });

// ---------------------------------------------------------------------------
// Identity and authorization (V3-SPEC §6, "Identity and authorization")
//
// `Unknown`, `Revoked` and `Expired` credentials have no entry, deliberately.
// They collapse into an anonymous principal before any procedure sees them and
// the caller gets a bare 401. Telling an attacker which of their guesses exists
// is the thing that collapse prevents.
// ---------------------------------------------------------------------------

export const AuthReasons = {
  NotAuthenticated: reason("NotAuthenticated", {}),
  NotPermitted: reason("NotPermitted", { required: PermissionSchema }),
  OutOfBinding: reason("OutOfBinding", { resource: z.string() }),
  NoSuchAccount: reason("NoSuchAccount", { account: AccountIdSchema }),
  IssuerNotAMember: reason("IssuerNotAMember", { account: AccountIdSchema }),
  NothingGrantable: reason("NothingGrantable", { account: AccountIdSchema }),
  RateLimited: reason("RateLimited", { retryAfterMs: DurationMsSchema }),
} as const;

// ---------------------------------------------------------------------------
// Tenancy — WorkspaceError and billing
// ---------------------------------------------------------------------------

export const WorkspaceReasons = {
  NameRequired: reason("NameRequired", {}),
  AlreadyAMember: reason("AlreadyAMember", { account: AccountIdSchema }),
  NotAMember: reason("NotAMember", { account: AccountIdSchema }),
  RoleUnchanged: reason("RoleUnchanged", { account: AccountIdSchema, role: RoleSchema }),
  LastOwner: reason("LastOwner", { account: AccountIdSchema }),
  SeatLimitReached: reason("SeatLimitReached", { limit: z.int() }),
  ProjectExists: reason("ProjectExists", { project: ProjectIdSchema }),
  NoSuchProject: reason("NoSuchProject", { project: ProjectIdSchema }),
  ProjectAlreadyArchived: reason("ProjectAlreadyArchived", { project: ProjectIdSchema }),
  ProjectNotArchived: reason("ProjectNotArchived", { project: ProjectIdSchema }),
  ProjectLimitReached: reason("ProjectLimitReached", { limit: z.int() }),
  NoSuchWorkspace: reason("NoSuchWorkspace", { workspace: WorkspaceIdSchema }),
} as const;

export const BillingReasons = {
  NoSubscription: reason("NoSubscription", { workspace: WorkspaceIdSchema }),
  PlanUnavailable: reason("PlanUnavailable", { plan: z.string() }),
  BadSignature: reason("BadSignature", {}),
  Stale: reason("Stale", { ageSeconds: z.int() }),
  Malformed: reason("Malformed", { detail: z.string() }),
  ProviderUnavailable: reason("ProviderUnavailable", { detail: z.string() }),
} as const;

// ---------------------------------------------------------------------------
// Projects — ProjectError
// ---------------------------------------------------------------------------

export const ProjectReasons = {
  NameRequired: reason("NameRequired", {}),
  NameUnchanged: reason("NameUnchanged", {}),
  NoSuchProject: reason("NoSuchProject", { project: ProjectIdSchema }),
  FirstCredentialMustIngest: reason("FirstCredentialMustIngest", {}),
  PermissionsRequired: reason("PermissionsRequired", {}),
  PermissionEscalation: reason("PermissionEscalation", {
    requested: z.array(PermissionSchema),
    held: z.array(PermissionSchema),
  }),
  CredentialExists: reason("CredentialExists", { credential: CredentialIdSchema }),
  UnknownCredential: reason("UnknownCredential", { credential: CredentialIdSchema }),
  CredentialRevoked: reason("CredentialRevoked", { credential: CredentialIdSchema }),
  CredentialExpired: reason("CredentialExpired", { credential: CredentialIdSchema }),
  LastIngestCredential: reason("LastIngestCredential", { credential: CredentialIdSchema }),
  RotationKindMismatch: reason("RotationKindMismatch", {}),
  AlreadyClaimed: reason("AlreadyClaimed", {}),
  GrantExpired: reason("GrantExpired", {}),
  GrantMismatch: reason("GrantMismatch", {}),
} as const;

// ---------------------------------------------------------------------------
// Dashboarding — DashboardError and MonitorError
// ---------------------------------------------------------------------------

export const DashboardReasons = {
  InvalidLayout: reason("InvalidLayout", { detail: z.string() }),
  NameRequired: reason("NameRequired", {}),
  NameUnchanged: reason("NameUnchanged", {}),
  TileTitleRequired: reason("TileTitleRequired", {}),
  TileExists: reason("TileExists", { tile: TileIdSchema }),
  NoSuchTile: reason("NoSuchTile", { tile: TileIdSchema }),
  TooManyTiles: reason("TooManyTiles", { max: z.int() }),
  InvalidWidth: reason("InvalidWidth", { width: z.int() }),
  WidthUnchanged: reason("WidthUnchanged", { tile: TileIdSchema }),
  IndexOutOfRange: reason("IndexOutOfRange", { index: z.int(), size: z.int() }),
  PositionUnchanged: reason("PositionUnchanged", { tile: TileIdSchema }),
  ShareGrantExpired: reason("ShareGrantExpired", {}),
  NotShared: reason("NotShared", {}),
  NoSuchDashboard: reason("NoSuchDashboard", { dashboard: DashboardIdSchema }),
} as const;

export const MonitorReasons = {
  NameRequired: reason("NameRequired", {}),
  NegativeCooldown: reason("NegativeCooldown", {}),
  AnalysisMustBeScalar: reason("AnalysisMustBeScalar", {}),
  InvalidAnalysis: reason("InvalidAnalysis", { detail: z.string() }),
  AlreadyEnabled: reason("AlreadyEnabled", {}),
  AlreadyDisabled: reason("AlreadyDisabled", {}),
  NoSuchMonitor: reason("NoSuchMonitor", { monitor: z.string() }),
} as const;

// ---------------------------------------------------------------------------
// Analytics — AnalysisError and EngineFailure
//
// `Timeout` is 504 and not 408. The caller's request was fine; the engine did
// not answer in time. A 408 tells the client *it* was slow, which is a
// different instruction and a different fix.
// ---------------------------------------------------------------------------

export const AnalysisReasons = {
  InvalidAnalysis: reason("InvalidAnalysis", { detail: z.string() }),
  WindowTooLarge: reason("WindowTooLarge", { max: z.int() }),
  UnknownDimension: reason("UnknownDimension", { dimension: z.string() }),
  UnknownMeasure: reason("UnknownMeasure", { measure: z.string() }),
  InvalidQuery: reason("InvalidQuery", { detail: z.string() }),
  Timeout: reason("Timeout", { budgetMs: DurationMsSchema }),
  Unavailable: reason("Unavailable", { detail: z.string() }),
  NotImplemented: reason("NotImplemented", {
    feature: z.enum(["retention", "group_by", "nested_predicates"]),
  }),
} as const;


/**
 * oRPC's closed vocabulary, verbatim. A key outside this list is a type error
 * in `@orpc/contract`; the list is here so a test can also assert it of the
 * generated document, which is the artifact other people read.
 */
export const ORPC_ERROR_CODES: readonly string[] = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "PAYMENT_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_SUPPORTED",
  "NOT_ACCEPTABLE",
  "TIMEOUT",
  "CONFLICT",
  "GONE",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "UNPROCESSABLE_CONTENT",
  "PRECONDITION_REQUIRED",
  "TOO_MANY_REQUESTS",
  "CLIENT_CLOSED_REQUEST",
  "INTERNAL_SERVER_ERROR",
  "NOT_IMPLEMENTED",
  "BAD_GATEWAY",
  "SERVICE_UNAVAILABLE",
  "GATEWAY_TIMEOUT",
];

/** The status each code lands at, for tests that read the generated document. */
export const STATUS_OF_CODE: Readonly<Record<string, number>> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_CONTENT: 422,
  TOO_MANY_REQUESTS: 429,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
};

const union = <T extends readonly [z.ZodObject, z.ZodObject, ...z.ZodObject[]]>(members: T) =>
  z.discriminatedUnion("reason", members);

/**
 * The three failures every authenticated route can produce, spelled once.
 *
 * They are spread into each map below rather than merged by a helper because
 * oRPC merges error maps with the later definition winning: a route that
 * declared its own `FORBIDDEN` would have silently replaced a shared one, and
 * the document would then say a 403 on that route can only mean escalation.
 * Spreading makes the replacement visible at the point it happens — the three
 * maps that need extra `FORBIDDEN` reasons list `NotPermitted` and
 * `OutOfBinding` themselves, in the same literal.
 */
export const AUTH_ERRORS = {
  UNAUTHORIZED: {
    message: "No usable credential was presented.",
    data: AuthReasons.NotAuthenticated,
  },
  FORBIDDEN: {
    message: "The credential does not reach this resource.",
    data: union([AuthReasons.NotPermitted, AuthReasons.OutOfBinding]),
  },
  TOO_MANY_REQUESTS: {
    message: "Too many requests.",
    data: AuthReasons.RateLimited,
  },
} as const;

/** Rate limiting alone — for the routes that take no credential. */
export const OPEN_ERRORS = {
  TOO_MANY_REQUESTS: AUTH_ERRORS.TOO_MANY_REQUESTS,
} as const;

export const WORKSPACE_ERRORS = {
  ...AUTH_ERRORS,
  BAD_REQUEST: {
    message: "The request is malformed.",
    data: WorkspaceReasons.NameRequired,
  },
  NOT_FOUND: {
    message: "No such resource.",
    data: union([WorkspaceReasons.NoSuchWorkspace, WorkspaceReasons.NotAMember]),
  },
  CONFLICT: {
    message: "The workspace is not in a state that allows this.",
    data: union([
      WorkspaceReasons.AlreadyAMember,
      WorkspaceReasons.RoleUnchanged,
      WorkspaceReasons.LastOwner,
    ]),
  },
  PAYMENT_REQUIRED: {
    message: "The workspace plan does not allow this.",
    data: union([WorkspaceReasons.SeatLimitReached, WorkspaceReasons.ProjectLimitReached]),
  },
} as const;

export const PROJECT_ERRORS = {
  ...AUTH_ERRORS,
  BAD_REQUEST: {
    message: "The request is malformed.",
    data: ProjectReasons.NameRequired,
  },
  NOT_FOUND: {
    message: "No such resource.",
    data: union([ProjectReasons.NoSuchProject, WorkspaceReasons.NoSuchWorkspace]),
  },
  CONFLICT: {
    message: "The project is not in a state that allows this.",
    data: union([
      ProjectReasons.NameUnchanged,
      WorkspaceReasons.ProjectExists,
      WorkspaceReasons.ProjectAlreadyArchived,
      WorkspaceReasons.ProjectNotArchived,
    ]),
  },
  PAYMENT_REQUIRED: {
    message: "The workspace plan does not allow another project.",
    data: WorkspaceReasons.ProjectLimitReached,
  },
} as const;

/**
 * Provisioning takes no credential, so it cannot fail for want of one. The
 * no-signup path is the only route in the contract shaped this way.
 */
export const PROVISION_ERRORS = {
  ...OPEN_ERRORS,
  BAD_REQUEST: {
    message: "The request is malformed.",
    data: ProjectReasons.NameRequired,
  },
} as const;

/**
 * Claiming a provisioned project. `GrantMismatch` is a 403 alongside the
 * ordinary authorization failures, so this map spells its own `FORBIDDEN`.
 */
export const CLAIM_ERRORS = {
  ...AUTH_ERRORS,
  FORBIDDEN: {
    message: "The claim was refused.",
    data: union([
      AuthReasons.NotPermitted,
      AuthReasons.OutOfBinding,
      ProjectReasons.GrantMismatch,
    ]),
  },
  NOT_FOUND: {
    message: "No such resource.",
    data: union([ProjectReasons.NoSuchProject, WorkspaceReasons.NoSuchWorkspace]),
  },
  CONFLICT: {
    message: "The project has already been claimed.",
    data: ProjectReasons.AlreadyClaimed,
  },
  GONE: {
    message: "The claim grant has expired.",
    data: ProjectReasons.GrantExpired,
  },
  PAYMENT_REQUIRED: {
    message: "The workspace plan does not allow another project.",
    data: WorkspaceReasons.ProjectLimitReached,
  },
} as const;

/**
 * Credential routes. `PermissionEscalation`, `IssuerNotAMember` and
 * `NothingGrantable` are all 403s about issuance rather than about the caller's
 * reach, which is why they sit beside the two ordinary ones instead of
 * replacing them.
 */
export const CREDENTIAL_ERRORS = {
  ...AUTH_ERRORS,
  FORBIDDEN: {
    message: "The credential may not be issued.",
    data: union([
      AuthReasons.NotPermitted,
      AuthReasons.OutOfBinding,
      AuthReasons.IssuerNotAMember,
      AuthReasons.NothingGrantable,
      ProjectReasons.PermissionEscalation,
    ]),
  },
  BAD_REQUEST: {
    message: "The request is malformed.",
    data: ProjectReasons.PermissionsRequired,
  },
  NOT_FOUND: {
    message: "No such resource.",
    data: union([ProjectReasons.NoSuchProject, ProjectReasons.UnknownCredential]),
  },
  CONFLICT: {
    message: "The credential is not in a state that allows this.",
    data: union([ProjectReasons.CredentialExists, ProjectReasons.LastIngestCredential]),
  },
  GONE: {
    message: "The credential is no longer usable.",
    data: union([ProjectReasons.CredentialRevoked, ProjectReasons.CredentialExpired]),
  },
  UNPROCESSABLE_CONTENT: {
    message: "The request is well-formed but cannot be carried out.",
    data: union([
      ProjectReasons.FirstCredentialMustIngest,
      ProjectReasons.RotationKindMismatch,
    ]),
  },
} as const;

export const DASHBOARD_ERRORS = {
  ...AUTH_ERRORS,
  BAD_REQUEST: {
    message: "The request is malformed.",
    data: union([DashboardReasons.NameRequired, DashboardReasons.InvalidLayout]),
  },
  NOT_FOUND: {
    message: "No such resource.",
    data: union([DashboardReasons.NoSuchDashboard, WorkspaceReasons.NoSuchWorkspace]),
  },
  CONFLICT: {
    message: "The dashboard is not in a state that allows this.",
    data: DashboardReasons.NameUnchanged,
  },
} as const;

/**
 * Tile routes carry the dashboard's own refusals plus the analysis ones: a tile
 * holds an `Analysis`, and an analysis the engine cannot answer is refused when
 * the tile is written rather than discovered when the page is opened.
 */
export const TILE_ERRORS = {
  ...AUTH_ERRORS,
  BAD_REQUEST: {
    message: "The request is malformed.",
    data: union([
      DashboardReasons.TileTitleRequired,
      DashboardReasons.InvalidWidth,
      DashboardReasons.IndexOutOfRange,
    ]),
  },
  NOT_FOUND: {
    message: "No such resource.",
    data: union([DashboardReasons.NoSuchDashboard, DashboardReasons.NoSuchTile]),
  },
  CONFLICT: {
    message: "The insight is not in a state that allows this.",
    data: union([
      DashboardReasons.TileExists,
      DashboardReasons.TooManyTiles,
      DashboardReasons.WidthUnchanged,
      DashboardReasons.PositionUnchanged,
    ]),
  },
  UNPROCESSABLE_CONTENT: {
    message: "The analysis cannot be answered.",
    data: union([
      AnalysisReasons.InvalidAnalysis,
      AnalysisReasons.WindowTooLarge,
      AnalysisReasons.UnknownDimension,
      AnalysisReasons.UnknownMeasure,
    ]),
  },
} as const;

export const MONITOR_ERRORS = {
  ...AUTH_ERRORS,
  BAD_REQUEST: {
    message: "The request is malformed.",
    data: union([MonitorReasons.NameRequired, MonitorReasons.NegativeCooldown]),
  },
  NOT_FOUND: {
    message: "No such resource.",
    data: union([MonitorReasons.NoSuchMonitor, ProjectReasons.NoSuchProject]),
  },
  CONFLICT: {
    message: "The monitor is already in that state.",
    data: union([MonitorReasons.AlreadyEnabled, MonitorReasons.AlreadyDisabled]),
  },
  UNPROCESSABLE_CONTENT: {
    message: "The analysis cannot drive a monitor.",
    data: union([
      MonitorReasons.AnalysisMustBeScalar,
      MonitorReasons.InvalidAnalysis,
      AnalysisReasons.WindowTooLarge,
      AnalysisReasons.UnknownDimension,
      AnalysisReasons.UnknownMeasure,
    ]),
  },
} as const;

/**
 * Running a question. The four engine failures keep their own statuses rather
 * than collapsing into 500, because "come back later", "ask a smaller
 * question" and "this will never work" are three different instructions.
 */
export const QUERY_ERRORS = {
  ...AUTH_ERRORS,
  NOT_FOUND: {
    message: "No such resource.",
    data: ProjectReasons.NoSuchProject,
  },
  UNPROCESSABLE_CONTENT: {
    message: "The analysis cannot be answered.",
    data: union([
      AnalysisReasons.InvalidAnalysis,
      AnalysisReasons.WindowTooLarge,
      AnalysisReasons.UnknownDimension,
      AnalysisReasons.UnknownMeasure,
      AnalysisReasons.InvalidQuery,
    ]),
  },
  NOT_IMPLEMENTED: {
    message: "Not available yet.",
    data: AnalysisReasons.NotImplemented,
  },
  SERVICE_UNAVAILABLE: {
    message: "The analytics engine is unavailable.",
    data: AnalysisReasons.Unavailable,
  },
  GATEWAY_TIMEOUT: {
    message: "The analytics engine did not answer in time.",
    data: AnalysisReasons.Timeout,
  },
} as const;

export const BILLING_ERRORS = {
  ...AUTH_ERRORS,
  NOT_FOUND: {
    message: "No such resource.",
    data: union([BillingReasons.NoSubscription, WorkspaceReasons.NoSuchWorkspace]),
  },
  UNPROCESSABLE_CONTENT: {
    message: "That plan cannot be selected.",
    data: BillingReasons.PlanUnavailable,
  },
  BAD_GATEWAY: {
    message: "The billing provider failed.",
    data: BillingReasons.ProviderUnavailable,
  },
} as const;

/**
 * Share routes answer `NotShared` for a wrong token and for an unshared
 * dashboard alike, so there is deliberately no 401 or 403 here: a distinct
 * status would turn the endpoint into an oracle for which dashboards have live
 * links. A right-but-expired token is told `ShareGrantExpired`, which only
 * tells someone who already had the token.
 */
export const SHARE_ERRORS = {
  ...OPEN_ERRORS,
  NOT_FOUND: {
    message: "No such share link.",
    data: DashboardReasons.NotShared,
  },
  GONE: {
    message: "The share link has expired.",
    data: DashboardReasons.ShareGrantExpired,
  },
} as const;

export const ACCOUNT_ERRORS = {
  ...AUTH_ERRORS,
  NOT_FOUND: {
    message: "No such account.",
    data: AuthReasons.NoSuchAccount,
  },
} as const;
