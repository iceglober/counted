/**
 * Billing endpoints, over stub ports.
 *
 * The webhook tests are the load-bearing ones. A first-time subscriber must
 * end up paid, a replay must change nothing, and an event we cannot place must
 * be loud rather than silent.
 */

import { describe, expect, test } from "bun:test";
import { Instant, Principal, Subscription, WorkspaceId, type BillingEvent } from "@counted/domain";
import { SubscriptionSchema, UsageSchema } from "@counted/contracts";
import type { EventWriter, VerifiedWebhook } from "@counted/ports";
import { createApp } from "../server";
import { Coalescer } from "../ingest/coalescer";
import { stubAccess, silentLogger } from "../server.test";
import type { Config, Dependencies } from "../composition";
import { STUB_SCHEMA, noConsole, noMail, stubPools } from "../testing/stubs";

const NOW = Date.parse("2026-03-17T15:00:00.000Z");
const at = Instant.fromEpochMillis(NOW);
const WS = WorkspaceId("22222222-2222-2222-2222-222222222222");
const KEY = "sk_billing_key";

const config: Config = {

  databaseUrl: "postgres://stub",
  port: 8080,
  release: "test",
  appUrl: "https://app.counted.test",
  stripe: { secretKey: "sk_test", webhookSecret: "whsec_test", monthlyPrice: "price_m", annualPrice: "price_a" },
  email: { apiKey: "", from: "Counted <test@counted.test>" },
};

const owner: Principal = {
  kind: "service",
  credential: "c" as never,
  workspace: WS,
  projects: "all",
  scopes: ["billing:read", "billing:write"],
  onBehalfOf: "acc" as never,
};

type Harness = {
  subscription?: Subscription | null;
  webhook?: ReturnType<Dependencies["billing"]["verifyWebhook"]>;
  claimed?: boolean;
  used?: number;
  checkoutFails?: boolean;
  principal?: Principal;
};

const app = (h: Harness = {}) => {
  const saved: Subscription[] = [];
  const processed: string[] = [];
  const writer: EventWriter = {
    append: async () => ({ accepted: 0, deduplicated: 0, written: [], committedAt: at }),
  };

  const deps: Dependencies = {
    access: stubAccess({ principals: { [KEY]: h.principal ?? owner }, placements: { [WS]: { workspace: WS, project: null } } }),
    log: silentLogger(),
    console: noConsole,
    schema: STUB_SCHEMA,
    pools: stubPools,
    notifier: noMail,
    billing: {
      createCheckoutSession: async () => {
        if (h.checkoutFails === true) throw new Error("stripe 500: down");
        return { url: "https://checkout.stripe.test/session", expiresAt: null };
      },
      createPortalSession: async () => ({ url: "https://portal.stripe.test/session", expiresAt: null }),
      verifyWebhook: () => h.webhook ?? { ok: false as const, error: { reason: "bad_signature" as const } },
    },
    subscriptions: {
      find: async () => h.subscription ?? null,
      findByCustomer: async () => h.subscription ?? null,
      findBySubscriptionRef: async () => h.subscription ?? null,
      save: async (s) => void saved.push(s),
    },
    webhooks: {
      claim: async () => h.claimed ?? true,
      markProcessed: async (id) => void processed.push(id),
    },
    usage: { eventsInCurrentPeriod: async () => h.used ?? 0 },
    ids: { next: () => "00000000-0000-7000-8000-000000000000" },
    grants: { issue: () => "st_x" },
    secrets: { issue: () => ({ secret: "", digest: "" as never, prefix: "" as never }), digest: (s) => s as never },
    quota: { decide: async () => ({ kind: "accept", used: 0, limit: null }) },
    ingest: new Coalescer(writer, { windowMs: 0 }),
    writer,
    store: {
      executeBatch: async () => ({ results: new Map(), stats: { statements: 0, totalMs: 0, coalesced: 0 } }),
      capabilities: () => ({ engine: "stub", approximateDistinct: false, partitioning: "none" }),
    },
    unitOfWork: {
      transact: async (work: (r: unknown) => unknown) => work({ projects: { listForWorkspace: async () => [] } }),
    } as unknown as Dependencies["unitOfWork"],
    clock: { now: () => at },
    boot: {
      capabilities: {
        engine: "stub",
        approximateDistinct: false,
        partitioning: "declarative",
        serverVersion: "17",
        timescale: false,
        timeZone: "UTC",
      },
      bucketContract: { ok: true, checked: 48 },
    } as Dependencies["boot"],
    config,
    shutdown: async () => {},
  };
  return { app: createApp(deps), saved, processed };
};

const call = (method: string, path: string, payload?: unknown, h?: Harness) => {
  const built = app(h);
  return {
    ...built,
    response: built.app.request(path, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
  };
};

const verified = (event: BillingEvent | null, workspace: WorkspaceId | null = WS) =>
  ({ ok: true as const, value: { id: "evt_1", type: "checkout.session.completed", workspace, event } satisfies VerifiedWebhook });

const checkout: BillingEvent = {
  kind: "checkout_completed",
  plan: "pro",
  customer: "cus_1",
  subscription: "sub_1",
  renewsAt: Instant.fromEpochMillis(Date.parse("2026-04-17T15:00:00.000Z")),
};

const webhook = (h: Harness) =>
  app(h).app.request("/v1/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=x" },
    body: JSON.stringify({ id: "evt_1" }),
  });

describe("the webhook never loses a paying customer", () => {
  test("a first-time subscriber ends up paid, with no prior row", async () => {
    // v1's UPDATE matched zero rows here, reported success, and left them on
    // free. This asserts a row is written.
    const built = app({ subscription: null, webhook: verified(checkout) });
    const res = await built.app.request("/v1/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=x" },
      body: "{}",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, applied: true, entitlementChanged: true });
    expect(built.saved).toHaveLength(1);
    expect(built.saved[0]).toMatchObject({ plan: "pro", payment: "active", customer: "cus_1" });
  });

  test("the event is marked processed", async () => {
    const built = app({ webhook: verified(checkout) });
    await built.app.request("/v1/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=x" },
      body: "{}",
    });
    expect(built.processed).toEqual(["evt_1"]);
  });

  test("a replay is acknowledged and writes nothing", async () => {
    // Stripe delivers at-least-once and retries for days.
    const built = app({ webhook: verified(checkout), claimed: false });
    const res = await built.app.request("/v1/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=x" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ applied: false, reason: "already_processed" });
    expect(built.saved).toHaveLength(0);
  });

  test("an event we do not act on is acknowledged, not retried forever", async () => {
    const built = app({ webhook: verified(null) });
    const res = await built.app.request("/v1/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=x" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ applied: false, reason: "not_actionable" });
    expect(built.processed).toEqual(["evt_1"]);
  });

  test("an actionable event we cannot place is reported, not silently dropped", async () => {
    // Signature valid, event actionable, no workspace and no matching refs.
    // This is a paying customer we cannot credit, so it must be visible.
    const built = app({ webhook: verified(checkout, null), subscription: null });
    const res = await built.app.request("/v1/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=x" },
      body: "{}",
    });
    expect(await res.json()).toMatchObject({ applied: false, reason: "unknown_workspace" });
    expect(built.saved).toHaveLength(0);
  });

  test("an unverified webhook is refused and nothing is written", async () => {
    const built = app({});
    const res = await built.app.request("/v1/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=forged" },
      body: "{}",
    });
    // 400, not 401: there is no credential to challenge for, and Stripe treats
    // 4xx as "stop retrying", which is right for a bad signature.
    expect(res.status).toBe(400);
    expect(built.saved).toHaveLength(0);
    expect(built.processed).toHaveLength(0);
  });

  test("the webhook needs no credential, but is not therefore open", async () => {
    // No Authorization header at all, and it still reaches the handler — which
    // refuses it on the signature.
    const res = await webhook({});
    expect(res.status).toBe(400);
  });
});

describe("usage and subscription reads", () => {
  test("usage names the quota state rather than implying it", async () => {
    const body = await (await call("GET", `/v1/workspaces/${WS}/usage`, undefined, { used: 42 }).response).json();
    expect(UsageSchema.safeParse(body).success).toBe(true);
    expect(body.events).toMatchObject({ used: 42, limit: 100_000, state: "ok" });
  });

  test("past the allowance the state says so", async () => {
    const body = await (
      await call("GET", `/v1/workspaces/${WS}/usage`, undefined, { used: 10_000_000 }).response
    ).json();
    expect(body.events.state).toBe("rejected");
  });

  test("a workspace with no subscription reads as free, not as an error", async () => {
    const body = await (await call("GET", `/v1/workspaces/${WS}/subscription`).response).json();
    expect(SubscriptionSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ plan: "free", paymentState: "none", hasBillingAccount: false });
  });

  test("the customer id is never disclosed, only whether one exists", async () => {
    const paid: Subscription = {
      workspace: WS,
      plan: "pro",
      payment: "active",
      customer: "cus_secretCustomerId",
      subscription: "sub_1",
      renewsAt: at,
      updatedAt: at,
    };
    const text = await (await call("GET", `/v1/workspaces/${WS}/subscription`, undefined, { subscription: paid }).response).text();
    expect(text).not.toContain("cus_secretCustomerId");
    expect(JSON.parse(text).hasBillingAccount).toBe(true);
  });

  test("a past_due workspace keeps its plan and is flagged in grace", async () => {
    const struggling: Subscription = {
      workspace: WS,
      plan: "pro",
      payment: "past_due",
      customer: "cus_1",
      subscription: "sub_1",
      renewsAt: null,
      updatedAt: at,
    };
    const body = await (
      await call("GET", `/v1/workspaces/${WS}/subscription`, undefined, { subscription: struggling }).response
    ).json();
    expect(body).toMatchObject({ plan: "pro", inGrace: true });
  });
});

describe("hosted sessions", () => {
  test("checkout returns a url", async () => {
    const res = await call("POST", `/v1/workspaces/${WS}/billing/checkout-sessions`, { cadence: "annual" }).response;
    expect(res.status).toBe(201);
    expect((await res.json()).url).toContain("checkout.stripe.test");
  });

  test("an empty body is fine — the cadence has a default", async () => {
    const res = await app({}).app.request(`/v1/workspaces/${WS}/billing/checkout-sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect(res.status).toBe(201);
  });

  test("a provider outage is 502 and retryable, not a button that does nothing", async () => {
    const res = await call("POST", `/v1/workspaces/${WS}/billing/checkout-sessions`, {}, { checkoutFails: true })
      .response;
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("billing.provider_unavailable");
    expect(body.retryable).toBe(true);
  });

  test("the portal refuses when there is no billing account, with a reason", async () => {
    // Better than a portal URL that 404s at the provider.
    const res = await call("POST", `/v1/workspaces/${WS}/billing/portal-sessions`).response;
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("billing.no_account");
  });

  test("the portal returns a url once a customer exists", async () => {
    const paid: Subscription = {
      workspace: WS,
      plan: "pro",
      payment: "active",
      customer: "cus_1",
      subscription: "sub_1",
      renewsAt: at,
      updatedAt: at,
    };
    const res = await call("POST", `/v1/workspaces/${WS}/billing/portal-sessions`, undefined, { subscription: paid })
      .response;
    expect(res.status).toBe(201);
  });
});

describe("authorization", () => {
  test("reading billing needs billing:read", async () => {
    const res = await app({}).app.request(`/v1/workspaces/${WS}/usage`);
    expect(res.status).toBe(401);
  });

  test("a read-only credential cannot open checkout", async () => {
    // Only an owner has billing:write; an admin has billing:read.
    const readOnly: Principal = { ...owner, scopes: ["billing:read"] } as Principal;
    const res = await call("POST", `/v1/workspaces/${WS}/billing/checkout-sessions`, {}, { principal: readOnly })
      .response;
    expect(res.status).toBe(403);
  });
});
