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

/**
 * A unit of work whose repositories are all empty.
 *
 * Enough for routes that need the port present without exercising storage —
 * `/v1/me` reads an account's workspaces, and every route test would otherwise
 * have to build one.
 */
export const emptyUnitOfWork = {
  transact: async <T,>(work: (repos: Record<string, unknown>) => Promise<T> | T): Promise<T> =>
    work({
      workspaces: { find: async () => null, listForAccount: async () => [], save: async () => {} },
      projects: { find: async () => null, listForWorkspace: async () => [], save: async () => {} },
      dashboards: { find: async () => null, listForWorkspace: async () => [], save: async () => {} },
      monitors: { find: async () => null, listForProject: async () => [], listEnabled: async () => [], save: async () => {} },
    }),
} as unknown as import("@counted/ports").UnitOfWork;

/**
 * A schema fingerprint and a pool that answers with it.
 *
 * Readiness compares what the build expects against what the database reports.
 * A route test does not exercise that, but it does have to construct it — and
 * a stub that disagreed with itself would make every test's readiness 503.
 */
export const STUB_SCHEMA = "sch_test_0001";

export const stubPools = {
  analytics: {
    query: async () => ({ rows: [{ fingerprint: STUB_SCHEMA }] }),
  },
} as unknown as { readonly analytics: import("pg").Pool };
