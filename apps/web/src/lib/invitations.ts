/**
 * Inviting someone, which is the one membership write the contract does not
 * describe — and correctly does not.
 *
 * `MembershipDirectory` in `@counted/identity-ports` is read-only, permanently:
 * better-auth's organization plugin owns `organization`, `member` and
 * `invitation`, and writes go through its API. A workspace row and an
 * organization row share an id and mean different things — what plan and what
 * limits, versus who belongs here — so there is no contract procedure to call
 * and inventing one in `apps/web` would be inventing a second source of truth
 * for membership.
 *
 * So this posts to the provider's own route, through the same proxy path the
 * browser would use, with the caller's cookie and nothing else. It is not a
 * back channel: a third party with a session can call exactly this endpoint.
 */

import { apiOrigin } from "./env";
import { failureOf, type Failure } from "./failure";

export type InviteOutcome =
  | { readonly kind: "invited" }
  /** The provider's invite route is not mounted on this deployment. */
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed"; readonly failure: Failure };

/**
 * The role vocabulary is the kernel's three, and the provider is told the same
 * word the contract uses. If the two ever disagree the invitation lands with a
 * role the domain does not recognise, which is a bug that only shows up when
 * the invited person signs in — hence stating the union here rather than
 * forwarding whatever the form said.
 */
export type InvitableRole = "owner" | "admin" | "member";

export const inviteMember = async (input: {
  readonly workspaceId: string;
  readonly email: string;
  readonly role: InvitableRole;
  readonly cookie: string | undefined;
}): Promise<InviteOutcome> => {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin()}/api/auth/organization/invite-member`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.cookie === undefined ? {} : { cookie: input.cookie }),
      },
      body: JSON.stringify({
        email: input.email,
        role: input.role,
        organizationId: input.workspaceId,
      }),
      cache: "no-store",
    });
  } catch (error) {
    return { kind: "failed", failure: failureOf(error) };
  }

  if (response.ok) return { kind: "invited" };
  if (response.status === 404) return { kind: "unavailable" };

  const body: unknown = await response.json().catch(() => null);
  const message =
    typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message
      : "The invitation was refused.";

  // better-auth answers with its own error codes rather than oRPC's, so the
  // status is what carries the meaning here. 403 is "your role cannot invite",
  // 400 is usually "already a member".
  return {
    kind: "failed",
    failure: {
      code: response.status === 403 ? "FORBIDDEN" : "BAD_REQUEST",
      status: response.status,
      reason: response.status === 409 ? "AlreadyAMember" : null,
      message,
    },
  };
};
