/**
 * The parts of the OpenAPI document that are not derived from a procedure.
 *
 * They live in this package rather than in the generator script because the
 * script is a consumer of the contract, not a second author of it. A security
 * scheme defined in the script and referenced by a `security` block emitted
 * here would be two files that have to agree; a test in this package asserts
 * every scheme any route names is defined below.
 */

/**
 * A discriminated union rather than one loose object, so a scheme cannot be
 * written with `type: "http"` and an `in` field. OpenAPI's own model is
 * discriminated on `type` and a tool reading a hybrid would pick one half.
 */
export type SecuritySchemeObject =
  | {
      readonly type: "apiKey";
      readonly in: "query" | "header" | "cookie";
      readonly name: string;
      readonly description: string;
    }
  | {
      readonly type: "http";
      readonly scheme: string;
      readonly bearerFormat?: string;
      readonly description: string;
    };

/**
 * All four credentials Counted issues, including the console's.
 *
 * v2's document listed only the two API-key schemes, so every console-only
 * route read as unauthenticated to anyone holding the spec — and the console's
 * session is the credential most requests to this API actually carry.
 *
 * The two key schemes are both `Authorization: Bearer` and are told apart by
 * their prefix, which is a real distinction and not a cosmetic one: an ingest
 * key holds exactly `events:write` and cannot be used for anything else, so a
 * tool that offers the wrong one gets a 403 rather than a confusing 401.
 */
export const SECURITY_SCHEME_DEFINITIONS: Readonly<Record<string, SecuritySchemeObject>> = {
  consoleSession: {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
    description:
      "The console's session cookie, issued by the auth provider at sign-in. Browser callers send it automatically; it is not something to construct by hand.",
  },
  serviceKey: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "sk_...",
    description:
      "A service key. Its permissions are computed at issuance from the issuing member's role and can never exceed them.",
  },
  ingestKey: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "ck_...",
    description:
      "An ingest key. Holds exactly `events:write`, for one project, and is safe to ship inside an application.",
  },
  ingestBeacon: {
    type: "apiKey", in: "query", name: "key",
    description: "A project ingest key in the query string, for sendBeacon and clients unable to set an Authorization header. Prefer bearer authentication when available.",
  },
  shareToken: {
    type: "apiKey",
    in: "query",
    name: "shareToken",
    description:
      "A read-only share link's token. Reaches one dashboard, by identity, and may run only the queries that dashboard's insights name.",
  },
};

export const API_TAGS: readonly { name: string; description: string }[] = [
  { name: "account", description: "Who the caller is." },
  { name: "workspaces", description: "The billing and membership boundary." },
  { name: "members", description: "Workspace members and their roles." },
  { name: "projects", description: "Where events land, claimed or not." },
  { name: "credentials", description: "API keys, their issuance and rotation." },
  { name: "events", description: "Durable event ingestion and per-event receipts." },
  { name: "dashboards", description: "Dashboards, their readouts and share links." },
  { name: "insights", description: "The analyses presented on a dashboard." },
  { name: "monitors", description: "Scalar questions watched against a threshold." },
  { name: "queries", description: "Running a question directly." },
  { name: "share", description: "Public, read-only dashboard links." },
  { name: "billing", description: "Plans, checkout and the billing portal." },
];

export const API_INFO = {
  title: "Counted API",
  version: "1",
  description:
    "Manage workspaces, projects, dashboards, insights, and monitors. Query your events through the same API used by the Counted app. Use a service key for integrations, or open the API Explorer in the app to send requests with your signed-in account.",
} as const;
