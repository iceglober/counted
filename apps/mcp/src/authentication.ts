/**
 * Authentication — and only authentication.
 *
 * The MCP auth profile makes this server an OAuth 2.0 *resource server*: it
 * publishes RFC 9728 protected-resource metadata so a client can find the
 * authorization server, and it answers `401` with a `WWW-Authenticate`
 * challenge when a request arrives without a live credential. That 401 is the
 * whole trigger for the OAuth flow — a client that never sees one never
 * authenticates, which is why the endpoint requires a bearer even though one
 * exposed tool (`projects.provision`) would accept none.
 *
 * **Liveness is asked of the API, not decided here.** The obvious alternative —
 * fetch the authorization server's JWKS and verify the access token's signature
 * locally — is a second place that decides a token is good. A locally verified
 * but revoked token would be accepted by this server and refused by
 * `apps/api`, which is one question with two answers, and one answer stale.
 * Asking `apps/api` costs one request and leaves `better-auth` the only thing
 * in the system that knows whether a token is live.
 *
 * What this file never does is look at what the token may *do*. There is no
 * scope check, no permission check, no allowlist. `verify` answers exactly one
 * question — is somebody there — and every other question is answered by
 * `packages/authorization` inside `apps/api`, once, for MCP and HTTP alike.
 */

import { permissionOf, requirementFor } from "@counted/contract";
import { EXPOSED } from "./exposure";

/** The `/v1/me` route: any signed-in identity, no permission. The cheapest question that has an answer. */
const IDENTITY_PATH = "/v1/me";

export type Verdict =
  /** Somebody is there. Deliberately carries no scopes: this server has no use for them. */
  | { readonly kind: "live" }
  /** The credential is missing, expired, revoked or unknown — collapsed on purpose, as `@counted/identity-ports` says to. */
  | { readonly kind: "rejected"; readonly because: string }
  /** We could not ask. A 503, not a 401: telling a client to re-authenticate when the API is down sends it round a loop. */
  | { readonly kind: "unreachable"; readonly because: string };

export interface TokenVerifier {
  verify(token: string): Promise<Verdict>;
}

/** `Authorization: Bearer <token>`, or `undefined`. Case-insensitive on the scheme, as RFC 7235 requires. */
export const bearerOf = (request: Request): string | undefined => {
  const header = request.headers.get("authorization");
  if (header === null) return undefined;
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  return match?.[1];
};

export type ApiVerifierOptions = {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
};

/**
 * Asks `apps/api` who the caller is. A 2xx means live; a 401 or 403 means the
 * credential is not usable; anything else means we could not ask.
 *
 * A 403 counts as rejected rather than live because `/v1/me` requires no
 * permission at all — the only way to be refused it is to not be anybody.
 */
export const apiVerifier = (options: ApiVerifierOptions): TokenVerifier => ({
  async verify(token) {
    let response: Response;
    try {
      response = await options.fetch(
        new Request(`${options.baseUrl.replace(/\/$/, "")}${IDENTITY_PATH}`, {
          headers: { accept: "application/json", authorization: `Bearer ${token}` },
        }),
        { signal: AbortSignal.timeout(options.timeoutMs) },
      );
    } catch (cause) {
      return { kind: "unreachable", because: cause instanceof Error ? cause.message : String(cause) };
    }

    if (response.ok) return { kind: "live" };
    if (response.status === 401 || response.status === 403) {
      return { kind: "rejected", because: "The access token is not usable." };
    }
    return { kind: "unreachable", because: `The API answered ${response.status} to an identity check.` };
  },
});

export type ResourceIdentity = {
  /** This server's canonical resource identifier (RFC 8707 / RFC 9728), e.g. `https://mcp.counted.dev/mcp`. */
  readonly resource: string;
  /** The authorization server's issuer URL — `apps/api`'s /api/auth mount. */
  readonly issuer: string;
  /** Advertised in the metadata document so a human can find out what the scopes mean. */
  readonly documentation?: string;
};

/**
 * RFC 9728 §3: `/.well-known/oauth-protected-resource` with the path of the
 * resource appended. `https://mcp.counted.dev/mcp` is served at
 * `https://mcp.counted.dev/.well-known/oauth-protected-resource/mcp`.
 */
export const metadataPathFor = (resource: string): string => {
  const url = new URL(resource);
  const suffix = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `/.well-known/oauth-protected-resource${suffix}`;
};

export const metadataUrlFor = (identity: ResourceIdentity): string =>
  new URL(metadataPathFor(identity.resource), identity.resource).toString();

/**
 * The protected-resource metadata document.
 *
 * OAuth scopes use the contract's existing permission names. Advertising them
 * lets generic MCP clients request usable consent; the API still intersects
 * that consent with the current role on every request. Project provisioning
 * also needs events:write because it issues the first ingest key.
 */
const resourceScopes = [...new Set([
  ...EXPOSED.flatMap(exposure => {
    const requirement = requirementFor(exposure.id.split("."));
    if (!requirement) throw new Error(`Missing authorization declaration for ${exposure.id}`);
    const permission = permissionOf(requirement);
    return permission === null ? [] : [permission];
  }),
  "events:write",
])].sort();

export const protectedResourceMetadata = (identity: ResourceIdentity): Record<string, unknown> => ({
  resource: identity.resource,
  authorization_servers: [identity.issuer],
  bearer_methods_supported: ["header"],
  scopes_supported: resourceScopes,
  ...(identity.documentation === undefined ? {} : { resource_documentation: identity.documentation }),
});

/** The `WWW-Authenticate` value that starts the OAuth flow, per RFC 9728 §5.1. */
export const challengeFor = (
  identity: ResourceIdentity,
  error?: { readonly code: string; readonly description: string },
): string =>
  [
    "Bearer",
    [
      `resource_metadata="${metadataUrlFor(identity)}"`,
      ...(error === undefined
        ? []
        : [`error="${error.code}"`, `error_description="${error.description}"`]),
    ].join(", "),
  ].join(" ");

/** The 401 an MCP client turns into an authorization flow. */
export const challengeResponse = (
  identity: ResourceIdentity,
  error: { readonly code: string; readonly description: string },
): Response =>
  new Response(JSON.stringify({ error: error.code, error_description: error.description }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": challengeFor(identity, error),
    },
  });
