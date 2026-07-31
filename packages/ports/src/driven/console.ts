/**
 * Signing a human in to the console.
 *
 * Deliberately a port and not a domain concept. `ConsoleSession` is a fact
 * about our own web app — a browser holding a cookie — and it has no business
 * being an aggregate: v1 made "session" mean three incompatible things at once
 * (the login session, the analytics visit, and a Stripe idempotency key), and
 * the login one was the only one that ever needed durable storage.
 *
 * What the domain gets from all this is a `Principal` of kind `account`.
 * Nothing above this port knows there was a cookie.
 *
 * **No passwords.** A sign-in link is a single-use, short-lived, hashed token
 * mailed to an address the account already proved it controls. There is
 * nothing to leak in a dump, nothing to reuse across sites, and no reset flow
 * — which is itself a second, weaker password system in most products.
 */

import type { AccountId, Instant } from "@counted/domain";

/** How long a mailed sign-in link stays usable. */
export const SIGN_IN_TOKEN_TTL_MS = 15 * 60 * 1000;

/** How long a console session lasts without re-authenticating. */
export const CONSOLE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type Account = {
  readonly id: AccountId;
  readonly email: string;
  readonly createdAt: Instant;
};

/**
 * The outcome of redeeming a sign-in token.
 *
 * `expired` and `unknown` are separate so the *log* can tell them apart. What
 * goes back to the caller must not: a token that never existed and one that
 * timed out are the same refusal, or the difference becomes an oracle for
 * guessing tokens.
 */
export type Redemption =
  | { readonly kind: "signed_in"; readonly account: Account; readonly secret: string; readonly expiresAt: Instant }
  | { readonly kind: "expired" }
  | { readonly kind: "unknown" };

export interface ConsoleSessions {
  /**
   * Begin a sign-in, creating the account if this address has never been seen.
   *
   * Returns the token to mail. It is returned rather than sent so that
   * delivery stays in the notifier and this port stays testable without a mail
   * server.
   *
   * Creating on first sight is what makes sign-up and sign-in one flow. The
   * caller must answer identically either way — telling an anonymous caller
   * whether an address has an account is an enumeration oracle, and the two
   * paths differing by so much as a status code is enough.
   */
  beginSignIn(email: string, at: Instant): Promise<{ readonly token: string; readonly expiresAt: Instant }>;

  /** Spend a sign-in token, once, and open a session. */
  redeem(token: string, at: Instant): Promise<Redemption>;

  /**
   * Which account holds this session, if it is still live.
   *
   * Takes the digest, never the cookie value — the same rule as every other
   * credential here, so a database dump does not hand over working sessions.
   */
  accountFor(digest: string, at: Instant): Promise<Account | null>;

  /** End one session. Idempotent: ending an ended session is not an error. */
  endSession(digest: string): Promise<void>;

  /** Remove expired tokens and sessions. Called by the worker. */
  purgeExpired(before: Instant): Promise<{ readonly tokens: number; readonly sessions: number }>;
}
