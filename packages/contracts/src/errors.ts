/**
 * Every way this API can say no.
 *
 * One closed registry. A code carries its status, its title, whether retrying
 * could help, and a docs anchor — so a route picks a code and the envelope is
 * filled in for it. Nothing anywhere hand-writes a status alongside a message
 * and gets to disagree with this table.
 *
 * v1 had eight envelope shapes: bare arrays, bare objects, `{data, meta}`,
 * `{insights}`, naked 204s and 202s, `{ok:true}`, `{received:true}` and
 * `{status:"ok"}`. None of them carried a code, a request id or a field-level
 * error, and validation failures were prose strings assembled at the call
 * site. A client could not branch on a failure without matching on English.
 *
 * `retryable` is part of the contract rather than a client-side guess. v1's
 * SDKs retried on any non-2xx, so a 400 for a malformed batch was resent four
 * times with the same body.
 */

export const ERRORS = {
  // ── auth ──────────────────────────────────────────────────────────────
  "auth.unauthenticated": {
    status: 401,
    title: "Unauthenticated",
    retryable: false,
    summary: "No credential was presented, or it does not resolve to anything usable.",
  },
  "auth.forbidden": {
    status: 403,
    title: "Forbidden",
    retryable: false,
    summary: "The credential is valid but does not carry the scope this operation needs.",
  },
  // ── resource ──────────────────────────────────────────────────────────
  "resource.not_found": {
    status: 404,
    title: "Not Found",
    retryable: false,
    summary:
      "No such resource — or it exists and belongs to someone else. The two are answered identically on purpose, so a valid credential cannot enumerate other workspaces' ids.",
  },
  "resource.conflict": {
    status: 409,
    title: "Conflict",
    retryable: false,
    summary: "The resource changed underneath this request, or an equal one already exists.",
  },
  // ── request ───────────────────────────────────────────────────────────
  "request.malformed": {
    status: 400,
    title: "Malformed Request",
    retryable: false,
    summary: "The body could not be parsed at all — not valid JSON, or not an object.",
  },
  "request.validation_failed": {
    status: 422,
    title: "Validation Failed",
    retryable: false,
    summary: "The body parsed but some fields are wrong. Every one of them is listed in `fields`.",
  },
  "request.too_large": {
    status: 413,
    title: "Payload Too Large",
    retryable: false,
    summary: "The body is larger than the ingestion limit. Send fewer events per batch.",
  },
  "request.unsupported_media_type": {
    status: 415,
    title: "Unsupported Media Type",
    retryable: false,
    summary: "This endpoint accepts application/json.",
  },
  // ── quota and rate ────────────────────────────────────────────────────
  "quota.exceeded": {
    status: 429,
    title: "Quota Exceeded",
    retryable: false,
    summary:
      "The workspace is past its monthly event allowance. Retrying will not help until the period rolls over or the plan changes.",
  },
  "rate.limited": {
    status: 429,
    title: "Rate Limited",
    retryable: true,
    summary: "Too many requests in too short a window. Honour `Retry-After`.",
  },
  // ── billing ───────────────────────────────────────────────────────────
  "billing.no_account": {
    status: 409,
    title: "No Billing Account",
    retryable: false,
    summary: "This workspace has never been to checkout, so there is no billing account to manage.",
  },
  "billing.provider_unavailable": {
    status: 502,
    title: "Billing Provider Unavailable",
    retryable: true,
    summary:
      "The payment provider did not answer. Nothing was charged and nothing changed; try again in a moment.",
  },
  // ── query ─────────────────────────────────────────────────────────────
  "query.timeout": {
    status: 504,
    title: "Query Timeout",
    retryable: true,
    summary: "The analysis did not finish inside its budget. A narrower window usually will.",
  },
  "query.unsupported": {
    status: 422,
    title: "Unsupported Analysis",
    retryable: false,
    summary:
      "The analysis is well-formed but cannot be answered — a retention question with no person identity, for instance.",
  },
  // ── internal ──────────────────────────────────────────────────────────
  "internal.unavailable": {
    status: 503,
    title: "Temporarily Unavailable",
    retryable: true,
    summary:
      "A dependency is down. Events are safe to resend: ingestion is at-least-once with a dedup key, so a retry cannot double-count.",
  },
  "internal.error": {
    status: 500,
    title: "Internal Server Error",
    retryable: false,
    summary: "A bug on our side. The request id in this response is what to quote when reporting it.",
  },
} as const;

export type ErrorCode = keyof typeof ERRORS;

export type ErrorDefinition = {
  readonly status: number;
  readonly title: string;
  readonly retryable: boolean;
  readonly summary: string;
};

export const ERROR_CODES = Object.keys(ERRORS) as readonly ErrorCode[];

export const isErrorCode = (raw: string): raw is ErrorCode => raw in ERRORS;

export const definitionOf = (code: ErrorCode): ErrorDefinition => ERRORS[code];

/** Where the type URI points. Stable — clients may match on it. */
export const typeUriFor = (code: ErrorCode): string => `https://counted.dev/errors/${code}`;

/** Where a human goes to read more. Asserted to exist for every code in CI. */
export const docsUriFor = (code: ErrorCode): string =>
  `https://counted.dev/docs/errors#${code.replace(/\./g, "-")}`;
