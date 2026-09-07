/**
 * Turning a failed call into something a page can render.
 *
 * The API answers a refused rule with an oRPC error: one of the closed 22
 * codes, plus a `data.reason` carrying the domain error's own `kind`
 * (V3-SPEC §6). The code says what kind of answer it is; only the reason says
 * what actually happened. A console that renders the code alone tells the user
 * "conflict", which is not an instruction.
 *
 * Two facts about `@orpc/client@2.0.0-beta.32`, both established by running it
 * rather than by reading the docs:
 *
 *   - the wire body is `{ defined, inferable, code, message, data? }` and
 *     carries **no status**, so `ORPCError.status` is `undefined` on the client
 *     side. The status is recovered from `STATUS_OF_CODE`, which the contract
 *     already exports for its own document tests.
 *   - `isDefinedError` is `isInferableError`: it is true only when the server
 *     set `inferable: true` on the wire. Control flow that depends on it is
 *     control flow that depends on a server-side flag this app does not own, so
 *     nothing here uses it. The code and the reason are enough.
 */

import { ORPCError } from "@orpc/client";
import { STATUS_OF_CODE } from "@counted/contract";

export type Failure = {
  /** One of oRPC's closed 22. `"NETWORK"` when the API could not be reached. */
  readonly code: string;
  readonly status: number;
  /** The domain error's `kind`, from `data.reason`. Null when there is none. */
  readonly reason: string | null;
  /** The server's own sentence. Never shown raw — see `sentenceFor`. */
  readonly message: string;
};

/**
 * `data` is `unknown` at this layer and stays that way.
 *
 * Re-declaring the reason unions here would be twenty hand-written response
 * shapes wearing a different hat — the exact thing this console is built to
 * avoid. The one field that is read is `reason`, and it is read defensively.
 */
const reasonOf = (data: unknown): string | null => {
  if (typeof data !== "object" || data === null) return null;
  const reason = (data as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
};

export const failureOf = (error: unknown): Failure => {
  if (error instanceof ORPCError) {
    return {
      code: error.code,
      status: STATUS_OF_CODE[error.code] ?? 500,
      reason: reasonOf(error.data),
      message: error.message,
    };
  }
  // A thrown non-ORPCError from the link is a transport failure: DNS, a refused
  // connection, a timeout. It is reported as one rather than as a 500, because
  // "the API did not answer" and "the API answered with a bug" need different
  // things done about them.
  return {
    code: "NETWORK",
    status: 503,
    reason: null,
    message: error instanceof Error ? error.message : String(error),
  };
};

/** The caller has no session at all, and the page should send them to sign in. */
export const isUnauthenticated = (failure: Failure): boolean => failure.code === "UNAUTHORIZED";

/**
 * One sentence per domain error, keyed by `data.reason`.
 *
 * This is a copy table, not a type table: nothing here describes the shape of a
 * response, and the reasons are V3-SPEC §6's `kind` strings. A reason with no
 * entry falls through to the code's sentence, so the page always says something
 * true even when this table is behind the domain.
 */
const REASON_SENTENCES: Readonly<Record<string, string>> = {
  // Identity and authorization
  NotAuthenticated: "You are signed out. Sign in and try again.",
  NotPermitted: "Your role in this workspace does not allow that.",
  OutOfBinding: "That resource is outside what your access covers.",
  NoSuchAccount: "No account with that email.",
  IssuerNotAMember: "You are not a member of that workspace.",
  NothingGrantable: "Your role carries no permissions a key could be given.",
  RateLimited: "Too many attempts. Wait a moment and try again.",

  // Tenancy
  NameRequired: "A name is required.",
  NameUnchanged: "That is already the name.",
  AlreadyAMember: "That person is already a member.",
  NotAMember: "That person is not a member of this workspace.",
  RoleUnchanged: "They already hold that role.",
  LastOwner: "A workspace needs at least one owner. Promote someone else first.",
  SeatLimitReached: "Your plan's seat limit is reached. Upgrade to invite more people.",
  ProjectExists: "A project with that name already exists here.",
  NoSuchProject: "That project no longer exists.",
  ProjectAlreadyArchived: "That project is already archived.",
  ProjectNotArchived: "That project is not archived.",
  ProjectLimitReached: "Your plan's project limit is reached. Upgrade to add more.",
  NoSuchWorkspace: "That workspace no longer exists.",

  // Billing
  NoSubscription: "This workspace has never had a paid plan, so there is no billing account to open.",
  PlanUnavailable: "That plan cannot be selected from here.",
  BadSignature: "The billing provider's response could not be verified.",
  Stale: "That billing request took too long and was refused.",
  Malformed: "The billing provider sent something unreadable.",
  ProviderUnavailable: "The billing provider is not responding. Nothing was charged.",

  // Projects and credentials
  FirstCredentialMustIngest: "A project's first key has to be an ingest key.",
  PermissionsRequired: "Choose at least one permission for the key.",
  PermissionEscalation: "A key cannot carry a permission you do not hold yourself.",
  CredentialExists: "A key with that name already exists in this project.",
  UnknownCredential: "That key no longer exists.",
  CredentialRevoked: "That key was already revoked.",
  CredentialExpired: "That key has expired.",
  LastIngestCredential: "This is the project's only ingest key. Issue a replacement before revoking it.",
  RotationKindMismatch: "A key rotates into the same kind it already is.",
  AlreadyClaimed: "That project has already been claimed.",
  GrantExpired: "That claim link has expired.",
  GrantMismatch: "That claim token does not match this project.",

  // Dashboards, tiles, monitors
  TileTitleRequired: "An insight needs a title.",
  TileExists: "That insight is already on this dashboard.",
  NoSuchTile: "That insight is no longer on this dashboard.",
  TooManyTiles: "This dashboard is full. Remove an insight before adding another.",
  InvalidLayout: "That layout could not be saved. Check for overlapping insights, or reload if the dashboard has changed.",
  InvalidWidth: "An insight's width is between 1 and 12 twelfths.",
  WidthUnchanged: "The insight is already that wide.",
  IndexOutOfRange: "That position is past the end of the dashboard.",
  PositionUnchanged: "The insight is already there.",
  ShareGrantExpired: "That share link has expired.",
  NotShared: "This dashboard has no live share link.",
  NegativeCooldown: "A cooldown cannot be negative.",
  AnalysisMustBeScalar: "A monitor watches a single number, so its question has to produce one.",
  AlreadyEnabled: "That monitor is already enabled.",
  AlreadyDisabled: "That monitor is already disabled.",

  // Analytics
  InvalidAnalysis: "That question is not answerable as written.",
  WindowTooLarge: "That window is longer than this plan allows.",
  UnknownDimension: "This project has no such dimension.",
  UnknownMeasure: "This project has no such measure.",
  Timeout: "The query did not finish in time.",
  Unavailable: "The analytics engine is not answering.",
  InvalidQuery: "That query could not be run.",
  NotImplemented: "That is not available yet.",
};

/**
 * The fallback, by code. Deliberately says what to do rather than what
 * happened, because by the time we are here the specific reason is unknown and
 * a restatement of the status code helps nobody.
 */
const CODE_SENTENCES: Readonly<Record<string, string>> = {
  BAD_REQUEST: "Something in that request was not valid.",
  UNAUTHORIZED: "You are signed out. Sign in and try again.",
  PAYMENT_REQUIRED: "Your plan does not cover that. Upgrade to continue.",
  FORBIDDEN: "Your role in this workspace does not allow that.",
  NOT_FOUND: "That no longer exists.",
  CONFLICT: "That conflicts with the current state.",
  GONE: "That is no longer available.",
  PAYLOAD_TOO_LARGE: "That was too big to accept.",
  UNPROCESSABLE_CONTENT: "That could not be processed as written.",
  TOO_MANY_REQUESTS: "Too many requests. Wait a moment and try again.",
  NOT_IMPLEMENTED: "That is not available yet.",
  BAD_GATEWAY: "An upstream service failed. Nothing was changed.",
  SERVICE_UNAVAILABLE: "That service is not answering. Try again shortly.",
  GATEWAY_TIMEOUT: "That took too long and was given up on.",
  NETWORK: "The API could not be reached.",
};

export const sentenceFor = (failure: Failure): string => {
  if (failure.reason !== null) {
    const sentence = REASON_SENTENCES[failure.reason];
    if (sentence !== undefined) return sentence;
  }
  return CODE_SENTENCES[failure.code] ?? "That did not work.";
};

/**
 * A failure survives a redirect as two short query parameters and nothing else.
 *
 * The server's own `message` is deliberately left behind. It can contain a
 * resource name, and a URL is the one place a message reliably ends up in a
 * proxy log, a referrer header and the user's history.
 */
export const failureQuery = (failure: Failure): string => {
  const params = new URLSearchParams({ code: failure.code });
  if (failure.reason !== null) params.set("reason", failure.reason);
  return params.toString();
};

/** The inverse, for a page reading its own `searchParams`. */
export const failureFromQuery = (query: {
  readonly code?: string | string[] | undefined;
  readonly reason?: string | string[] | undefined;
}): Failure | null => {
  const code = Array.isArray(query.code) ? query.code[0] : query.code;
  if (code === undefined || code === "") return null;
  const rawReason = Array.isArray(query.reason) ? query.reason[0] : query.reason;
  return {
    code,
    status: STATUS_OF_CODE[code] ?? 500,
    reason: rawReason === undefined || rawReason === "" ? null : rawReason,
    message: "",
  };
};
