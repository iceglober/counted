/**
 * What every console page does before it renders anything.
 *
 * The console has no session of its own to check. "Signed in" here means "the
 * API accepted the cookie we forwarded", which is the only definition that
 * cannot drift from what the API actually enforces — a local session check
 * would be a second answer to a question only one side gets to answer.
 */

import { redirect } from "next/navigation";
import type { Attempt } from "./client";
import { isUnauthenticated } from "./failure";
import { signInPath } from "./auth-navigation";

/**
 * The caller's account, or a redirect to sign in.
 *
 * A 401 is the only failure that becomes a redirect. Everything else is
 * rethrown, because bouncing a signed-in reader to a sign-in page when the
 * database is down tells them to fix the one thing that is not broken.
 */
export const requireAccount = <T>(me: Attempt<T>, next = "/"): T => {
  if (me.ok) return me.value;
  if (isUnauthenticated(me.failure)) redirect(signInPath(next));
  throw new Error(`Could not read the calling account: ${me.failure.code} ${me.failure.message}`);
};
