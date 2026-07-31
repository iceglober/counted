/**
 * Signature verification and translation.
 *
 * The verification tests are the ones that matter: this is the one place where
 * getting it wrong means anyone on the internet can grant themselves a paid
 * plan. Written against the real HMAC rather than a stub, because a stubbed
 * signature check tests nothing.
 */

import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Instant, WorkspaceId } from "@counted/domain";
import { StripeGateway, TOLERANCE_SECONDS, translate, verifySignature } from "./index";

const SECRET = "whsec_testSecretValue";
const NOW = Date.parse("2026-03-17T15:00:00.000Z");
const at = Instant.fromEpochMillis(NOW);
const seconds = Math.floor(NOW / 1000);

const sign = (body: string, timestamp = seconds, secret = SECRET): string => {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${signature}`;
};

const eventBody = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        metadata: { counted_workspace_id: "ws_1", counted_plan: "pro" },
      },
    },
    ...over,
  });

describe("a signature is required and must be ours", () => {
  test("a correctly signed body verifies", () => {
    const body = eventBody();
    expect(verifySignature(body, sign(body), at, { secret: SECRET }).ok).toBe(true);
  });

  test("no header at all is refused", () => {
    expect(verifySignature(eventBody(), undefined, at, { secret: SECRET }).ok).toBe(false);
    expect(verifySignature(eventBody(), "", at, { secret: SECRET }).ok).toBe(false);
  });

  test("a signature made with a different secret is refused", () => {
    // The whole point. Anyone can POST to the endpoint; only Stripe can sign.
    const body = eventBody();
    const forged = sign(body, seconds, "whsec_attackerGuess");
    const result = verifySignature(body, forged, at, { secret: SECRET });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("bad_signature");
  });

  test("a body altered after signing is refused", () => {
    // The signature covers the body, so raising a plan or swapping a workspace
    // id invalidates it.
    const signature = sign(eventBody());
    const tampered = eventBody({ id: "evt_2" });
    expect(verifySignature(tampered, signature, at, { secret: SECRET }).ok).toBe(false);
  });

  test("a garbled header is refused rather than throwing", () => {
    for (const header of ["nonsense", "t=,v1=", "v1=abc", "t=abc,v1=def", "t=1,v2=def"]) {
      expect(verifySignature(eventBody(), header, at, { secret: SECRET }).ok).toBe(false);
    }
  });

  test("several signatures verify if any one matches", () => {
    // Stripe sends more than one while a secret is being rotated; rejecting
    // the new one during the overlap would be an outage.
    const body = eventBody();
    const real = createHmac("sha256", SECRET).update(`${seconds}.${body}`, "utf8").digest("hex");
    const header = `t=${seconds},v1=0000000000000000000000000000000000000000000000000000000000000000,v1=${real}`;
    expect(verifySignature(body, header, at, { secret: SECRET }).ok).toBe(true);
  });
});

describe("a captured request stops working", () => {
  test("a timestamp outside the tolerance is refused", () => {
    // A signature stays valid forever; the window is what bounds a replay.
    const body = eventBody();
    const old = seconds - TOLERANCE_SECONDS - 1;
    const result = verifySignature(body, sign(body, old), at, { secret: SECRET });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("stale");
      if (result.error.reason === "stale") expect(result.error.ageSeconds).toBeGreaterThan(TOLERANCE_SECONDS);
    }
  });

  test("a timestamp inside the tolerance is accepted", () => {
    const body = eventBody();
    expect(verifySignature(body, sign(body, seconds - 60), at, { secret: SECRET }).ok).toBe(true);
  });

  test("a future timestamp is bounded too, not just a past one", () => {
    // Clock skew cuts both ways, and an unbounded future timestamp would make
    // a captured request valid indefinitely.
    const body = eventBody();
    const future = seconds + TOLERANCE_SECONDS + 60;
    expect(verifySignature(body, sign(body, future), at, { secret: SECRET }).ok).toBe(false);
  });

  test("staleness is checked before the hash", () => {
    // So a flood of stale replays costs a subtraction each rather than an
    // HMAC. Observable: a stale request with a garbage signature still reports
    // `stale`, not `bad_signature`.
    const old = seconds - TOLERANCE_SECONDS - 1;
    const result = verifySignature(eventBody(), `t=${old},v1=garbage`, at, { secret: SECRET });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("stale");
  });
});

describe("Stripe's vocabulary becomes ours", () => {
  const parsed = (body: string) => translate(JSON.parse(body));

  test("checkout carries the plan and workspace from metadata", () => {
    // Read from metadata we set at checkout rather than inferred from a price
    // id, so adding a price cannot silently mean "unknown plan".
    const result = parsed(eventBody())!;
    expect(result.workspace).toBe(WorkspaceId("ws_1"));
    expect(result.event).toMatchObject({ kind: "checkout_completed", plan: "pro", customer: "cus_1" });
  });

  test("an unrecognised plan in metadata falls back to free", () => {
    // A typo must never hand out a paid allowance.
    const body = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { customer: "c", subscription: "s", metadata: { counted_plan: "enterprise-plus" } } },
    });
    expect(parsed(body)!.event).toMatchObject({ plan: "free" });
  });

  test("trialing counts as active; past_due does not", () => {
    const of = (status: string) =>
      parsed(
        JSON.stringify({
          id: "evt_1",
          type: "customer.subscription.updated",
          data: { object: { id: "sub_1", status, metadata: { counted_plan: "pro" } } },
        }),
      )!.event;

    // A trial is a customer using the product on the plan they chose.
    expect(of("trialing")).toMatchObject({ active: true });
    expect(of("active")).toMatchObject({ active: true });
    // past_due becomes its own transition, so the entitlement stays but is
    // flagged in grace rather than being read as "still fine".
    expect(of("past_due")).toMatchObject({ active: false });
    expect(of("canceled")).toMatchObject({ active: false });
  });

  test("invoice events become payment failed and recovered", () => {
    const of = (type: string) =>
      parsed(JSON.stringify({ id: "e", type, data: { object: { subscription: "sub_1" } } }))!.event;
    expect(of("invoice.payment_failed")).toMatchObject({ kind: "payment_failed" });
    expect(of("invoice.payment_succeeded")).toMatchObject({ kind: "payment_recovered" });
  });

  test("timestamps arrive in seconds and leave in milliseconds", () => {
    const body = JSON.stringify({
      id: "e",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", status: "active", current_period_end: 1_800_000_000 } },
    });
    const event = parsed(body)!.event as { renewsAt: Instant };
    expect(Instant.toISO(event.renewsAt)).toBe(new Date(1_800_000_000_000).toISOString());
  });

  test("an event type we do not act on translates to no event, not an error", () => {
    // Acknowledged rather than retried forever.
    const result = parsed(JSON.stringify({ id: "e", type: "customer.created", data: { object: {} } }))!;
    expect(result.id).toBe("e");
    expect(result.event).toBeNull();
  });

  test("checkout without a customer or subscription is not acted on", () => {
    // Guessing would be worse than acknowledging and alerting on the log line.
    const body = JSON.stringify({ id: "e", type: "checkout.session.completed", data: { object: {} } });
    expect(parsed(body)!.event).toBeNull();
  });

  test("a payload with no id or type is refused outright", () => {
    expect(translate({ data: {} })).toBeNull();
    expect(translate("not an object")).toBeNull();
    expect(translate(null)).toBeNull();
  });
});

describe("the gateway", () => {
  const gateway = (handler: (url: string, init: RequestInit) => Response) =>
    new StripeGateway({
      secretKey: "sk_test",
      webhookSecret: SECRET,
      prices: { monthly: "price_m", annual: "price_a" },
      fetch: (async (url: unknown, init: unknown) =>
        handler(String(url), init as RequestInit)) as unknown as typeof fetch,
    });

  test("checkout carries the workspace and plan into metadata", async () => {
    // Which is what makes the webhook's translation possible without inferring
    // anything from a price id.
    let body = "";
    const g = gateway((_, init) => {
      body = String(init.body);
      return new Response(JSON.stringify({ url: "https://checkout/x", expires_at: 1_800_000_000 }), { status: 200 });
    });

    const session = await g.createCheckoutSession({
      workspace: WorkspaceId("ws_1"),
      plan: "pro",
      cadence: "annual",
      customer: null,
      successUrl: "https://app/ok",
      cancelUrl: "https://app/no",
    });

    expect(session.url).toBe("https://checkout/x");
    expect(body).toContain("metadata%5Bcounted_workspace_id%5D=ws_1");
    expect(body).toContain("subscription_data%5Bmetadata%5D%5Bcounted_plan%5D=pro");
    // The annual cadence picked the annual price.
    expect(body).toContain("price_a");
  });

  test("an existing customer is reused rather than duplicated", async () => {
    let body = "";
    const g = gateway((_, init) => {
      body = String(init.body);
      return new Response(JSON.stringify({ url: "u" }), { status: 200 });
    });
    await g.createCheckoutSession({
      workspace: WorkspaceId("ws_1"),
      plan: "pro",
      cadence: "monthly",
      customer: "cus_existing",
      successUrl: "s",
      cancelUrl: "c",
    });
    expect(body).toContain("customer=cus_existing");
  });

  test("the portal is sent a return url", async () => {
    let body = "";
    const g = gateway((_, init) => {
      body = String(init.body);
      return new Response(JSON.stringify({ url: "https://portal/x" }), { status: 200 });
    });
    await g.createPortalSession({ customer: "cus_1", returnUrl: "https://app/settings/billing" });
    expect(body).toContain("return_url=https%3A%2F%2Fapp%2Fsettings%2Fbilling");
  });

  test("a provider error is thrown, not swallowed into an empty url", async () => {
    // A checkout button that goes nowhere is worse than one that reports an
    // outage.
    const g = gateway(() => new Response(JSON.stringify({ error: { message: "no such price" } }), { status: 400 }));
    await expect(
      g.createPortalSession({ customer: "cus_1", returnUrl: "https://app/settings/billing" }),
    ).rejects.toThrow("no such price");
  });

  test("the body is parsed only after the signature verifies", async () => {
    // Otherwise our JSON decoder runs over anything the internet sends.
    const g = gateway(() => new Response("{}", { status: 200 }));
    const result = g.verifyWebhook("{ not json", "t=1,v1=deadbeef", at);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).not.toBe("malformed");
  });

  test("a verified but unparseable body is reported as malformed", async () => {
    const g = gateway(() => new Response("{}", { status: 200 }));
    const body = "{ not json";
    const result = g.verifyWebhook(body, sign(body), at);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("malformed");
  });

  test("a verified event comes back translated", async () => {
    const g = gateway(() => new Response("{}", { status: 200 }));
    const body = eventBody();
    const result = g.verifyWebhook(body, sign(body), at);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("evt_1");
      expect(result.value.event).toMatchObject({ kind: "checkout_completed" });
    }
  });
});
