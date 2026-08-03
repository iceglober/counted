/**
 * Signing in to the console.
 *
 * Three endpoints, and the interesting part of all three is what they refuse
 * to tell you.
 *
 * `POST /v1/auth/sign-in` answers `202` for every syntactically valid address,
 * whether or not an account exists, whether or not one was just created, and
 * whether or not the mail was accepted. Any difference — a status code, a
 * body, a response time — is an oracle for testing whether a given person uses
 * Counted. That is the whole of the account-enumeration attack, and the only
 * defence is to have nothing to observe.
 *
 * `POST /v1/auth/session` collapses "no such token" and "expired token" into
 * one refusal, for the same reason applied to tokens instead of addresses.
 *
 * `DELETE /v1/auth/session` always succeeds. Signing out of a session that has
 * already gone is what a user wants to happen anyway.
 */

import { Instant } from "@counted/domain";
import { RedeemSessionRequestSchema, SignInRequestSchema } from "@counted/contracts";
import type { Dependencies } from "../composition";
import { publicRoute, type RouteDefinition } from "../http/route";
import { EmailNotConfiguredError } from "@counted/adapter-notify";
import { sendProblem } from "../http/respond";
import {
  SESSION_COOKIE,
  clearedSessionCookie,
  cookieOptionsFor,
  readCookie,
  serializeSessionCookie,
} from "../http/session";

const signInLink = (appUrl: string, token: string): string =>
  `${appUrl.replace(/\/+$/, "")}/auth/callback?token=${encodeURIComponent(token)}`;

const MAIL_SUBJECT = "Your Counted sign-in link";

const mailBody = (link: string, minutes: number): string =>
  [
    "Click to sign in to Counted:",
    "",
    link,
    "",
    `The link works once and expires in ${minutes} minutes.`,
    "If you did not ask for it, you can ignore this — it grants nothing until it is used.",
  ].join("\n");

export const authRoutes = (deps: Dependencies): readonly RouteDefinition[] => {
  const cookieOptions = cookieOptionsFor(deps.config.appUrl);

  return [
    {
      method: "post",
      path: "/v1/auth/sign-in",
      security: publicRoute("Signing in is how a caller stops being anonymous; requiring auth would be circular."),
      handler: async (c) => {
        const parsed = SignInRequestSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) {
          // The one thing that *is* reported, because it is a fact about the
          // request rather than about who has an account.
          return sendProblem(c, "request.validation_failed", { detail: "A valid email address is required." });
        }

        const now = deps.clock.now();
        const { token, expiresAt } = await deps.console.beginSignIn(parsed.data.email, now);
        const minutes = Math.round((Instant.toEpochMillis(expiresAt) - Instant.toEpochMillis(now)) / 60_000);

        try {
          await deps.notifier.deliver({
            channel: "email",
            to: parsed.data.email,
            subject: MAIL_SUBJECT,
            body: mailBody(signInLink(deps.config.appUrl, token), minutes),
          });
        } catch (error) {
          // No mail provider configured means development, and there the link
          // has to go somewhere or sign-in cannot be exercised at all. This is
          // the behaviour the composition comment always claimed and never had.
          // Gated on *unconfigured* rather than on any failure: a real delivery
          // failure in production must never print a credential to a log.
          if (error instanceof EmailNotConfiguredError) {
            c.get("log").warn("auth.mail_unconfigured", {
              detail: "No RESEND_API_KEY, so the sign-in link is printed here instead of sent.",
              link: signInLink(deps.config.appUrl, token),
            });
          } else {
            // Logged, never surfaced. A caller who can tell a delivery failure
            // from a success can tell a real address from a fake one by whether
            // the mail provider bounced it.
            c.get("log").error("auth.mail_failed", { error: String(error) });
          }
        }

        // Identical for a new account, an existing one, and a failed send.
        return c.body(null, 202);
      },
    },

    {
      method: "post",
      path: "/v1/auth/session",
      security: publicRoute("Redeeming a sign-in link is authentication itself. The token is the credential."),
      handler: async (c) => {
        const parsed = RedeemSessionRequestSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) {
          return sendProblem(c, "auth.unauthenticated", { detail: "This sign-in link is not usable." });
        }

        const redeemed = await deps.console.redeem(parsed.data.token, deps.clock.now());
        if (redeemed.kind !== "signed_in") {
          // One message for both outcomes. The log keeps the distinction; the
          // response must not, or it answers "does this token exist?".
          c.get("log").info("auth.redeem_refused", { reason: redeemed.kind });
          return sendProblem(c, "auth.unauthenticated", {
            detail: "This sign-in link has expired or has already been used. Request a new one.",
          });
        }

        const maxAge = Math.round(
          (Instant.toEpochMillis(redeemed.expiresAt) - Instant.toEpochMillis(deps.clock.now())) / 1000,
        );
        c.header("set-cookie", serializeSessionCookie(redeemed.secret, maxAge, cookieOptions));
        return c.json({
          account: { id: redeemed.account.id, email: redeemed.account.email },
          expiresAt: Instant.toISO(redeemed.expiresAt),
        });
      },
    },

    {
      method: "delete",
      path: "/v1/auth/session",
      security: publicRoute("Signing out must work even with a session the server no longer recognises."),
      handler: async (c) => {
        const presented = readCookie(c.req.header("cookie"), SESSION_COOKIE);
        if (presented !== null) await deps.console.endSession(deps.secrets.digest(presented));

        // Cleared unconditionally. If the row was already gone, the browser
        // is still holding a cookie it should not keep sending.
        c.header("set-cookie", clearedSessionCookie(cookieOptions));
        return c.body(null, 204);
      },
    },
  ];
};
