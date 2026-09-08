/**
 * Who is asking, resolved from one request.
 *
 * Three credentials can arrive and each produces a different kind of
 * `Principal`: a console session cookie, an `Authorization: Bearer` API key,
 * and a share token in the query string. Nothing else authenticates, and there
 * is no fallback that fabricates an identity — v1 synthesised
 * `{ userId: "", role: "owner" }` whenever the caller was an API key, and that
 * empty id was written into `created_by` columns for a year.
 *
 * **Unknown, revoked and expired keys all collapse to `anonymous`.** They are
 * distinct in `VerificationFailure` so the audit line can say which happened,
 * and identical to the caller so a message or timing difference cannot tell
 * somebody which of their guesses exists. `RateLimited` does not collapse: back
 * off is an instruction, and withholding it just produces more requests.
 *
 * **An ingest key's workspace comes from its project, not from the key row.**
 * `VerifiedCredential.workspace` is what the workspace was when the key was
 * issued. For the no-signup path that is the holding workspace an unclaimed
 * project's key had to be issued against, and after the project is claimed it
 * is the wrong one — so `covers` would refuse the key the customer had just
 * been told to paste. Reading the workspace from the project is also strictly
 * safer: the project id comes from the credential and not from the request, so
 * the two cannot be made to disagree.
 */

import { Instant, type CredentialId, type Permission, type ProjectId, type WorkspaceId } from "@counted/kernel";
import { Principal, type WorkspaceRole } from "@counted/authorization";
import type { CredentialStore, MembershipDirectory, VerifiedCredential } from "@counted/identity-ports";
import { credentialKindOf } from "@counted/identity-ports";
import type { Fault } from "../faults";
import { fromVerificationFailure } from "../faults";

/** What a session provider tells us. Shaped by `@counted/identity-adapter-better-auth`. */
export type SessionReader = {
  principal(headers: Headers): Promise<{ readonly account: import("@counted/kernel").AccountId } | null>;
  oauthPrincipal?(token: string): Promise<{ readonly account: import("@counted/kernel").AccountId; readonly permissions: readonly Permission[] } | null>;
};

export type ShareReader = {
  /**
   * The dashboard a token opens, and the projects its tiles read from.
   *
   * `null` covers a wrong token and an unshared dashboard alike — the caller
   * cannot tell them apart, which is what stops the endpoint being an oracle
   * for which dashboards have live links.
   */
  resolve(token: string): Promise<
    | {
        readonly credential: CredentialId;
        readonly dashboard: import("@counted/kernel").DashboardId;
        readonly projects: readonly ProjectId[];
      }
    | null
  >;
};

export type PrincipalDeps = {
  readonly credentials: CredentialStore;
  readonly memberships: MembershipDirectory;
  readonly session: SessionReader;
  readonly share: ShareReader;
  /** Where an ingest key's live workspace comes from. See the note above. */
  projectWorkspace(project: ProjectId): Promise<WorkspaceId | null | undefined>;
};

export type Resolved =
  | { readonly ok: true; readonly principal: Principal }
  /** Only `RateLimited` reaches here; everything else becomes `anonymous`. */
  | { readonly ok: false; readonly fault: Fault };

/**
 * Everything a share link may ever do.
 *
 * `queries:run` is here because rendering a shared dashboard runs its tiles'
 * analyses; `dashboards:read` is the page itself. What stops the link reading
 * anything else is the binding, not the permission — see `Binding` in
 * `@counted/authorization` — but the set is still stated once, in code, rather
 * than stored on a row: widening what a link can do should be a change
 * somebody reviews, not a row somebody edits.
 */
const SHARE_PERMISSIONS: readonly Permission[] = ["dashboards:read", "queries:run"];

const BEARER = /^Bearer\s+(.+)$/i;

export const bearerToken = (headers: Headers): string | null => {
  const header = headers.get("authorization");
  if (header === null) return null;
  const matched = BEARER.exec(header.trim());
  return matched?.[1]?.trim() ?? null;
};

/**
 * Resolve the caller, given the share token the route carries (if any).
 *
 * The share token is a route input rather than a header, so it is passed in
 * rather than dug out of the URL here: the contract says which routes take one,
 * and a resolver that looked for `?shareToken=` on every request would let a
 * token authenticate a route that never declared it.
 */
export const resolvePrincipal = async (
  deps: PrincipalDeps,
  headers: Headers,
  at: Instant,
  shareToken: string | null,
): Promise<Resolved> => {
  if (shareToken !== null) {
    const grant = await deps.share.resolve(shareToken);
    if (grant === null) return { ok: true, principal: Principal.ANONYMOUS };
    return {
      ok: true,
      principal: {
        kind: "share",
        credential: grant.credential,
        dashboard: grant.dashboard,
        projects: grant.projects,
        permissions: SHARE_PERMISSIONS,
      },
    };
  }

  const secret = bearerToken(headers);
  if (secret !== null) {
    const key = await fromApiKey(deps, secret, at);
    if (!key.ok || key.principal.kind !== "anonymous" || credentialKindOf(secret) !== null) return key;
    const oauth = await deps.session.oauthPrincipal?.(secret);
    return { ok: true, principal: oauth ? { kind: "account", account: oauth.account, standing: null, permissionCeiling: oauth.permissions } : Principal.ANONYMOUS };
  }

  const session = await deps.session.principal(headers);
  if (session === null) return { ok: true, principal: Principal.ANONYMOUS };

  // `standing` stays null here on purpose. A human's role is read in the
  // workspace that owns the resource being touched, which is not known until
  // the placement is resolved — carrying a role from one workspace into a
  // decision about another is the mistake `WorkspaceRole` exists to prevent.
  return { ok: true, principal: { kind: "account", account: session.account, standing: null } };
};

const fromApiKey = async (
  deps: PrincipalDeps,
  secret: string,
  at: Instant,
): Promise<Resolved> => {
  const verified = await deps.credentials.verify(secret, at);
  if (!verified.ok) {
    return verified.error.kind === "RateLimited"
      ? { ok: false, fault: fromVerificationFailure(verified.error) }
      : { ok: true, principal: Principal.ANONYMOUS };
  }
  return { ok: true, principal: await fromVerified(deps, verified.value) };
};

const fromVerified = async (
  deps: PrincipalDeps,
  credential: VerifiedCredential,
): Promise<Principal> => {
  if (credential.kind === "ingest") {
    // An ingest key with no project reaches nothing: its whole authority is the
    // one project it names. Collapsing rather than widening, because the other
    // reading — "no project means every project" — is the v2 binding bug.
    if (credential.project === null) return Principal.ANONYMOUS;
    const workspace = await deps.projectWorkspace(credential.project);
    if (workspace === undefined) return Principal.ANONYMOUS;
    return {
      kind: "ingest",
      credential: credential.id,
      project: credential.project,
      workspace,
      permissions: credential.permissions,
    };
  }

  return {
    kind: "service",
    credential: credential.id,
    workspace: credential.workspace,
    projects: credential.project === null ? "all" : [credential.project],
    permissions: credential.permissions,
    onBehalfOf: credential.issuedBy,
  };
};

/**
 * A human's standing in one workspace, read at the moment it is needed.
 *
 * Not cached across a request: a role change should take effect on the next
 * request, and a request that touched two workspaces would otherwise decide the
 * second with the first one's role.
 */
export const standingIn = async (
  deps: Pick<PrincipalDeps, "memberships">,
  principal: Principal,
  workspace: WorkspaceId | null,
): Promise<Principal> => {
  if (principal.kind !== "account" || workspace === null) return principal;
  const role = await deps.memberships.roleOf(principal.account, workspace);
  const standing: WorkspaceRole | null = role === null ? null : { workspace, role };
  return { ...principal, standing };
};
