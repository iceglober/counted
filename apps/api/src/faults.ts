/**
 * V3-SPEC §6's table, executed. Every domain error becomes one status and one
 * `reason`, in this file and nowhere else.
 *
 * Three properties are worth stating, because each one is a bug that has
 * already happened somewhere.
 *
 * **Every mapping is exhaustive over its union.** Each `map*` ends in
 * `assertNever`, so adding a `kind` to a domain error union is a compile error
 * here rather than a silent 500 in production. That is the whole reason the
 * unions are closed.
 *
 * **The reason is the domain's `kind`, unmodified.** A client matching on
 * `data.reason` is matching on the same string the domain wrote. Translating
 * the name here would give the wire a second vocabulary to keep in step.
 *
 * **Some reasons the domain can produce are not declared in the contract.**
 * `UNDECLARED_REASONS` lists them, and `faults.test.ts` checks that list
 * against the generated OpenAPI document — so the set is enumerated and shrinks
 * when the contract is widened, instead of being discovered by a client that
 * cannot narrow a 409. oRPC still sends them at the right status; what is lost
 * is `defined: true`, meaning a generated client sees an unrecognised error
 * rather than a typed one.
 */

import { ORPCError } from "@orpc/client";
import { assertNever, Duration, unbrand } from "@counted/kernel";
import type { Denial } from "@counted/authorization";
import type { AnalysisError } from "@counted/analytics-domain";
import type { EngineFailure } from "@counted/analytics-ports";
import type { DashboardError, MonitorError } from "@counted/dashboarding-domain";
import type { BatchAdmissionError, EventAdmissionError } from "@counted/ingestion-domain";
import type { ProjectError } from "@counted/projects-domain";
import type { BillingError, WorkspaceError } from "@counted/tenancy-domain";
import type { IssueFailure, VerificationFailure } from "@counted/identity-ports";

/** oRPC's closed vocabulary, narrowed to the codes this API actually produces. */
export type FaultCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "PAYMENT_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "GONE"
  | "PAYLOAD_TOO_LARGE"
  | "UNPROCESSABLE_CONTENT"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_SERVER_ERROR"
  | "NOT_IMPLEMENTED"
  | "BAD_GATEWAY"
  | "SERVICE_UNAVAILABLE"
  | "GATEWAY_TIMEOUT";

export type FaultData = { readonly reason: string } & Readonly<Record<string, unknown>>;

export type Fault = {
  readonly code: FaultCode;
  readonly message: string;
  readonly data: FaultData;
};

const fault = (code: FaultCode, message: string, data: FaultData): Fault => ({
  code,
  message,
  data,
});

/** Throwable, for a procedure handler. */
export const asORPCError = (f: Fault): ORPCError<string, FaultData> =>
  new ORPCError(f.code, { message: f.message, data: f.data });

export function raise(f: Fault): never {
  throw asORPCError(f);
}

/**
 * A surface the contract describes and no port implements.
 *
 * A 501 with the missing capability named, rather than a 500 or — worse — a
 * 200 that pretends the write happened. `feature` is machine-readable so a
 * console can hide the control instead of offering a button that always fails.
 */
export const notImplemented = (feature: string, detail: string): Fault =>
  fault("NOT_IMPLEMENTED", detail, { reason: "NotImplemented", feature });

/**
 * Reasons this file emits that no route in `@counted/contract` declares.
 *
 * Each is a real refusal the domain produces; none has a home in the contract's
 * error maps yet. Listed rather than silently downgraded to a neighbouring
 * reason, because "the dashboard you asked to make default already is" and
 * "the name is unchanged" are different sentences and collapsing them is how a
 * console shows the wrong one.
 */
export const UNDECLARED_REASONS: readonly string[] = [
  // ProjectError kinds `@counted/projects-domain` added after V3-SPEC §6 was
  // written. Each is a real refusal with no home in the contract's error maps.
  "ProjectArchived",
  "InvalidRetention",
  "RetentionUnchanged",

  // DashboardError kinds `@counted/dashboarding-domain` added, same reason.
  "NotAPermutation",
  "OrderUnchanged",
  "DefaultUnchanged",
  // A grant that resolved to a dashboard it was not minted for. Answered 403
  // rather than `NotShared`, because it is a repository bug rather than a wrong
  // token and it must not look like one — but the share routes declare no 403
  // at all, on purpose (see the oracle note in `routes/share.ts`), so there is
  // nowhere in the contract for it to be declared.
  "ShareGrantMismatch",

  // The ingest route is hand-written and not in the contract at all, so none of
  // its batch refusals can be declared there. They still reach the SDK at the
  // right status with the `retryable` flag it branches on.
  "BatchTooLarge",
  "PayloadTooLarge",
  "PlanExceeded",
  "SinkUnavailable",

  // The three webhook-only billing reasons. `POST /v1/webhooks/stripe` is
  // hand-written and outside the contract — signature verification needs the
  // raw body — so a rejected delivery has nowhere to be declared. The other
  // three billing reasons used to be here too, because the billing namespace
  // existed in `packages/contract/src/routes/billing.ts` and was never added
  // to the contract tree: no customer could start a checkout. It is mounted
  // now, so `NoSubscription`, `PlanUnavailable` and `ProviderUnavailable` are
  // declared and this list shrank to what is genuinely undeclarable.
  "BadSignature",
  "Stale",
  "Malformed",
];

// ── authorization ───────────────────────────────────────────────────────────

/**
 * A refused decision.
 *
 * `NotAMember` becomes `NotPermitted` on the wire and keeps its own name in the
 * log. Answering "you are not a member of workspace X" would confirm that X
 * exists to somebody who guessed the id, which is the one thing a 403 must not
 * do — and the caller's fix is the same either way: ask an owner.
 */
export const fromDenial = (denial: Denial): Fault => {
  switch (denial.reason) {
    case "NotAuthenticated":
      return fault("UNAUTHORIZED", "No usable credential was presented.", {
        reason: "NotAuthenticated",
      });
    case "NotAMember":
      return fault("FORBIDDEN", "The credential does not reach this resource.", {
        reason: "NotPermitted",
        required: "workspace:read",
      });
    case "NotPermitted":
      return fault("FORBIDDEN", "The credential does not reach this resource.", {
        reason: "NotPermitted",
        required: denial.required,
      });
    case "OutOfBinding":
      return fault("FORBIDDEN", "The credential does not reach this resource.", {
        reason: "OutOfBinding",
        resource: denial.resource.type,
      });
    default:
      return assertNever(denial);
  }
};

/**
 * A credential that did not resolve.
 *
 * `Unknown`, `Revoked` and `Expired` collapse into one bare 401 (V3-SPEC §5):
 * a distinct answer for each would tell whoever is guessing which of their
 * guesses exists. `RateLimited` does not collapse, because "back off" is an
 * instruction the caller can act on and withholding it just produces more
 * requests.
 */
export const fromVerificationFailure = (failure: VerificationFailure): Fault =>
  failure.kind === "RateLimited"
    ? fault("TOO_MANY_REQUESTS", "Too many requests.", {
        reason: "RateLimited",
        retryAfterMs: Duration.toMillis(failure.retryAfter),
      })
    : fault("UNAUTHORIZED", "No usable credential was presented.", {
        reason: "NotAuthenticated",
      });

export const fromIssueFailure = (failure: IssueFailure): Fault => {
  switch (failure.kind) {
    case "NoSuchWorkspace":
      return fault("NOT_FOUND", "No such resource.", {
        reason: "NoSuchWorkspace",
        workspace: unbrand(failure.workspace),
      });
    case "NoSuchProject":
      return fault("NOT_FOUND", "No such resource.", {
        reason: "NoSuchProject",
        project: unbrand(failure.project),
      });
    case "IssuerNotAMember":
      return fault("FORBIDDEN", "The credential may not be issued.", {
        reason: "IssuerNotAMember",
        account: unbrand(failure.account),
      });
    case "NothingGrantable":
      return fault("FORBIDDEN", "The credential may not be issued.", {
        reason: "NothingGrantable",
        account: unbrand(failure.account),
      });
    default:
      return assertNever(failure);
  }
};

// ── tenancy ─────────────────────────────────────────────────────────────────

export const fromWorkspaceError = (error: WorkspaceError): Fault => {
  switch (error.kind) {
    case "NameRequired":
      return fault("BAD_REQUEST", "The request is malformed.", { reason: "NameRequired" });
    case "NoSuchWorkspace":
      return fault("NOT_FOUND", "No such resource.", {
        reason: "NoSuchWorkspace",
        workspace: unbrand(error.workspace),
      });
    case "AlreadyAMember":
      return fault("CONFLICT", "The workspace is not in a state that allows this.", {
        reason: "AlreadyAMember",
        account: unbrand(error.account),
      });
    case "NotAMember":
      return fault("NOT_FOUND", "No such resource.", {
        reason: "NotAMember",
        account: unbrand(error.account),
      });
    case "RoleUnchanged":
      return fault("CONFLICT", "The workspace is not in a state that allows this.", {
        reason: "RoleUnchanged",
        account: unbrand(error.account),
        role: error.role,
      });
    case "LastOwner":
      return fault("CONFLICT", "The workspace is not in a state that allows this.", {
        reason: "LastOwner",
        account: unbrand(error.account),
      });
    case "SeatLimitReached":
      return fault("PAYMENT_REQUIRED", "The workspace plan does not allow this.", {
        reason: "SeatLimitReached",
        limit: error.limit,
      });
    case "ProjectExists":
      return fault("CONFLICT", "The project is not in a state that allows this.", {
        reason: "ProjectExists",
        project: unbrand(error.project),
      });
    case "NoSuchProject":
      return fault("NOT_FOUND", "No such resource.", {
        reason: "NoSuchProject",
        project: unbrand(error.project),
      });
    case "ProjectAlreadyArchived":
      return fault("CONFLICT", "The project is not in a state that allows this.", {
        reason: "ProjectAlreadyArchived",
        project: unbrand(error.project),
      });
    case "ProjectNotArchived":
      return fault("CONFLICT", "The project is not in a state that allows this.", {
        reason: "ProjectNotArchived",
        project: unbrand(error.project),
      });
    case "ProjectLimitReached":
      return fault("PAYMENT_REQUIRED", "The workspace plan does not allow another project.", {
        reason: "ProjectLimitReached",
        limit: error.limit,
      });
    default:
      return assertNever(error);
  }
};

export const fromBillingError = (error: BillingError): Fault => {
  switch (error.kind) {
    case "NoSubscription":
      return fault("NOT_FOUND", "No such resource.", {
        reason: "NoSubscription",
        workspace: unbrand(error.workspace),
      });
    case "PlanUnavailable":
      return fault("UNPROCESSABLE_CONTENT", "That plan cannot be selected.", {
        reason: "PlanUnavailable",
        plan: error.plan,
      });
    case "BadSignature":
      return fault("BAD_REQUEST", "The request is malformed.", { reason: "BadSignature" });
    case "Stale":
      return fault("BAD_REQUEST", "The request is malformed.", {
        reason: "Stale",
        ageSeconds: error.ageSeconds,
      });
    case "Malformed":
      return fault("BAD_REQUEST", "The request is malformed.", {
        reason: "Malformed",
        detail: error.detail,
      });
    case "ProviderUnavailable":
      return fault("BAD_GATEWAY", "The billing provider failed.", {
        reason: "ProviderUnavailable",
        detail: error.detail,
      });
    default:
      return assertNever(error);
  }
};

// ── projects ────────────────────────────────────────────────────────────────

export const fromProjectError = (error: ProjectError): Fault => {
  switch (error.kind) {
    case "NameRequired":
      return fault("BAD_REQUEST", "The request is malformed.", { reason: "NameRequired" });
    case "NameUnchanged":
      return fault("CONFLICT", "The project is not in a state that allows this.", {
        reason: "NameUnchanged",
      });
    case "NoSuchProject":
      return fault("NOT_FOUND", "No such resource.", {
        reason: "NoSuchProject",
        project: unbrand(error.project),
      });
    case "FirstCredentialMustIngest":
      return fault("UNPROCESSABLE_CONTENT", "The request cannot be carried out.", {
        reason: "FirstCredentialMustIngest",
      });
    case "PermissionsRequired":
      return fault("BAD_REQUEST", "The request is malformed.", { reason: "PermissionsRequired" });
    case "PermissionEscalation":
      return fault("FORBIDDEN", "The credential may not be issued.", {
        reason: "PermissionEscalation",
        requested: [...error.requested],
        held: [...error.held],
      });
    case "CredentialExists":
      return fault("CONFLICT", "The credential is not in a state that allows this.", {
        reason: "CredentialExists",
        credential: unbrand(error.credential),
      });
    case "UnknownCredential":
      return fault("NOT_FOUND", "No such resource.", {
        reason: "UnknownCredential",
        credential: unbrand(error.credential),
      });
    case "CredentialRevoked":
      return fault("GONE", "The credential is no longer usable.", {
        reason: "CredentialRevoked",
        credential: unbrand(error.credential),
      });
    case "CredentialExpired":
      return fault("GONE", "The credential is no longer usable.", {
        reason: "CredentialExpired",
        credential: unbrand(error.credential),
      });
    case "LastIngestCredential":
      return fault("CONFLICT", "The credential is not in a state that allows this.", {
        reason: "LastIngestCredential",
        credential: unbrand(error.credential),
      });
    case "RotationKindMismatch":
      return fault("UNPROCESSABLE_CONTENT", "The request cannot be carried out.", {
        reason: "RotationKindMismatch",
      });
    case "AlreadyClaimed":
      return fault("CONFLICT", "The project has already been claimed.", {
        reason: "AlreadyClaimed",
      });
    case "GrantExpired":
      return fault("GONE", "The claim grant has expired.", { reason: "GrantExpired" });
    case "GrantMismatch":
      return fault("FORBIDDEN", "The claim was refused.", { reason: "GrantMismatch" });
    case "ProjectArchived":
      // 409 and not 422: the project is in a state that refuses the write, and
      // un-archiving is a thing the caller can go and do.
      return fault("CONFLICT", "The project is archived.", {
        reason: "ProjectArchived",
        project: unbrand(error.project),
      });
    case "ProjectNotArchived":
      return fault("CONFLICT", "The project is not archived.", {
        reason: "ProjectNotArchived",
        project: unbrand(error.project),
      });
    case "InvalidRetention":
      return fault("BAD_REQUEST", "The request is malformed.", {
        reason: "InvalidRetention",
        days: error.days,
      });
    case "RetentionUnchanged":
      return fault("CONFLICT", "The project is not in a state that allows this.", {
        reason: "RetentionUnchanged",
      });
    default:
      return assertNever(error);
  }
};

// ── dashboarding ────────────────────────────────────────────────────────────

export const fromDashboardError = (error: DashboardError): Fault => {
  switch (error.kind) {
    case "InvalidLayout":
      return fault("BAD_REQUEST", "The dashboard layout is invalid.", { reason: "InvalidLayout", detail: error.detail });
    case "NameRequired":
      return fault("BAD_REQUEST", "The request is malformed.", { reason: "NameRequired" });
    case "NameUnchanged":
      return fault("CONFLICT", "The dashboard is not in a state that allows this.", {
        reason: "NameUnchanged",
      });
    case "NoSuchDashboard":
      return fault("NOT_FOUND", "No such resource.", {
        reason: "NoSuchDashboard",
        dashboard: unbrand(error.dashboard),
      });
    case "TileTitleRequired":
      return fault("BAD_REQUEST", "The request is malformed.", { reason: "TileTitleRequired" });
    case "TileExists":
      return fault("CONFLICT", "The tile is not in a state that allows this.", {
        reason: "TileExists",
        tile: unbrand(error.tile),
      });
    case "NoSuchTile":
      return fault("NOT_FOUND", "No such resource.", {
        reason: "NoSuchTile",
        tile: unbrand(error.tile),
      });
    case "TooManyTiles":
      return fault("CONFLICT", "The tile is not in a state that allows this.", {
        reason: "TooManyTiles",
        max: error.max,
      });
    case "InvalidWidth":
      return fault("BAD_REQUEST", "The request is malformed.", {
        reason: "InvalidWidth",
        width: error.width,
      });
    case "WidthUnchanged":
      return fault("CONFLICT", "The tile is not in a state that allows this.", {
        reason: "WidthUnchanged",
        tile: unbrand(error.tile),
      });
    case "IndexOutOfRange":
      return fault("BAD_REQUEST", "The request is malformed.", {
        reason: "IndexOutOfRange",
        index: error.index,
        size: error.size,
      });
    case "PositionUnchanged":
      return fault("CONFLICT", "The tile is not in a state that allows this.", {
        reason: "PositionUnchanged",
        tile: unbrand(error.tile),
      });
    case "NotAPermutation":
      return fault("BAD_REQUEST", "The order must name every tile exactly once.", {
        reason: "NotAPermutation",
        expected: error.expected,
        received: error.received,
      });
    case "OrderUnchanged":
      return fault("CONFLICT", "The tile is not in a state that allows this.", {
        reason: "OrderUnchanged",
      });
    case "DefaultUnchanged":
      return fault("CONFLICT", "The dashboard is already the default.", {
        reason: "DefaultUnchanged",
      });
    case "ShareGrantExpired":
      return fault("GONE", "The share link has expired.", { reason: "ShareGrantExpired" });
    case "ShareGrantMismatch":
      // Answered as `NotShared` would be wrong here: this is a grant that
      // resolved to a dashboard it was not minted for, which is a repository
      // bug rather than a wrong token, and it must not look like one.
      return fault("FORBIDDEN", "The share link does not open this dashboard.", {
        reason: "ShareGrantMismatch",
      });
    case "NotShared":
      return fault("NOT_FOUND", "No such share link.", { reason: "NotShared" });
    default:
      return assertNever(error);
  }
};

export const fromMonitorError = (error: MonitorError): Fault => {
  switch (error.kind) {
    case "NameRequired":
      return fault("BAD_REQUEST", "The request is malformed.", { reason: "NameRequired" });
    case "NameUnchanged":
      return fault("CONFLICT", "The monitor is already in that state.", {
        reason: "NameUnchanged",
      });
    case "NoSuchMonitor":
      return fault("NOT_FOUND", "No such resource.", {
        reason: "NoSuchMonitor",
        monitor: unbrand(error.monitor),
      });
    case "NegativeCooldown":
      return fault("BAD_REQUEST", "The request is malformed.", { reason: "NegativeCooldown" });
    case "AnalysisMustBeScalar":
      return fault("UNPROCESSABLE_CONTENT", "The analysis cannot drive a monitor.", {
        reason: "AnalysisMustBeScalar",
      });
    case "InvalidAnalysis":
      return fault("UNPROCESSABLE_CONTENT", "The analysis cannot drive a monitor.", {
        reason: "InvalidAnalysis",
        detail: error.detail,
      });
    case "AlreadyEnabled":
      return fault("CONFLICT", "The monitor is already in that state.", {
        reason: "AlreadyEnabled",
      });
    case "AlreadyDisabled":
      return fault("CONFLICT", "The monitor is already in that state.", {
        reason: "AlreadyDisabled",
      });
    default:
      return assertNever(error);
  }
};

// ── analytics ───────────────────────────────────────────────────────────────

export const fromAnalysisError = (error: AnalysisError): Fault => {
  switch (error.kind) {
    case "InvalidAnalysis":
      return fault("UNPROCESSABLE_CONTENT", "The analysis cannot be answered.", {
        reason: "InvalidAnalysis",
        detail: error.detail,
      });
    case "WindowTooLarge":
      return fault("UNPROCESSABLE_CONTENT", "The analysis cannot be answered.", {
        reason: "WindowTooLarge",
        max: error.max,
      });
    case "UnknownDimension":
      return fault("UNPROCESSABLE_CONTENT", "The analysis cannot be answered.", {
        reason: "UnknownDimension",
        dimension: error.dimension,
      });
    case "UnknownMeasure":
      return fault("UNPROCESSABLE_CONTENT", "The analysis cannot be answered.", {
        reason: "UnknownMeasure",
        measure: error.measure,
      });
    default:
      return assertNever(error);
  }
};

/**
 * An engine failure, for the single-question route.
 *
 * `Timeout` is 504 and not 408. The caller's request was fine; the engine did
 * not answer. A 408 tells the client *it* was slow, which is a different
 * instruction and a different fix.
 */
export const fromEngineFailure = (failure: EngineFailure): Fault => {
  switch (failure.kind) {
    case "Timeout":
      return fault("GATEWAY_TIMEOUT", "The analytics engine did not answer in time.", {
        reason: "Timeout",
        budgetMs: Duration.toMillis(failure.budget),
      });
    case "Unavailable":
      return fault("SERVICE_UNAVAILABLE", "The analytics engine is unavailable.", {
        reason: "Unavailable",
        detail: failure.detail,
      });
    case "InvalidQuery":
      return fault("UNPROCESSABLE_CONTENT", "The analysis cannot be answered.", {
        reason: "InvalidQuery",
        detail: failure.detail,
      });
    case "NotImplemented":
      return fault("NOT_IMPLEMENTED", "Not available yet.", {
        reason: "NotImplemented",
        feature: failure.feature,
      });
    default:
      return assertNever(failure);
  }
};

// ── ingestion ───────────────────────────────────────────────────────────────

/**
 * `PlanExceeded` is 402 and `RateLimited` is 429, and the difference is the
 * instruction: upgrade versus back off. v1 answered both with 429 and produced
 * a customer who retried for two days against a quota that was never moving.
 */
export const fromBatchAdmissionError = (error: BatchAdmissionError): Fault => {
  switch (error.kind) {
    case "BatchTooLarge":
      return fault("PAYLOAD_TOO_LARGE", "The batch is too large.", {
        reason: "BatchTooLarge",
        count: error.count,
        max: error.max,
      });
    case "PayloadTooLarge":
      return fault("PAYLOAD_TOO_LARGE", "The payload is too large.", {
        reason: "PayloadTooLarge",
        bytes: error.bytes,
        max: error.max,
      });
    case "PlanExceeded":
      return fault("PAYMENT_REQUIRED", "The workspace plan does not allow this.", {
        reason: "PlanExceeded",
        limit: error.limit,
        used: error.used,
      });
    case "RateLimited":
      return fault("TOO_MANY_REQUESTS", "Too many requests.", {
        reason: "RateLimited",
        retryAfterMs: error.retryAfterMs,
      });
    case "SinkUnavailable":
      return fault("SERVICE_UNAVAILABLE", "The event store is unavailable.", {
        reason: "SinkUnavailable",
        detail: error.detail,
      });
    default:
      return assertNever(error);
  }
};

/** Per-event problems, reported in the body of an otherwise successful ingest. */
export const describeEventAdmissionError = (
  error: EventAdmissionError,
): Readonly<Record<string, unknown>> => {
  switch (error.kind) {
    case "MalformedEvent":
      return { reason: "MalformedEvent", index: error.index, detail: error.detail };
    case "UnknownEventName":
      return { reason: "UnknownEventName", name: error.name };
    case "ClockSkew":
      return { reason: "ClockSkew", skewMs: error.skewMs, max: error.max };
    case "PersonIdRequired":
      return { reason: "PersonIdRequired" };
    case "PersonIdTooLong":
      return { reason: "PersonIdTooLong", length: error.length, max: error.max };
    case "PersonIdLooksLikeEmail":
      return { reason: "PersonIdLooksLikeEmail" };
    default:
      return assertNever(error);
  }
};
