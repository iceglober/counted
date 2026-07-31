/**
 * Ports the route tests need present but do not exercise.
 *
 * One copy. Seven route tests each build a `Dependencies`, and a stub pasted
 * into each is seven things to update the next time a port is added — which is
 * how a fixture ends up more permissive than the adapter it stands for.
 */

import { Instant } from "@counted/domain";
import type { ConsoleSessions, Notifier } from "@counted/ports";

/**
 * A console that signs nobody in.
 *
 * Deliberately refuses rather than succeeds: a stub that handed out sessions
 * would make "this route rejects an anonymous caller" untestable, because
 * every caller would arrive signed in.
 */
export const noConsole: ConsoleSessions = {
  beginSignIn: async () => ({ token: "stub-token", expiresAt: Instant.fromEpochMillis(0) }),
  redeem: async () => ({ kind: "unknown" }),
  accountFor: async () => null,
  endSession: async () => {},
  purgeExpired: async () => ({ tokens: 0, sessions: 0 }),
};

/** Accepts everything and sends nothing. */
export const noMail: Notifier = { deliver: async () => {} };

/** Records what would have been sent, for the tests that care. */
export const recordingMail = (): Notifier & { readonly sent: { to: string; body: string }[] } => {
  const sent: { to: string; body: string }[] = [];
  return {
    sent,
    deliver: async (notification) => {
      if (notification.channel === "email") sent.push({ to: notification.to, body: notification.body });
    },
  };
};
