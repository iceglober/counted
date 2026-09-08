/**
 * Everything the composition root has to decide, expressed without naming
 * better-auth once.
 *
 * That constraint is the point of the file. `apps/api` builds this object and
 * hands it over; if any field here were a better-auth type, every app that
 * configures identity would import the vendor and the
 * `only-the-identity-adapter-knows-better-auth` rule would be a rule about one
 * import statement rather than about the boundary.
 *
 * The one exception is `IdentityDatabase.pool`, which is a `pg.Pool`. That is
 * not a leak of the vendor — it is the deliberate statement that better-auth
 * and `@counted/adapter-postgres` point at *the same database*, which is the
 * precondition that makes the organization write and the workspace write
 * commit together. See `provisioning.ts`.
 */

import type {
  AccountId,
  Duration,
  Instant,
  Permission,
  ProjectId,
  Role,
  WorkspaceId,
} from "@counted/kernel";
import type { IdGenerator, Notifier } from "@counted/kernel/ports";
import type { CredentialGrants } from "@counted/identity-ports";
import type { Pool } from "pg";

/**
 * Where the identity tables live.
 *
 * `memory` exists so the port contract suites can run against a real
 * better-auth instance with no database. It is not a deployment mode: it
 * forgets everything when the process ends, and `provisionWorkspace` still
 * runs its two writes in one transaction there, which is what makes the
 * rollback test meaningful.
 */
export type IdentityDatabase =
  | { readonly kind: "postgres"; readonly pool: Pool }
  | { readonly kind: "memory"; readonly tables?: Record<string, unknown[]> };

/** A social identity provider the console offers. */
export type SocialSignIn = {
  readonly provider: "github" | "google";
  readonly clientId: string;
  readonly clientSecret: string;
};

/**
 * Where a project sits, as identity needs to see it.
 *
 * Two states and not a nullable workspace, because the two nulls this replaced
 * meant different things and the code could not tell them apart: `workspaceOf`
 * returned `null` both for "no such project" and for "provisioned through the
 * no-signup path and not claimed yet". `issue` read the second as the first
 * and refused every credential an unclaimed project ever asked for, which made
 * `POST /v1/projects/provision` a permanent 404 — the route compiled, was
 * covered by the census test, and had never once succeeded.
 */
export type ProjectPlacement =
  | { readonly kind: "claimed"; readonly workspace: WorkspaceId }
  /** Provisioned anonymously and not yet adopted. See `holdingWorkspace`. */
  | { readonly kind: "unclaimed" };

/**
 * The placement of a project.
 *
 * Identity has to answer `NoSuchProject` at issuance and cannot: projects are
 * the projects context's aggregate and better-auth has never heard of them.
 * Rather than import `@counted/projects-ports` and close its generic
 * `ProjectRepository`, this is the single read identity actually needs, named
 * for the question it answers. The composition root implements it over the
 * project repository in three lines.
 */
export interface ProjectPlacements {
  /** Null when there is no such project. Never throws for an unknown id. */
  placementOf(project: ProjectId): Promise<ProjectPlacement | null>;
}

/**
 * How a rate limit is configured: so many requests inside a rolling window.
 * Used for ingest keys, which ship inside browser bundles and are therefore
 * public, and for sign-in, which is the door anybody may knock on.
 */
export type RateLimit = {
  readonly window: Duration;
  readonly maxRequests: number;
};

/**
 * Which rows the holding workspace is, and what to call them if they have to
 * be created. See `holding.ts`.
 */
export type HoldingWorkspaceInput = {
  readonly workspace: WorkspaceId;
  /** The account an anonymously provisioned key is recorded as issued by. */
  readonly owner: AccountId;
  /** Shown to nobody but an operator reading the table. */
  readonly name?: string;
  /** Unique across the installation, like every other organization slug. */
  readonly slug?: string;
  /** Unroutable on purpose: nobody signs in as this account. */
  readonly email?: string;
};

export type IdentityConfig = {
  /**
   * The auth routes' own mount, on the API's origin.
   *
   * This is the authorization server's published identity — the issuer an MCP
   * access token carries and the JWKS URL it is verified against — so it
   * follows the API and not the browser. Where a *browser* is sent is
   * `browserBaseURL`.
   */
  readonly baseURL: string;
  /**
   * The origin a browser reaches these same routes on: the console's, which
   * proxies `/api/auth/*` to the API verbatim.
   *
   * A session cookie belongs to whichever origin the browser received it from.
   * So a link emailed with the API's origin on it signs the reader in *there*,
   * and the console — a different host in production — never sees the cookie:
   * they land signed out on the page they just signed in to. Every URL handed
   * to a browser is therefore re-hosted onto this origin, keeping its path,
   * which is the same path on both sides.
   *
   * Unset means one origin serves both. In development that is effectively
   * true — the two differ only by port, and cookies ignore ports — which is
   * why this fails first in production.
   */
  readonly browserOrigin?: string;
  /**
   * Origins besides `baseURL`'s that may POST to the auth routes — the
   * console's, since it proxies sign-in with the browser's own `Origin`.
   * better-auth refuses a POST whose origin is neither.
   */
  readonly trustedOrigins?: readonly string[];
  /** Cookie and token signing secret. */
  readonly secret: string;
  readonly database: IdentityDatabase;

  /**
   * Kind and role to permissions: the grant table from
   * `@counted/authorization` composed with the credential-kind ceiling from
   * `@counted/projects-domain`.
   *
   * Passed in rather than imported because `accesscontrol` belongs to exactly
   * one package and this is not it, and because a domain package is not
   * something an adapter may reach into either. Every permission set this
   * adapter ever writes onto a key comes through this one function — there is
   * no second table and no second ceiling here to drift from it.
   */
  readonly grants: CredentialGrants;
  /** The shared role grant table, before a credential kind narrows it. */
  readonly rolePermissions: (role: Role) => readonly Permission[];

  /** Where projects live, for the `NoSuchProject` answer. */
  readonly projects: ProjectPlacements;

  /**
   * The workspace every unclaimed project is born into, and the account its
   * keys are attributed to.
   *
   * An anonymously provisioned project belongs to nobody, and a credential
   * still has to be issued *somewhere*: a key's permission set is derived from
   * the issuing account's role, a role only exists inside a workspace, and a
   * key with no workspace would therefore need a second derivation rule beside
   * `CredentialGrants` — which is the one thing `credential-kind.ts` exists to
   * prevent. A holding workspace changes one row; a nullable workspace changes
   * `IssueRequest`, `CredentialSummary`, `VerifiedCredential`, `Binding`, and
   * the rule that computes what a key may carry.
   *
   * So an unclaimed project is *placed here* for the purpose of credential
   * placement, and `issue` refuses a key for an unclaimed project issued
   * against any other workspace. `ensureHoldingWorkspace` creates the rows at
   * boot, so this names something that exists on a database that has never
   * seen a signup.
   *
   * It is not a loophole. An ingest principal's binding is built from the
   * project's *current* workspace, not the key's recorded one (see
   * `apps/api/src/auth/principal.ts`), so a key issued here reaches exactly
   * one project and keeps working after that project is claimed.
   */
  readonly holding: HoldingWorkspaceInput;

  /** Email delivery for magic links and verification. */
  readonly notifier: Notifier;
  /** False when this installation has no email transport. Never report an email as sent. */
  readonly emailDelivery?: boolean;

  /** Ids for anything this adapter mints that better-auth does not. */
  readonly ids: IdGenerator;

  readonly socialSignIn?: readonly SocialSignIn[];

  /**
   * Ingest keys are public and therefore capped. Defaults to 600 requests a
   * minute, which is a busy single page and nowhere near a scraper.
   */
  readonly ingestRateLimit?: RateLimit;

  /**
   * How many sign-in attempts one client address may make. Applies to every
   * `/sign-in/*` and `/sign-up/*` path — password, magic-link request and
   * social alike — and defaults to five a minute: a human who mistyped twice,
   * never a credential stuffer. Counters expire in process memory, so the
   * limit is per API process and resets on restart. See `auth.ts`.
   */
  readonly signInRateLimit?: RateLimit;

  /**
   * The caller's address, resolved behind the deployment's proxies.
   *
   * The in-memory sign-in limiter keys on it, so it has to
   * be the address the last *trusted* proxy saw and not whatever the caller
   * wrote into `X-Forwarded-For`. Only the composition root knows how many
   * proxies there are: `apps/api` answers with the same trusted-hop rule its
   * ingest route uses for geography (`COUNTED_TRUSTED_PROXY_HOPS`), so a lie
   * that cannot pick a country cannot pick a rate-limit bucket either. Null
   * means "cannot tell", and such requests share one bucket. Left out,
   * better-auth reads `X-Forwarded-For` itself and trusts it only when it
   * holds exactly one address.
   */
  readonly clientAddress?: (headers: Headers) => string | null;

  /**
   * How stale `lastUsedAt` is allowed to be before `verify` writes it again.
   *
   * The port says this field is advisory and may lag, which is what lets the
   * ingest hot path avoid a write per event. Defaults to five minutes; set it
   * to zero to write on every verification.
   */
  readonly lastUsedResolution?: Duration;

  /** The MCP server's canonical resource identifier (RFC 8707). */
  readonly mcpResource: string;
  /** Where the MCP OAuth flow sends a signed-out human. */
  readonly loginPage?: string;
  /** Where it asks for consent. */
  readonly consentPage?: string;

  /**
   * Where identity's own diagnostics go.
   *
   * better-auth logs to the console by default, which in a test run is noise
   * and in production is a stream nobody is reading. Routing it through a
   * function keeps the vendor's logger out of the config surface and lets the
   * composition root put these lines wherever the rest of the application's go.
   */
  readonly log?: (level: IdentityLogLevel, message: string, details: readonly unknown[]) => void;

  /**
   * Called when a magic link is requested, if the default email is not wanted.
   * Left out, the notifier gets a plain message.
   */
  readonly magicLinkMessage?: (link: { readonly url: string; readonly email: string }) => {
    readonly subject: string;
    readonly body: string;
  };
};

export type IdentityLogLevel = "info" | "success" | "warn" | "error" | "debug";

/** What a verified session says about the caller. No vendor types. */
export type SessionPrincipal = {
  readonly account: AccountId;
  readonly email: string;
  readonly emailVerified: boolean;
  /** The workspace the console currently has selected, if any. */
  readonly activeWorkspace: WorkspaceId | null;
  readonly expiresAt: Instant;
};

/** Re-exported so callers do not have to reach into the kernel for one word. */
export type { Permission, Role };
