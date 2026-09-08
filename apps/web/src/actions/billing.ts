"use server";

/**
 * The upgrade path.
 *
 * v2 had none: `/settings/billing` was a 404 that Stripe returned the customer
 * to after they paid. The button this action sits behind is the fix.
 *
 * This used to go through `lib/billing.ts`, a hand-written `fetch` against a
 * path the contract declared and the contract tree did not export — the API
 * genuinely had no such route, so the workaround also had to report "unmounted"
 * as a distinct outcome. The routes are mounted now and the client is typed, so
 * the workaround and its tripwire are gone: an unreachable API is a `Failure`
 * like any other, and the settings page already renders one.
 *
 * `redirect` throws to perform the navigation, which is why the URL is read out
 * of the outcome first: a `redirect` inside a `try` would be caught as an
 * error. `attempt` returns rather than throws for exactly that reason.
 */

import { redirect } from "next/navigation";
import { attempt, contractClient } from "../lib/client";
import { consoleOrigin } from "../lib/env";
import { cookieForCaller } from "../lib/session";
import { returnTo, text, withFailure } from "../lib/form";

const client = async () => contractClient({ authority: { cookie: await cookieForCaller() } });

/**
 * A URL the console is willing to send a browser to.
 *
 * `HostedSessionSchema.url` is `z.url()`, and Zod 4's `url()` checks only that
 * the string parses — `javascript:alert(1)` passes it. The session URL comes
 * from our own API, so this is defence in depth rather than a live hole, but
 * the console is the thing performing the navigation and it is the last place
 * that can refuse. `http` is allowed because a local provider stub serves over
 * it.
 */
const navigable = (raw: string): boolean => {
  try {
    return ["https:", "http:"].includes(new URL(raw).protocol);
  } catch {
    return false;
  }
};

const NOT_A_SESSION = {
  code: "BAD_GATEWAY",
  status: 502,
  reason: "Malformed",
  message: "The billing response was not a hosted session.",
} as const;

export const startCheckout = async (form: FormData): Promise<void> => {
  const workspaceId = text(form, "workspaceId");
  const back = returnTo(form, `/w/${workspaceId}/settings?tab=plan`);
  const cadence = text(form, "cadence") === "annual" ? "annual" : "monthly";
  const origin = consoleOrigin();

  const outcome = await attempt(
    (await client()).billing.checkout({
      workspaceId,
      // `pro` is the only paid plan the contract's `PlanIdSchema` names. When a
      // second one appears this reads the form field instead — and the enum
      // will make that a compile error here rather than a silent free-plan
      // checkout.
      plan: "pro",
      cadence,
      successUrl: `${origin}/w/${workspaceId}/settings?tab=plan&upgraded=1`,
      cancelUrl: `${origin}/w/${workspaceId}/settings?tab=plan&checkout=canceled`,
    }),
  );

  if (!outcome.ok) redirect(withFailure(back, outcome.failure));
  if (!navigable(outcome.value.session.url)) redirect(withFailure(back, NOT_A_SESSION));
  redirect(outcome.value.session.url);
};

export const manageBilling = async (form: FormData): Promise<void> => {
  const workspaceId = text(form, "workspaceId");
  const back = returnTo(form, `/w/${workspaceId}/settings?tab=plan`);

  const outcome = await attempt(
    (await client()).billing.portal({
      workspaceId,
      returnUrl: `${consoleOrigin()}/w/${workspaceId}/settings?tab=plan`,
    }),
  );

  if (!outcome.ok) redirect(withFailure(back, outcome.failure));
  if (!navigable(outcome.value.session.url)) redirect(withFailure(back, NOT_A_SESSION));
  redirect(outcome.value.session.url);
};
