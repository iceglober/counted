/**
 * In-memory stand-ins for the tenancy ports.
 *
 * Not exported from `index.ts`: production code must not be able to reach a
 * repository that forgets everything on restart. They live in the package
 * rather than in a test file because the same doubles serve the use-case tests
 * here and, later, the composition root's tests — and a port with two rival
 * fakes is a port with two rival readings.
 *
 * They are deliberately naive. A fake that tries to be clever grows rules of
 * its own, and then a test proves the fake rather than the code.
 */

import {
  Duration,
  Instant,
  err,
  isWorkspaceId,
  ok,
  unbrand,
  type AccountId,
  type Role,
  type WorkspaceId,
} from "@counted/kernel";
import type { Membership, MembershipDirectory } from "@counted/identity-ports";
import { isPlanId, type BillingEvent, type Subscription, type Workspace, type WorkspaceEvent } from "@counted/tenancy-domain";
import type {
  CheckoutRequest,
  HostedSession,
  PortalRequest,
  WorkspaceSummary,
} from "@counted/tenancy-ports";
import type {
  BillingGateway,
  SubscriptionRepository,
  WebhookLedger,
  WorkspaceRepository,
} from "./ports";

export type FakeWorkspaces = WorkspaceRepository & {
  /** Everything `save` was handed, in order. The outbox's contents, in effect. */
  readonly events: readonly WorkspaceEvent[];
  readonly saves: number;
  seed(workspace: Workspace): void;
  /**
   * Seat an account, so `listForAccount` has something to answer from.
   *
   * The real repository reads better-auth's `member` rows through a seam
   * (`memberships.ts`); this is that seam, in a map. It exists because the
   * contract suite requires `listForAccount` to report memberships and only
   * memberships — an earlier version of this fake returned every stored
   * workspace at role `owner`, which is a different port answering a different
   * question, and the divergence was invisible until the suite was written.
   */
  seedMember(workspace: WorkspaceId, account: AccountId, role: Role): void;
};

export const fakeWorkspaces = (...seed: readonly Workspace[]): FakeWorkspaces => {
  const stored = new Map<string, Workspace>();
  const roles = new Map<string, Role>();
  const events: WorkspaceEvent[] = [];
  let saves = 0;

  const key = (workspace: WorkspaceId, account: AccountId): string =>
    `${unbrand(account)}@${unbrand(workspace)}`;

  const repository = {
    seed: (workspace: Workspace): void => {
      stored.set(unbrand(workspace.id), workspace);
    },
    seedMember: (workspace: WorkspaceId, account: AccountId, role: Role): void => {
      roles.set(key(workspace, account), role);
    },
    find: async (id: WorkspaceId): Promise<Workspace | null> => stored.get(unbrand(id)) ?? null,
    listForAccount: async (account: AccountId): Promise<readonly WorkspaceSummary[]> => {
      const summaries: WorkspaceSummary[] = [];
      for (const workspace of stored.values()) {
        const role = roles.get(key(workspace.id, account));
        // A membership pointing at a workspace with no row is dropped rather
        // than invented, which is what the real one does and for the same
        // reason: a workspace rendered with no plan is worse than one that is
        // not listed. Iterating the workspaces rather than the memberships is
        // how that falls out for free.
        if (role !== undefined) summaries.push({ id: workspace.id, name: workspace.name, role });
      }
      return summaries;
    },
    save: async (workspace: Workspace, saved: readonly WorkspaceEvent[]): Promise<void> => {
      stored.set(unbrand(workspace.id), workspace);
      events.push(...saved);
      saves += 1;
    },
    get events() {
      return events;
    },
    get saves() {
      return saves;
    },
  };

  for (const workspace of seed) repository.seed(workspace);
  return repository;
};

export type FakeSubscriptions = SubscriptionRepository & {
  readonly saves: number;
  seed(subscription: Subscription): void;
};

export const fakeSubscriptions = (...seed: readonly Subscription[]): FakeSubscriptions => {
  const stored = new Map<string, Subscription>();
  let saves = 0;

  const repository = {
    seed: (subscription: Subscription): void => {
      stored.set(unbrand(subscription.workspace), subscription);
    },
    find: async (workspace: WorkspaceId): Promise<Subscription | null> =>
      stored.get(unbrand(workspace)) ?? null,
    findByCustomer: async (customer: string): Promise<Subscription | null> =>
      [...stored.values()].find((s) => s.customer === customer) ?? null,
    findBySubscriptionRef: async (subscription: string): Promise<Subscription | null> =>
      [...stored.values()].find((s) => s.subscription === subscription) ?? null,
    // An upsert, like the real one. There is deliberately no update-shaped
    // method to accidentally use instead.
    save: async (subscription: Subscription): Promise<void> => {
      /**
       * The two uniqueness rules the real schema enforces with indexes.
       *
       * Not cleverness for its own sake. `findByCustomer` is how a webhook
       * decides whose plan to change, and two rows sharing a `cus_…` makes
       * that a coin flip — the upgrade lands on somebody else's workspace and
       * nothing reports it. A fake that allowed the state the database refuses
       * would let a use case be written that only fails in production.
       */
      const clash = [...stored.values()].find(
        (existing) =>
          unbrand(existing.workspace) !== unbrand(subscription.workspace) &&
          ((subscription.customer !== null && existing.customer === subscription.customer) ||
            (subscription.subscription !== null &&
              existing.subscription === subscription.subscription)),
      );
      if (clash !== undefined) {
        throw new Error(
          `fakeSubscriptions: ${String(clash.workspace)} already holds that provider reference`,
        );
      }
      stored.set(unbrand(subscription.workspace), subscription);
      saves += 1;
    },
    get saves() {
      return saves;
    },
  };

  for (const subscription of seed) repository.seed(subscription);
  return repository;
};

export type FakeLedger = WebhookLedger & { readonly processed: readonly string[] };

export const fakeLedger = (): FakeLedger => {
  const claimed = new Set<string>();
  const processed: string[] = [];

  return {
    claim: async (id: string): Promise<boolean> => {
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    },
    markProcessed: async (id: string): Promise<void> => {
      processed.push(id);
    },
    get processed() {
      return processed;
    },
  };
};

export const fakeMemberships = (
  members: ReadonlyMap<string, readonly Membership[]> = new Map(),
): MembershipDirectory => ({
  roleOf: async (account: AccountId, workspace: WorkspaceId) =>
    members.get(unbrand(workspace))?.find((m) => m.account === account)?.role ?? null,
  membersOf: async (workspace: WorkspaceId) => members.get(unbrand(workspace)) ?? [],
});

export type FakeBilling = BillingGateway & {
  readonly checkouts: readonly CheckoutRequest<"free" | "pro">[];
  readonly portals: readonly PortalRequest[];
};

export type FakeBillingBehaviour = {
  readonly session?: HostedSession;
  /** Thrown by both session calls, to stand for "the provider is down". */
  readonly failWith?: Error;
  /**
   * Replace verification wholesale, to state an outcome a test needs directly.
   * Left unset, the toy scheme below runs — which is what lets this double be
   * held to the same contract suite as the Stripe adapter.
   */
  readonly verify?: BillingGateway["verifyWebhook"];
  readonly secret?: string;
  readonly tolerance?: Duration;
};

/**
 * The double's signing secret and window. Named so a harness can sign with the
 * same ones rather than guessing.
 */
export const FAKE_WEBHOOK_SECRET = "whsec_fake";
export const FAKE_WEBHOOK_TOLERANCE = Duration.minutes(5);

/**
 * A signature scheme with no cryptography in it.
 *
 * `@counted/tenancy-app` may import its own domain, the kernel and port types —
 * and nothing else, `node:crypto` included. That is the right rule and it is
 * not in the way here: what the contract suite checks is the *obligations* of
 * verification (a body that was not signed with our secret is refused, a
 * delivery outside the window is `Stale`), and those hold for a toy digest
 * exactly as they hold for Stripe's HMAC-SHA256. This function makes no
 * security claim and is never reachable from a request path — the composition
 * root wires `@counted/adapter-stripe`, which implements Stripe's real scheme
 * over `node:crypto`.
 */
const digest = (secret: string, payload: string): string => {
  let hash = 0x811c9dc5;
  for (const character of `${secret}.${payload}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

/** Produce a header the double will accept. For harnesses and tests only. */
export const signFakeWebhook = (
  body: string,
  at: Instant,
  secret: string = FAKE_WEBHOOK_SECRET,
): string => {
  const timestamp = Math.floor(Instant.toEpochMillis(at) / 1000);
  return `t=${timestamp},v=${digest(secret, `${timestamp}.${body}`)}`;
};

/**
 * The double's wire format: the verified webhook, written out.
 *
 * Deliberately naive. A fake that reimplemented Stripe's event vocabulary would
 * be a second translator to keep in step with `translate.ts`, and a test
 * against it would prove the copy rather than the code.
 */
export type FakeDeliveryBody = {
  readonly id: string;
  readonly type: string;
  readonly workspace: string | null;
  readonly event: BillingEvent | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === "string" ? value : null;
};

const instant = (record: Record<string, unknown>, key: string): Instant | null => {
  const value = record[key];
  return typeof value === "number" ? Instant.fromEpochMillis(value) : null;
};

/**
 * Read a `BillingEvent` out of parsed JSON, or answer null.
 *
 * Every branch *constructs* the event rather than asserting a shape onto the
 * parsed value, so the union member is inferred and nothing is cast. An
 * unrecognised kind is null, which is the same answer the real translator gives
 * a Stripe event type it does not act on.
 */
const readBillingEvent = (value: unknown): BillingEvent | null => {
  const record = asRecord(value);
  if (record === null) return null;

  const subscription = text(record, "subscription");
  if (subscription === null) return null;

  switch (text(record, "kind")) {
    case "checkout_completed": {
      const plan = text(record, "plan");
      const customer = text(record, "customer");
      if (plan === null || !isPlanId(plan) || customer === null) return null;
      return {
        kind: "checkout_completed",
        plan,
        customer,
        subscription,
        renewsAt: instant(record, "renewsAt"),
      };
    }
    case "subscription_updated": {
      const plan = text(record, "plan");
      if (plan === null || !isPlanId(plan)) return null;
      return {
        kind: "subscription_updated",
        plan,
        subscription,
        renewsAt: instant(record, "renewsAt"),
        active: record["active"] === true,
      };
    }
    case "payment_failed":
      return { kind: "payment_failed", subscription };
    case "payment_recovered":
      return { kind: "payment_recovered", subscription };
    case "subscription_canceled":
      return { kind: "subscription_canceled", subscription };
    default:
      return null;
  }
};

export const fakeBilling = (behaviour: FakeBillingBehaviour = {}): FakeBilling => {
  const checkouts: CheckoutRequest<"free" | "pro">[] = [];
  const portals: PortalRequest[] = [];
  const session = behaviour.session ?? { url: "https://pay.example/s_1", expiresAt: null };
  const secret = behaviour.secret ?? FAKE_WEBHOOK_SECRET;
  const tolerance = behaviour.tolerance ?? FAKE_WEBHOOK_TOLERANCE;

  /**
   * Signature first, freshness second — the same order the real adapter uses,
   * and for the same reason: checking the age of an unauthenticated timestamp
   * first tells an attacker whether their forged body would have verified.
   */
  const verifyToy: BillingGateway["verifyWebhook"] = (body, signature, at) => {
    if (signature === undefined || signature === "") return err({ kind: "BadSignature" });

    const parts = new Map(
      signature.split(",").flatMap((part) => {
        const separator = part.indexOf("=");
        return separator === -1
          ? []
          : [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()] as const];
      }),
    );
    const timestamp = Number.parseInt(parts.get("t") ?? "", 10);
    const presented = parts.get("v");
    if (!Number.isSafeInteger(timestamp) || presented === undefined) {
      return err({ kind: "Malformed", detail: "signature header has no timestamp or digest" });
    }
    if (presented !== digest(secret, `${timestamp}.${body}`)) {
      return err({ kind: "BadSignature" });
    }

    const ageSeconds = Math.floor(Instant.toEpochMillis(at) / 1000) - timestamp;
    if (Math.abs(ageSeconds) > Duration.toSeconds(tolerance)) {
      return err({ kind: "Stale", ageSeconds });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return err({ kind: "Malformed", detail: "signed body is not JSON" });
    }
    const record = asRecord(parsed);
    const id = record === null ? null : text(record, "id");
    const type = record === null ? null : text(record, "type");
    if (record === null || id === null || type === null) {
      return err({ kind: "Malformed", detail: "event has no id or type" });
    }

    const workspace = text(record, "workspace");
    return ok({
      id,
      type,
      workspace: workspace !== null && isWorkspaceId(workspace) ? workspace : null,
      // `null` is a real answer: an event the double does not act on is
      // recorded and acknowledged, so the provider stops retrying it.
      event: readBillingEvent(record["event"]),
    });
  };

  return {
    createCheckoutSession: async (request) => {
      checkouts.push(request);
      if (behaviour.failWith !== undefined) throw behaviour.failWith;
      return session;
    },
    prices: async () => {
      if (behaviour.failWith !== undefined) throw behaviour.failWith;
      return [{ plan: "pro", cadence: "monthly", amount: 999, currency: "usd" }, { plan: "pro", cadence: "annual", amount: 9999, currency: "usd" }];
    },
    subscriptionDetails: async () => {
      if (behaviour.failWith !== undefined) throw behaviour.failWith;
      return { cadence: "monthly", price: null, cancelAtPeriodEnd: false, periodEndsAt: null };
    },
    createPortalSession: async (request) => {
      portals.push(request);
      if (behaviour.failWith !== undefined) throw behaviour.failWith;
      return session;
    },
    verifyWebhook: (body: string, signature: string | undefined, at: Instant) =>
      // A stated outcome wins; otherwise the toy scheme runs, which is what
      // lets this double be held to the same contract suite as the Stripe
      // adapter. Before it existed, `verifyWebhook` threw unless a test had
      // configured it — so the double satisfied none of the port's obligations
      // and nothing said so.
      (behaviour.verify ?? verifyToy)(body, signature, at),
    get checkouts() {
      return checkouts;
    },
    get portals() {
      return portals;
    },
  };
};
