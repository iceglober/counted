import { z } from "./common";

/**
 * Requesting a sign-in link.
 *
 * Deliberately permissive about what an address looks like. The only thing
 * worth rejecting is something that is not an address at all — a stricter
 * pattern rejects real ones (plus-addressing, new TLDs, unicode local parts),
 * and attempting delivery is the real validation regardless.
 */
export const SignInRequestSchema = z
  .object({
    email: z.string().trim().min(3).max(320).email().openapi({ example: "you@example.com" }),
  })
  .openapi("SignInRequest");

export const RedeemSessionRequestSchema = z
  .object({
    /** The token from the mailed link. Single use, and short-lived. */
    token: z.string().min(16).max(512),
  })
  .openapi("RedeemSessionRequest");

/**
 * What a successful sign-in returns.
 *
 * The session itself is not in the body — it is an `HttpOnly` cookie, so
 * script cannot read it and an XSS is not automatically a stolen session. What
 * comes back is only enough to render "signed in as".
 */
export const SessionSchema = z
  .object({
    account: z.object({
      id: z.string().openapi({ example: "acct_01J8ZQ" }),
      email: z.string(),
    }),
    expiresAt: z.string().datetime(),
  })
  .openapi("Session");
