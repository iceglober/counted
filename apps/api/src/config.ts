/**
 * Everything the server has to be told, in one type, read once at startup.
 *
 * Nothing below reads `process.env` a second time. v1 read environment
 * variables at the point of use — `process.env.STRIPE_WEBHOOK_SECRET` inside
 * the webhook handler — so a missing secret was discovered by the first
 * customer to pay, at 02:00, as a 500. Reading them here means a deployment
 * with a hole in it fails to start, which is the only failure mode an operator
 * can act on before it costs anything.
 *
 * `loadConfig` returns a `Result` rather than throwing so the caller decides
 * what a bad environment means. `main.ts` prints every problem and exits;
 * a test builds the object directly and never touches the environment at all.
 */

import {
  AccountId,
  Duration,
  WorkspaceId,
  err,
  ok,
  type AccountId as AccountIdType,
  type Result,
  type WorkspaceId as WorkspaceIdType,
} from "@counted/kernel";

import { DEFAULT_TRUSTED_PROXY_HOPS } from "./ingest/client-ip";

export type ApiConfig = {
  readonly port: number;
  /**
   * The origin this API answers on. better-auth issues cookies and OAuth
   * redirects against it, so a wrong value produces sign-ins that appear to
   * work and then have no session.
   */
  readonly baseUrl: string;
  /**
   * The OAuth resource identifier MCP tokens are bound to: the MCP server's
   * own public URL plus `/mcp`. Defaults to `${baseUrl}/mcp` for a deployment
   * that serves both from one origin; set `COUNTED_MCP_URL` when the MCP
   * server has an origin of its own, and give the server the same string as
   * `COUNTED_MCP_RESOURCE`.
   */
  readonly mcpResource: string;
  /** Where the console lives. Checkout and the billing portal return here. */
  readonly consoleUrl: string;

  readonly databaseUrl: string;
  /**
   * Where analytics reads connect. Defaults to `DATABASE_URL`. Set it to the
   * direct (non-pooled) host on Neon and similar: bulk segment reads through a
   * transaction-mode pooler were measured slower in parallel than in series,
   * and `LISTEN` does not work through one at all.
   */
  readonly databaseDirectUrl: string;
  /**
   * Bytes of decoded analytics segments kept in memory per replica. A segment
   * is ~10k events; 256 MiB holds a busy project's recent months and is what
   * makes the second dashboard load faster than the first.
   */
  readonly segmentCacheBytes: number;
  readonly authSecret: string;

  readonly stripe: {
    readonly secretKey: string;
    readonly webhookSecret: string;
    readonly prices: {
      readonly pro: { readonly monthly: string; readonly annual: string };
    };
    /**
     * Where the payment provider's API lives, when it is not the provider.
     *
     * `stripe-mock` and the end-to-end journey suite. Optional, and outside
     * the all-or-nothing group above because it is not part of "is billing
     * configured" — it only redirects a configuration that already exists.
     * Unset in production.
     */
    readonly apiBase: string | null;
  } | null;

  readonly email: { readonly apiKey: string; readonly from: string } | null;

  /**
   * Social sign-in. Each provider is a client id and a secret, and each pair
   * is all-or-nothing for the same reason Stripe is: an id with no secret is
   * a button that fails after the redirect, which is worse than no button.
   * `null` means the console does not offer that provider.
   */
  readonly social: {
    readonly github: SocialProviderCredentials | null;
    readonly google: SocialProviderCredentials | null;
  };

  /** Signs outbound monitor webhooks. Standard Webhooks, see @counted/adapter-notify. */
  readonly outboundWebhookSecret: string | null;

  /**
   * The workspace an unclaimed project's ingest key is issued against.
   *
   * `IssueRequest.workspace` and `VerifiedCredential.workspace` are both
   * non-nullable in `@counted/identity-ports`, and a project provisioned
   * through the no-signup path has no workspace by definition — so the key has
   * to be issued *somewhere*. This is that somewhere: a workspace that owns
   * nothing and bills nobody, which `ensureHoldingWorkspace` creates at boot
   * if it is not there. It used to have to be created by hand, which meant it
   * could not exist at first boot and anonymous provisioning failed on every
   * database nobody had seeded.
   *
   * It is not a loophole. The ingest principal's binding is built from the
   * project's *current* workspace, not the credential's recorded one (see
   * `auth/principal.ts`), so a key issued here reaches exactly one project and
   * keeps working after that project is claimed into a real workspace. Without
   * that, claiming would silently revoke the key the customer had just been
   * told to paste — which is v1's provisioning bug wearing a new hat.
   */
  readonly unclaimedWorkspace: WorkspaceIdType;
  /**
   * The account recorded as having issued an unclaimed project's ingest key.
   *
   * `IssueRequest.issuedBy` is not nullable, and an anonymous provision has no
   * issuer. The installation issued the key, and that is what an audit line
   * should say. Created at boot alongside the workspace when absent — a named
   * account with an unroutable address, unverified and with no credential row,
   * so nobody can sign in as it. Not a synthetic id: v1 wrote `userId: ""`
   * into `created_by` for exactly this case and the rows are still there.
   * Point it at your own account and nothing is created.
   */
  readonly unclaimedWorkspaceOwner: AccountIdType;

  /** How long a provisioned project may go unclaimed before its grant lapses. */
  readonly claimGrantTtl: Duration;
  /** Default life of a share link when the request does not say. */
  readonly shareLinkTtl: Duration;
  /** Per-question engine budget when the request does not say. */
  readonly queryDeadline: Duration;

  /**
   * How many reverse proxies append to `X-Forwarded-For` in front of this
   * server. One by default, which is the deployed topology: the platform edge.
   *
   * This is the number that decides whether a client can lie about its country.
   * The address is read that many entries back from the *end* of the list, so a
   * value the caller invented sits harmlessly at the front — see
   * `ingest/client-ip.ts`. Set it too high and no country is derived; set it
   * too low and the last trusted proxy's own address is read as the client's.
   *
   * `0` turns geography off. Correct for an install where nothing in front is
   * trusted to set the header, and the honest answer there is no country at
   * all rather than whatever the client typed.
   */
  readonly trustedProxyHops: number;

  readonly logLevel: LogLevel;
  /** Set on responses so a customer can quote one number in a support ticket. */
  readonly serviceName: string;
  /**
   * The build this process is: the git SHA the deploy workflow set as
   * `RELEASE`, or `RAILWAY_GIT_COMMIT_SHA` where Railway built the service
   * from GitHub itself, or empty for a local run. Both health paths report it,
   * so "which commit is serving" is a `curl` rather than a dashboard — and a
   * rollback can be confirmed from outside.
   */
  readonly release: string;
};

export type SocialProviderCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
};

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export type ConfigProblem = {
  readonly variable: string;
  readonly detail: string;
};

export type Environment = Readonly<Record<string, string | undefined>>;

const required = (env: Environment, name: string, problems: ConfigProblem[]): string => {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    problems.push({ variable: name, detail: "is required and was empty" });
    return "";
  }
  return value;
};

/**
 * The first of several names that is set, or empty. For a value that is
 * informational rather than required — nothing about it is a problem to
 * report, so it takes no problems list.
 */
const firstSet = (env: Environment, names: readonly string[]): string => {
  for (const name of names) {
    const value = env[name]?.trim() ?? "";
    if (value.length > 0) return value;
  }
  return "";
};

const integer = (
  env: Environment,
  name: string,
  fallback: number,
  problems: ConfigProblem[],
): number => {
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    problems.push({ variable: name, detail: `expected a non-negative integer, got ${raw}` });
    return fallback;
  }
  return parsed;
};

/**
 * A URL with no trailing slash.
 *
 * The slash matters: `${baseUrl}/api/auth` against a base that already ends in
 * one produces `//api/auth`, which better-auth's own origin check treats as a
 * different origin and refuses.
 */
const url = (env: Environment, name: string, problems: ConfigProblem[]): string => {
  const raw = required(env, name, problems);
  if (raw === "") return raw;
  try {
    const parsed = new URL(raw);
    return parsed.origin + parsed.pathname.replace(/\/+$/, "");
  } catch {
    problems.push({ variable: name, detail: `expected an absolute URL, got ${raw}` });
    return raw;
  }
};

/**
 * A group of variables that is all-or-nothing.
 *
 * Stripe with a secret key and no webhook secret is worse than Stripe absent:
 * checkout works, the webhook that grants the plan does not, and the customer
 * has paid for nothing. That is v1's failure exactly, and this is why the group
 * is refused rather than half-configured.
 */
const group = <T>(
  name: string,
  names: readonly string[],
  env: Environment,
  build: (read: (n: string) => string) => T,
  problems: ConfigProblem[],
): T | null => {
  const present = names.filter((n) => (env[n] ?? "").trim().length > 0);
  if (present.length === 0) return null;
  if (present.length !== names.length) {
    const missing = names.filter((n) => !present.includes(n));
    problems.push({
      variable: name,
      detail: `is partially configured; missing ${missing.join(", ")}`,
    });
    return null;
  }
  return build((n) => env[n] as string);
};

export const loadConfig = (env: Environment): Result<ApiConfig, readonly ConfigProblem[]> => {
  const problems: ConfigProblem[] = [];

  const logLevelRaw = env.LOG_LEVEL ?? "info";
  if (!LOG_LEVELS.includes(logLevelRaw as LogLevel)) {
    problems.push({ variable: "LOG_LEVEL", detail: `expected one of ${LOG_LEVELS.join(", ")}` });
  }

  const baseUrl = url(env, "COUNTED_API_URL", problems);
  const config: ApiConfig = {
    port: integer(env, "PORT", 3001, problems),
    baseUrl,
    mcpResource: env["COUNTED_MCP_URL"] ?? `${baseUrl}/mcp`,
    consoleUrl: url(env, "COUNTED_CONSOLE_URL", problems),
    databaseUrl: required(env, "DATABASE_URL", problems),
    databaseDirectUrl: env["COUNTED_DATABASE_DIRECT_URL"] ?? env["DATABASE_URL"] ?? "",
    segmentCacheBytes: integer(env, "COUNTED_SEGMENT_CACHE_MB", 256, problems) * 1024 * 1024,
    authSecret: required(env, "COUNTED_AUTH_SECRET", problems),

    stripe: group(
      "STRIPE_*",
      [
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "STRIPE_PRICE_PRO_MONTHLY",
        "STRIPE_PRICE_PRO_ANNUAL",
      ],
      env,
      (read) => ({
        secretKey: read("STRIPE_SECRET_KEY"),
        webhookSecret: read("STRIPE_WEBHOOK_SECRET"),
        prices: {
          pro: {
            monthly: read("STRIPE_PRICE_PRO_MONTHLY"),
            annual: read("STRIPE_PRICE_PRO_ANNUAL"),
          },
        },
        apiBase: (env.STRIPE_API_BASE ?? "").trim() === "" ? null : (env.STRIPE_API_BASE as string),
      }),
      problems,
    ),

    email: group(
      "RESEND_*",
      ["RESEND_API_KEY", "COUNTED_MAIL_FROM"],
      env,
      (read) => ({ apiKey: read("RESEND_API_KEY"), from: read("COUNTED_MAIL_FROM") }),
      problems,
    ),

    social: {
      github: group(
        "GITHUB_*",
        ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
        env,
        (read) => ({ clientId: read("GITHUB_CLIENT_ID"), clientSecret: read("GITHUB_CLIENT_SECRET") }),
        problems,
      ),
      google: group(
        "GOOGLE_*",
        ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        env,
        (read) => ({ clientId: read("GOOGLE_CLIENT_ID"), clientSecret: read("GOOGLE_CLIENT_SECRET") }),
        problems,
      ),
    },

    outboundWebhookSecret: env.COUNTED_WEBHOOK_SIGNING_SECRET ?? null,

    unclaimedWorkspace: WorkspaceId(required(env, "COUNTED_UNCLAIMED_WORKSPACE_ID", problems)),
    unclaimedWorkspaceOwner: AccountId(
      required(env, "COUNTED_UNCLAIMED_WORKSPACE_OWNER_ID", problems),
    ),

    trustedProxyHops: integer(
      env,
      "COUNTED_TRUSTED_PROXY_HOPS",
      DEFAULT_TRUSTED_PROXY_HOPS,
      problems,
    ),

    claimGrantTtl: Duration.hours(integer(env, "COUNTED_CLAIM_GRANT_HOURS", 72, problems)),
    shareLinkTtl: Duration.days(integer(env, "COUNTED_SHARE_LINK_DAYS", 30, problems)),
    queryDeadline: Duration.millis(integer(env, "COUNTED_QUERY_DEADLINE_MS", 10_000, problems)),

    logLevel: LOG_LEVELS.includes(logLevelRaw as LogLevel) ? (logLevelRaw as LogLevel) : "info",
    serviceName: env.COUNTED_SERVICE_NAME ?? "counted-api",
    release: firstSet(env, ["RELEASE", "RAILWAY_GIT_COMMIT_SHA"]),
  };

  return problems.length > 0 ? err(problems) : ok(config);
};
