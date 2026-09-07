/**
 * The HTTP surface `apps/api` mounts, and the two doors that are nailed shut.
 *
 * better-auth ships routes for every plugin it loads. Most of them are exactly
 * what the console needs — sign-in, sign-out, magic link, OAuth callbacks,
 * invitations, member roles, the MCP authorization server. Two families are
 * not, because reaching them over HTTP would step around an invariant this
 * package holds.
 *
 * **`/api-key/*`.** The vendor's key CRUD mints a row with a `referenceId` and
 * no workspace, no project and no domain issuance instant — a credential the
 * store cannot see and the domain cannot scope. It also exposes `/api-key/get`
 * and `/api-key/list`, whose responses are shaped by the vendor rather than by
 * the contract; v1's key list returned the full key for every key the caller
 * could see, and this is the kind of endpoint that happens on. Credentials go
 * through `CredentialStore`, which is reachable only through the contract's
 * `credentials.*` routes.
 *
 * **`/organization/create` and `/organization/delete`.** An organization
 * created here has no workspace: invisible to billing, constrained by no plan
 * limit, uncharged. A deleted one leaves a workspace with nobody in it.
 * `provisioning.ts` is the only way to make or unmake that pair.
 *
 * Blocked routes answer 404, not 403. A 403 confirms the endpoint exists and
 * that the caller merely lacks permission, which is an invitation to keep
 * trying; a 404 says there is nothing here, which is true of this deployment.
 */

import { AccountId, Instant, WorkspaceId, type Permission } from "@counted/kernel";
import { CLIENT_ADDRESS_HEADER, type IdentityAuth } from "./auth";
import type { SessionPrincipal } from "./config";

/**
 * Paths the mounted handler refuses, matched against the path *after* the
 * mount prefix. Prefix matching on a `/`-terminated string so `/api-keys` — a
 * route somebody might add later — is not swept up by `/api-key`.
 */
const BLOCKED_PREFIXES = ["/api-key/"] as const;
const BLOCKED_EXACT = ["/api-key", "/organization/create", "/organization/delete", "/organization/update", "/organization/update-member-role", "/organization/remove-member", "/organization/leave", "/counted/oauth-principal"] as const;

export const isBlockedIdentityPath = (path: string): boolean => {
  const normalized = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if ((BLOCKED_EXACT as readonly string[]).includes(normalized)) return true;
  return BLOCKED_PREFIXES.some((prefix) => path.startsWith(prefix));
};

export type IdentityHttp = {
  /** Handle a request already stripped of the mount prefix by the caller. */
  handle(request: Request): Promise<Response>;
  /** Who is calling, from cookies or a bearer token. Null when nobody is. */
  principal(headers: Headers): Promise<SessionPrincipal | null>;
  oauthPrincipal(token: string): Promise<{ account: AccountId; permissions: readonly Permission[] } | null>;
};

export const betterAuthHttp = (identity: IdentityAuth, mountPath = "/api/auth"): IdentityHttp => {
  /**
   * The request as better-auth sees it.
   *
   * The caller's own copy of `CLIENT_ADDRESS_HEADER` is dropped and ours is
   * written if the composition root resolved an address, so the only value
   * better-auth can ever read there is one this process computed with the
   * trusted-hop rule. A caller who sends the header gets it stripped rather
   * than believed — that is the whole difference between a private header and
   * `X-Forwarded-For`. Stripped even when nothing is resolved: a header
   * better-auth is not reading today is one it could be told to read tomorrow.
   */
  const addressed = (request: Request): Request => {
    const headers = new Headers(request.headers);
    headers.delete(CLIENT_ADDRESS_HEADER);
    const address = identity.clientAddress?.(request.headers) ?? null;
    if (address !== null) headers.set(CLIENT_ADDRESS_HEADER, address);
    return new Request(request, { headers });
  };

  return {
    oauthPrincipal: (token) => identity.auth.api.countedOAuthPrincipal({ body: { token } }),
    async handle(request) {
      const path = new URL(request.url).pathname;
      const relative = path.startsWith(mountPath) ? path.slice(mountPath.length) || "/" : path;
      if (relative === "/capabilities" && request.method === "GET") return Response.json({ email: identity.emailDelivery });
      if (!identity.emailDelivery && ["/sign-in/magic-link", "/request-password-reset", "/send-verification-email", "/organization/invite-member"].includes(relative)) {
        return Response.json({ message: "Email delivery is not configured on this installation. Contact its administrator." }, { status: 503 });
      }
      if (["/organization/invite-member", "/organization/cancel-invitation", "/organization/list-invitations"].includes(relative)) {
        const session = await identity.auth.api.getSession({ headers: request.headers });
        if (!session) return Response.json({ message: "Sign in to manage invitations." }, { status: 401 });
        const body: unknown = request.method === "POST" ? await request.clone().json().catch(() => null) : null;
        const data = body !== null && typeof body === "object" ? body as Record<string, unknown> : {};
        let workspace = data.organizationId ?? new URL(request.url).searchParams.get("organizationId") ?? session.session.activeOrganizationId;
        if (relative === "/organization/cancel-invitation" && typeof data.invitationId === "string") {
          const invitation = await (await identity.auth.$context).adapter.findOne<{ organizationId: string }>({ model: "invitation", where: [{ field: "id", value: data.invitationId }] });
          workspace = invitation?.organizationId;
        }
        if (typeof workspace !== "string" || !(await identity.administersWorkspace(session.user.id, workspace))) return Response.json({ message: "Only workspace owners can manage invitations." }, { status: 403 });
      }
      if (isBlockedIdentityPath(relative)) {
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return identity.auth.handler(addressed(request));
    },

    async principal(headers) {
      const session = await identity.auth.api.getSession({ headers });
      if (session === null) return null;

      const activeOrganizationId = (session.session as { activeOrganizationId?: string | null })
        .activeOrganizationId;

      return {
        account: AccountId(session.user.id),
        email: session.user.email,
        emailVerified: session.user.emailVerified === true,
        // The console's current selection, not an authorization decision. Which
        // workspace a request acts on comes from the route's own input; this is
        // only what to show when the route did not say.
        activeWorkspace:
          typeof activeOrganizationId === "string" && activeOrganizationId.length > 0
            ? WorkspaceId(activeOrganizationId)
            : null,
        expiresAt: Instant.fromDate(new Date(session.session.expiresAt)),
      };
    },
  };
};
