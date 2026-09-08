/**
 * The better-auth instance, and the only file that constructs one.
 *
 * Four plugins, and the reason for each:
 *
 *   `organization`  owns `organization`, `member` and `invitation`, and adds
 *                   `activeOrganizationId` to the session. A better-auth
 *                   organization and a domain workspace share an id and mean
 *                   different things — who belongs here, versus what plan and
 *                   what limits.
 *   `api-key`       two configurations, one per credential kind. See below.
 *   `jwt`           not optional: the MCP/OAuth provider signs access tokens
 *                   with it and throws `jwt_config` at construction without it.
 *   `mcp`           the OAuth 2.1 authorization server an agent authenticates
 *                   against.
 *
 * plus `countedPlacement`, which is ours and adds columns rather than routes.
 *
 * ### Why two `configId`s rather than one plugin with a prefix argument
 *
 * The kinds differ in more than their prefix. An ingest key is public — it
 * ships inside a browser bundle — so it is rate-limited and its permission set
 * is a constant. A service key is secret, lives on a server, and carries
 * whatever its issuer's role already grants. Those are two different
 * configurations of the same machinery, which is exactly what `configId` is
 * for, and it means the kind is an indexed column rather than a string
 * comparison on the secret.
 *
 * **There is deliberately no `default` configuration.** The plugin throws
 * `NO_DEFAULT_API_KEY_CONFIGURATION_FOUND` when a call omits `configId`, so a
 * key that belongs to neither kind cannot be minted by forgetting an argument.
 *
 * ### `defaultPermissions` is the only place a key's permissions are written
 *
 * `permissions` is a server-only property in `@better-auth/api-key`: a request
 * carrying headers is rejected outright with `SERVER_ONLY_PROPERTY`. That is a
 * stronger fix than checking a grant subset, because the field the escalation
 * needed no longer reaches the code. What fills the gap is
 * `permissions.defaultPermissions`, called with the owning entity's id and the
 * endpoint context, which is where the injected `CredentialGrants` runs.
 *
 * The callback reads the workspace out of the request metadata rather than
 * from `referenceId`, because `references` is `"user"` here: a key belongs to
 * the account whose authority it carries, which is what makes the key
 * attributable after that account's role changes. The workspace it is *placed*
 * on is a separate fact, and `placement.ts` explains where it is stored.
 *
 * ### Sign-in is rate limited per client address, in memory only
 *
 * better-auth's limiter is switched on explicitly — its own default is
 * "production only", which is how a staging environment ships without one —
 * and keyed on `${address}|${path}`. Its bounded, expiring memory store keeps
 * addresses out of the database. Limits apply per API process and reset on
 * restart; multiple replicas do not share one counter. `/sign-in/*` and `/sign-up/*` — password,
 * magic-link request and social alike — get `signInRateLimit`, five a minute
 * by default; every other path keeps the vendor's own rules. Server-side
 * calls through `auth.api` are not limited: the limiter runs in the HTTP
 * router's `onRequest`, so it counts callers and never this process.
 *
 * The address it keys on is the one `config.clientAddress` resolves, written
 * into `CLIENT_ADDRESS_HEADER` by `handler.ts` and read from nowhere else
 * (`advanced.ipAddress.ipAddressHeaders`). better-auth has no hook for a
 * custom address source: it has a list of headers to read and, for a
 * forwarded chain, a list of trusted proxy *addresses* to skip. Counted's
 * rule is a trusted hop *count* (`COUNTED_TRUSTED_PROXY_HOPS`, read from the
 * right of `X-Forwarded-For` in `apps/api/src/ingest/client-ip.ts`), so the
 * composition root resolves the address with that rule and better-auth is
 * told to trust exactly the header this process wrote. A request whose
 * address cannot be resolved lands in one shared bucket — which is better
 * than trusting the caller's own claim about who they are.
 *
 * ### A session outlives a browser restart
 *
 * `session.expiresIn` is thirty days and the cookie carries it as `Max-Age`,
 * so it is a persistent cookie rather than a session cookie unless the
 * sign-in asked for `rememberMe: false`. `updateAge` of a day means an active
 * session's expiry slides at most once a day, not on every request.
 */

import { ALL_PERMISSIONS, AccountId, Duration, isPermission, unbrand, type WorkspaceId } from "@counted/kernel";
import {
  CREDENTIAL_HINT_REVEALED,
  CREDENTIAL_PREFIX,
  type CredentialKind,
} from "@counted/identity-ports";
import { apiKey } from "@better-auth/api-key";
import { mcp } from "@better-auth/mcp";
import { getOAuthProviderApi } from "@better-auth/oauth-provider";
import { APIError, createAuthEndpoint, createAuthMiddleware, isAPIError } from "better-auth/api";
import * as z from "zod";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { getSchema } from "better-auth/db";
import { genericOAuth, jwt, magicLink, organization } from "better-auth/plugins";
import type { IdentityConfig, IdentityLogLevel } from "./config";
import { toStatements, type PermissionStatements } from "./permissions";
import { CONFIG_ID, countedPlacement } from "./placement";
import { roleFrom } from "./role";

/** 600 requests a minute: a busy single page, nowhere near a scraper. */
const DEFAULT_INGEST_RATE_LIMIT = { window: Duration.minutes(1), maxRequests: 600 } as const;

/** Five attempts a minute from one address: a mistyped password twice over, never a credential stuffer. */
const DEFAULT_SIGN_IN_RATE_LIMIT = { window: Duration.minutes(1), maxRequests: 5 } as const;

/** Thirty days: a session survives a browser restart and a fortnight away. */
const SESSION_LIFETIME = Duration.days(30);

/** An active session's expiry slides at most daily, so a busy user costs no write per request. */
const SESSION_REFRESH_AGE = Duration.days(1);

/** Where each provider we offer keeps its OAuth endpoints, and what we ask it for. */
const SOCIAL_ENDPOINTS = {
  github: {
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    // What the built-in provider asks for: the profile, and the addresses,
    // because the profile alone may carry none.
    scopes: ["read:user", "user:email"],
  },
  google: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scopes: ["openid", "email", "profile"],
  },
} as const;

type GithubEmail = { readonly email: string; readonly primary: boolean; readonly verified: boolean };

/**
 * GitHub's profile, plus the address that is often not in it.
 *
 * An OIDC provider states the address and whether it is verified. GitHub does
 * neither: `/user` omits the address entirely when the account keeps it
 * private, and never carries a verified flag. So the addresses are a second
 * call — the same one better-auth's built-in provider makes — and the primary
 * one wins. Without an address there is no account to make, and returning null
 * fails the sign-in rather than inventing one.
 */
export const githubUserInfo = async (accessToken: string) => {
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${accessToken}`,
    // GitHub rejects a request that does not name its caller.
    "user-agent": "counted",
  };
  const [profileResponse, emailResponse] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch("https://api.github.com/user/emails", { headers }),
  ]);
  if (!profileResponse.ok) return null;

  const profile = (await profileResponse.json()) as {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string;
  };
  const emails: readonly GithubEmail[] = emailResponse.ok
    ? ((await emailResponse.json()) as GithubEmail[])
    : [];

  const email =
    profile.email ?? emails.find((one) => one.primary)?.email ?? emails[0]?.email ?? null;
  if (email === null) return null;

  return {
    id: String(profile.id),
    email,
    emailVerified: emails.find((one) => one.email === email)?.verified ?? false,
    name: profile.name ?? profile.login,
    image: profile.avatar_url,
  };
};

/**
 * The header the mounted handler stamps the resolved client address into, and
 * the only header better-auth is told to read one from. Private on purpose:
 * `handler.ts` strips any copy the caller sent before writing its own, so the
 * value can only ever be one this process computed with the trusted-hop rule.
 */
export const CLIENT_ADDRESS_HEADER = "x-counted-client-address";

/**
 * What `createApiKey` is told about a key beyond what better-auth models.
 *
 * It travels as request metadata for one reason: `defaultPermissions` needs
 * the workspace to look up the issuer's role, and the endpoint context is the
 * only thing it is handed. The durable copy is written to the placement
 * columns immediately afterwards — see `credential-store.ts`.
 */
export type IssueMetadata = {
  readonly workspaceId: string;
  readonly projectId: string | null;
};

const readMetadata = (body: unknown): IssueMetadata | null => {
  if (body === null || typeof body !== "object") return null;
  const metadata = (body as { metadata?: unknown }).metadata;
  if (metadata === null || typeof metadata !== "object") return null;
  const workspaceId = (metadata as { workspaceId?: unknown }).workspaceId;
  if (typeof workspaceId !== "string" || workspaceId.length === 0) return null;
  const projectId = (metadata as { projectId?: unknown }).projectId;
  return { workspaceId, projectId: typeof projectId === "string" ? projectId : null };
};

/** The instance, plus the pieces of it this package needs to hold on to. */
export type IdentityAuth = ReturnType<typeof createIdentityAuth>;

export const createIdentityAuth = (config: IdentityConfig) => {
  const rateLimit = config.ingestRateLimit ?? DEFAULT_INGEST_RATE_LIMIT;
  const signIn = config.signInRateLimit ?? DEFAULT_SIGN_IN_RATE_LIMIT;
  /** better-auth counts a window in whole seconds. */
  const signInRule = {
    window: Math.max(1, Math.ceil(Duration.toSeconds(signIn.window))),
    max: signIn.maxRequests,
  };

  /**
   * The permission set for a key of `kind` about to be issued.
   *
   * Deliberately *not* a second table and *not* a second ceiling. It is the
   * `CredentialGrants` the composition root injected — the same derivation the
   * in-memory fake and the port contract suite are given. This closure is the
   * only thing in the adapter that produces a permission set.
   */
  const derive = async (
    kind: CredentialKind,
    issuedBy: string,
    workspaceId: string,
  ): Promise<PermissionStatements> => {
    const role = roleFrom(await roleStringOf(issuedBy, workspaceId));
    if (role === null) return {};
    return toStatements(config.grants(kind, role));
  };

  /**
   * The issuer's role, read straight off the member table.
   *
   * `MembershipDirectory` would be the natural caller, but it is built from
   * this instance and would close a construction cycle. The read is one row by
   * two equalities; the directory does the same thing and both go through
   * `roleFrom`, which is where the translation actually lives.
   */
  const roleStringOf = async (userId: string, organizationId: string): Promise<string | null> => {
    const ctx = await auth.$context;
    const row = await ctx.adapter.findOne<{ role?: string | null }>({
      model: "member",
      where: [
        { field: "userId", value: userId },
        { field: "organizationId", value: organizationId },
      ],
    });
    return row?.role ?? null;
  };

  const keyConfiguration = (kind: CredentialKind) =>
    ({
      configId: CONFIG_ID[kind],
      defaultPrefix: CREDENTIAL_PREFIX[kind],
      defaultKeyLength: 64,
      /** Long enough for "production ingest — marketing site". */
      maximumNameLength: 64,
      /** The workspace travels here so `defaultPermissions` can find it. */
      enableMetadata: true,
      /**
       * `start` is what a key list shows. Sized to prefix plus
       * `CREDENTIAL_HINT_REVEALED` so `${start}…` is exactly the hint
       * `credentialHint` computes from the secret — which is what lets `list`
       * produce a hint without ever having seen one.
       */
      startingCharactersConfig: {
        shouldStore: true,
        charactersLength: CREDENTIAL_PREFIX[kind].length + CREDENTIAL_HINT_REVEALED,
      },
      rateLimit:
        kind === "ingest"
          ? {
              enabled: true,
              timeWindow: Duration.toMillis(rateLimit.window),
              maxRequests: rateLimit.maxRequests,
            }
          : { enabled: false },
      /**
       * A key represents the account whose authority it carries, not the
       * organization it acts in. `references: "organization"` would make the
       * organization the owner and route creation through better-auth's own
       * `apiKey` access-control statement — a second grant table, which is
       * precisely what `accesscontrol` is meant to be the only one of.
       */
      references: "user" as const,
      permissions: {
        defaultPermissions: async (referenceId: string, ctx: { body?: unknown }) => {
          const metadata = readMetadata(ctx.body);
          if (metadata === null) return {};
          return derive(kind, referenceId, metadata.workspaceId);
        },
      },
    }) as const;

  /**
   * Re-hosts a URL we are about to hand a browser onto the origin a browser
   * actually uses. See `browserOrigin` for why the session depends on it.
   *
   * The path is kept and only the origin moves — the console proxies this
   * family through on the same path, so the two differ in nothing else. The
   * mirror image of `forwardedLocation` in the console, which walks a redirect
   * back the other way. Anything not on our own origin is left alone: a
   * provider's hosted page is not ours to rewrite.
   */
  const forBrowser = (url: string): string => {
    if (config.browserOrigin === undefined) return url;
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return url;
    }
    if (target.origin !== new URL(config.baseURL).origin) return url;
    return new URL(
      `${target.pathname}${target.search}${target.hash}`,
      new URL(config.browserOrigin).origin,
    ).toString();
  };

  /**
   * Each provider's endpoints, its scopes, and where it sends the browser back.
   *
   * Declared as *generic* OAuth rather than through better-auth's built-in
   * `socialProviders`, and the reason is that last part. A built-in provider's
   * `redirect_uri` is pinned to `baseURL` — the API's origin — and neither
   * GitHub's implementation nor Google's reads an override, so the browser
   * would come back to the API and the session cookie would be set on an
   * origin the console cannot read: a sign-in that appears to work and leaves
   * no session. A generic provider honours `redirectURI` on both halves of the
   * flow, the authorization request and the token exchange, and both halves
   * must agree or the provider rejects the exchange.
   *
   * Nothing else about them changes. The plugin registers them as ordinary
   * social providers, so `/sign-in/social` and `/callback/<provider>` are the
   * routes they always were, and an account keeps the same `providerId`.
   */
  const oauthProviders = (config.socialSignIn ?? []).map((provider) => ({
    ...SOCIAL_ENDPOINTS[provider.provider],
    scopes: [...SOCIAL_ENDPOINTS[provider.provider].scopes],
    providerId: provider.provider,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    redirectURI: forBrowser(`${config.baseURL.replace(/\/+$/, "")}/callback/${provider.provider}`),
    ...(provider.provider === "github"
      ? {
          getUserInfo: (tokens: { accessToken?: string | undefined }) =>
            githubUserInfo(tokens.accessToken ?? ""),
        }
      : {}),
  }));

  const sendMagicLink = async ({ email, url }: { email: string; url: string }) => {
    const link = forBrowser(url);
    const message = config.magicLinkMessage?.({ url: link, email }) ?? {
      subject: "Your Counted sign-in link",
      body: `Sign in to Counted: ${link}\n\nIf you did not ask for this, ignore it.`,
    };
    await config.notifier.deliver({ channel: "email", to: email, ...message });
  };

  /**
   * `memoryAdapter` throws on the first read of a model whose array is not
   * there, and the OAuth provider reads one while the context is being built.
   * The tables are therefore seeded from the schema the options themselves
   * produce — `getSchema(auth.options)` rather than a hand-written list, so a
   * plugin added later cannot make the tests fail with "Model not found".
   * Safe to do after construction: `$context` is built on first await.
   */
  const tables: Record<string, unknown[]> =
    config.database.kind === "memory" ? (config.database.tables ?? {}) : {};

  /**
   * `mcp()`'s own object is not assignable to better-auth's `BetterAuthPlugin`
   * under `exactOptionalPropertyTypes`: one of the OAuth endpoints declares an
   * OpenAPI parameter whose `schema.items` is inferred as `undefined`, and the
   * vendor's `OpenAPIParameter` requires the property to be absent rather than
   * present-and-undefined. It is a defect in the library's own types, not in
   * how it is called, and it is invisible to anyone whose tsconfig is looser.
   *
   * Only the endpoint map is erased, and only because nothing in this package
   * calls an MCP endpoint by name — they are reached over HTTP through
   * `auth.handler`. Erasing the whole plugin instead would collapse the
   * plugins array to `BetterAuthPlugin[]` and take `auth.api.createApiKey`
   * with it.
   */
  const mcpPlugin = mcp({
    resource: config.mcpResource,
    loginPage: config.loginPage ?? "/sign-in",
    consentPage: config.consentPage ?? "/consent",
    scopes: ["openid", "profile", "email", "offline_access", ...ALL_PERMISSIONS],
    grantTypes: ["authorization_code", "refresh_token"],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    allowPublicClientPrelogin: true,
    // Registration is open, but an ordinary account may never administer
    // another application's client or change the API's trusted resources.
    clientPrivileges: ({ action }) => action === "create",
    resourcePrivileges: () => false,
    extensions: [{
      claims: {
        accessToken: async ({ ctx, user, client }) => {
          if (!user) return {};
          const consent = await ctx.context.adapter.findOne<{ id: string }>({ model: "oauthConsent", where: [{ field: "userId", value: user.id }, { field: "clientId", value: client.clientId }] });
          return { counted_consent_id: consent?.id ?? null };
        },
      },
    }],
  }) as unknown as Omit<ReturnType<typeof mcp>, "endpoints"> & {
    /** An endpoint map with no named endpoints: they are reached over HTTP. */
    endpoints: Record<never, never>;
  };

  const oauthBridge = {
    id: "counted-oauth-principal",
    endpoints: {
      countedOAuthPrincipal: createAuthEndpoint("/counted/oauth-principal", {
        method: "POST",
        body: z.object({ token: z.string() }),
        metadata: { SERVER_ONLY: true },
      }, async (ctx) => {
        let payload;
        try { payload = await getOAuthProviderApi(ctx, mcpPlugin.options).requireActiveAccessToken(ctx.body.token); }
        catch (error) {
          // Invalid tokens are anonymous; infrastructure faults must remain
          // failures, rather than send a signed-in person around a login loop.
          if (isAPIError(error) && error.statusCode < 500) return null;
          if (error instanceof Error && ["JWTExpired", "JWTInvalid", "JWSSignatureVerificationFailed", "JWSInvalid"].includes(error.name)) return null;
          throw error;
        }
        const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        if (!audiences.includes(config.mcpResource) || typeof payload.sub !== "string" || typeof payload.client_id !== "string" || payload.cnf !== undefined) return null;
        const user = await ctx.context.internalAdapter.findUserById(payload.sub);
        if (!user) return null;
        // Consent removal is immediate, including for already-issued JWTs.
        const consent = await ctx.context.adapter.findOne<{ id: string; scopes: string[] }>({ model: "oauthConsent", where: [{ field: "userId", value: user.id }, { field: "clientId", value: payload.client_id }] });
        if (!consent || payload.counted_consent_id !== consent.id) return null;
        const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
        return { account: AccountId(user.id), permissions: scopes.filter((scope) => isPermission(scope) && consent.scopes.includes(scope)) as import("@counted/kernel").Permission[] };
      }),
    },
    hooks: {
      before: [{
        matcher: (ctx: { path?: string }) => ctx.path === "/oauth2/delete-consent",
        handler: createAuthMiddleware(async (ctx) => {
          const session = await auth.api.getSession({ headers: ctx.headers ?? new Headers() });
          if (!session || typeof ctx.body?.id !== "string") return;
          const consent = await ctx.context.adapter.findOne<{ userId: string; clientId: string }>({ model: "oauthConsent", where: [{ field: "id", value: ctx.body.id }] });
          if (!consent || consent.userId !== session.user.id) return;
          // Revoke the refresh family too: it must not mint new access after
          // the person disconnects this application.
          for (const model of ["oauthRefreshToken", "oauthAccessToken"]) await ctx.context.adapter.deleteMany({ model, where: [{ field: "userId", value: consent.userId }, { field: "clientId", value: consent.clientId }] });
        }),
      }],
    },
  };

  const auth = betterAuth({
    baseURL: config.baseURL,
    trustedOrigins: [...(config.trustedOrigins ?? [])],
    secret: config.secret,
    ...(config.log === undefined
      ? {}
      : {
          logger: {
            disabled: false,
            level: "debug" as const,
            log: (level: IdentityLogLevel, message: string, ...details: unknown[]) => {
              config.log?.(level, message, details);
            },
          },
        }),
    database:
      config.database.kind === "postgres"
        ? config.database.pool
        : memoryAdapter(tables as Parameters<typeof memoryAdapter>[0]),
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await config.notifier.deliver({
          channel: "email",
          to: user.email,
          subject: "Reset your Counted password",
          body: `Choose a new password: ${forBrowser(url)}\n\nIf you did not request this, ignore this email. Your password has not changed.`,
        });
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          const context = await auth.$context;
          const membership = await context.adapter.findOne({ model: "member", where: [{ field: "userId", value: user.id }] });
          if (membership) throw new APIError("FORBIDDEN", { message: "Leave your workspaces before deleting your account. Transfer ownership first if you are the last owner." });
        },
      },
    },
    session: {
      expiresIn: Duration.toSeconds(SESSION_LIFETIME),
      updateAge: Duration.toSeconds(SESSION_REFRESH_AGE),
    },
    // Better Auth otherwise copies these request headers into every login
    // session. Authentication needs a token, not a stored network/device profile.
    databaseHooks: {
      session: {
        create: { before: async () => ({ data: { ipAddress: null, userAgent: null } }) },
        update: { before: async () => ({ data: { ipAddress: null, userAgent: null } }) },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "memory",
      customRules: {
        "/sign-in/*": signInRule,
        "/sign-up/*": signInRule,
      },
    },
    ...(config.clientAddress === undefined
      ? {}
      : { advanced: { ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] } } }),
    emailVerification: {
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        await config.notifier.deliver({
          channel: "email",
          to: user.email,
          subject: "Confirm your email address",
          body: `Confirm your Counted account: ${forBrowser(url)}`,
        });
      },
    },
    plugins: [
      countedPlacement(),
      jwt(),
      organization({
        // Seat entitlements belong to Counted's plan catalog. There is no
        // separate, implicit 100-member ceiling in the identity provider.
        membershipLimit: Number.MAX_SAFE_INTEGER,
        sendInvitationEmail: async ({ id, email, organization, inviter, role }) => {
          const link = new URL(`/invitations/${encodeURIComponent(id)}`, config.browserOrigin ?? config.baseURL);
          await config.notifier.deliver({
            channel: "email",
            to: email,
            subject: `Join ${organization.name} on Counted`,
            body: `${inviter.user.name || inviter.user.email} invited you to ${organization.name} as ${role}.\n\nReview and accept the invitation: ${link}\n\nThis invitation expires in 48 hours. If you were not expecting it, ignore this email.`,
          });
        },
      }),
      genericOAuth({ config: oauthProviders }),
      magicLink({ sendMagicLink }),
      apiKey([keyConfiguration("ingest"), keyConfiguration("service")]),
      mcpPlugin,
      oauthBridge,
    ],
  });

  if (config.database.kind === "memory") {
    for (const model of Object.keys(getSchema(auth.options as BetterAuthOptions))) {
      tables[model] ??= [];
    }
  }

  return {
    auth,
    /** The instant-agnostic permission derivation, exposed for `issue`'s refusal check. */
    derive,
    rateLimit,
    lastUsedResolution: config.lastUsedResolution ?? Duration.minutes(5),
    /** How the mounted handler finds the caller's address, or null to let better-auth read the header itself. */
    clientAddress: config.clientAddress ?? null,
    emailDelivery: config.emailDelivery ?? true,
    database: config.database,
    administersWorkspace: async (account: string, workspace: string) => {
      const role = roleFrom(await roleStringOf(account, workspace));
      return role !== null && config.rolePermissions(role).includes("workspace:admin");
    },
  };
};

/** Narrow helpers so the rest of the package never spells a branded id out. */
export const asAccountKey = (account: AccountId): string => unbrand(account);
export const asWorkspaceKey = (workspace: WorkspaceId): string => unbrand(workspace);
