#!/usr/bin/env bun
/**
 * Stripe, for development. And the outbox's receiver, because both are
 * somebody else's server and neither should stop the product working locally.
 *
 *   bun scripts/dev-stripe.ts          # :8091, started by scripts/dev.sh
 *
 * The API refuses to start with a half-configured payment provider — a secret
 * key and no webhook secret means checkout works, the grant does not, and the
 * customer has paid for nothing — so "no Stripe locally" means no billing
 * routes at all, and the console's upgrade button 404s. This stands in.
 *
 * **It speaks Stripe's wire format, not the adapter's.** Form-encoded in, JSON
 * out, at the real paths, because the Stripe SDK does the encoding and what
 * arrives here is what would arrive at Stripe. `tests/journey` has a smaller
 * one of these for the same reason; this one differs in finishing the loop.
 *
 * A real checkout leaves the browser at a page on Stripe's domain, and the
 * grant arrives later as a webhook. Both halves happen here: the session's
 * `url` is a page this server renders, and paying on it delivers a signed
 * `checkout.session.completed` to the API before returning the browser to the
 * console. So the whole upgrade — button, hosted page, webhook, entitlement —
 * runs on a laptop with no Stripe account.
 *
 * What it is not is Stripe. It never declines a card, never sends an event
 * twice, and the prices are whatever the environment names. Anything that
 * turns on Stripe's own behaviour is unproven here and has to be proven
 * against a test-mode key.
 */

import { signPayload } from "@counted/adapter-stripe";
import { Instant } from "@counted/kernel";

export {}; // a module, so top-level await is legal

const PORT = Number(process.env["COUNTED_DEV_STRIPE_PORT"] ?? 8091);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const API = (process.env["COUNTED_API_URL"] ?? "http://localhost:8080").replace(/\/+$/, "");
const WEBHOOK_SECRET = process.env["STRIPE_WEBHOOK_SECRET"] ?? "whsec_dev";

/** Enough of a Stripe id to be recognisable in a log. */
const id = (prefix: string) => `${prefix}_dev${Math.random().toString(36).slice(2, 12)}`;

type Checkout = {
  readonly session: string;
  readonly customer: string;
  readonly subscription: string;
  readonly workspace: string;
  readonly metadata: Record<string, string>;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly price: string;
  paid: boolean;
};

const checkouts = new Map<string, Checkout>();
const portals = new Map<string, { readonly customer: string; readonly returnUrl: string }>();
/** The last subscription each workspace was granted, so the portal can cancel it. */
const subscriptions = new Map<string, { subscription: string; customer: string }>();

/**
 * Stripe's form encoding, flattened: `metadata[counted_plan]` is a key, not a
 * structure. Only the ones this stub reads are pulled out by name.
 */
const metadataFrom = (form: URLSearchParams, prefix: string): Record<string, string> => {
  const found: Record<string, string> = {};
  for (const [key, value] of form) {
    const match = key.match(new RegExp(`^${prefix}\\[([^\\]]+)\\]$`));
    if (match?.[1] !== undefined) found[match[1]] = value;
  }
  return found;
};

const page = (title: string, body: string): Response =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>
     <style>
       body { font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; max-width: 34rem;
              margin: 4rem auto; padding: 0 1.5rem; color: #111; }
       .card { border: 1px solid #ddd; border-radius: 10px; padding: 1.5rem; }
       .tag { display: inline-block; background: #fde68a; border-radius: 999px;
              padding: 0.1rem 0.6rem; font-size: 12px; font-weight: 600; }
       button { font: inherit; padding: 0.6rem 1.1rem; border-radius: 8px; border: 0;
                background: #111; color: #fff; cursor: pointer; }
       a { color: #555; }
       dt { color: #666; font-size: 13px; } dd { margin: 0 0 0.75rem; font-weight: 500; }
     </style>
     <p class="tag">Development stand-in — not Stripe</p>
     <div class="card">${body}</div>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

const seeOther = (location: string) => new Response(null, { status: 303, headers: { location } });

/**
 * Deliver an event the way Stripe would: the exact bytes, signed with the
 * secret the API was given. Failures are printed rather than thrown — a
 * webhook the API rejects is the interesting case, and losing this server
 * would take the whole upgrade flow down with it.
 */
const deliver = async (type: string, object: Record<string, unknown>): Promise<number> => {
  const body = JSON.stringify({ id: id("evt"), object: "event", type, data: { object } });
  const signature = signPayload(WEBHOOK_SECRET, body, Instant.fromEpochMillis(Date.now()));
  try {
    const response = await fetch(`${API}/v1/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body,
    });
    console.log(`  → ${type} to the API: ${response.status}`);
    return response.status;
  } catch (cause) {
    console.log(`  → ${type} could not be delivered: ${String(cause)}`);
    return 0;
  }
};

const server = Bun.serve({
  port: PORT,
  idleTimeout: 30,
  fetch: async (request) => {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") return Response.json({ ok: true, stripe: "development stand-in" });

    // ── the API calls these, as Stripe ───────────────────────────────────
    if (path.startsWith("/v1/prices/") && request.method === "GET") {
      const price = decodeURIComponent(path.slice("/v1/prices/".length));
      const annual = price === process.env["STRIPE_PRICE_PRO_ANNUAL"] || price.includes("annual");
      return Response.json({ id: price, object: "price", active: true, currency: "usd", unit_amount: annual ? 9900 : 990,
        recurring: { interval: annual ? "year" : "month", interval_count: 1 } });
    }
    if (path.startsWith("/v1/subscriptions/") && request.method === "GET") {
      const reference = decodeURIComponent(path.slice("/v1/subscriptions/".length));
      const checkout = [...checkouts.values()].find(one => one.subscription === reference);
      if (!checkout) return Response.json({ error: { message: "Unknown development subscription" } }, { status: 404 });
      const annual = checkout.metadata["counted_cadence"] === "annual";
      return Response.json({ id: reference, cancel_at_period_end: false, items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + (annual ? 365 : 30) * 86400,
        price: { unit_amount: annual ? 9900 : 990, currency: "usd", recurring: { interval: annual ? "year" : "month", interval_count: 1 } } }] } });
    }
    if (path === "/v1/checkout/sessions" && request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      const metadata = metadataFrom(form, "metadata");
      const session = id("cs");
      checkouts.set(session, {
        session,
        customer: id("cus"),
        subscription: id("sub"),
        workspace: form.get("client_reference_id") ?? metadata["counted_workspace"] ?? "",
        metadata,
        successUrl: form.get("success_url") ?? `${ORIGIN}/health`,
        cancelUrl: form.get("cancel_url") ?? `${ORIGIN}/health`,
        price: form.get("line_items[0][price]") ?? "",
        paid: false,
      });
      console.log(`checkout ${session} for workspace ${metadata["counted_workspace"] ?? "?"}`);
      return Response.json({
        id: session,
        object: "checkout.session",
        url: `${ORIGIN}/checkout/${session}`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      });
    }

    if (path === "/v1/billing_portal/sessions" && request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      const session = id("bps");
      portals.set(session, {
        customer: form.get("customer") ?? "",
        returnUrl: form.get("return_url") ?? `${ORIGIN}/health`,
      });
      return Response.json({
        id: session,
        object: "billing_portal.session",
        url: `${ORIGIN}/portal/${session}`,
      });
    }

    // ── the browser lands on these, as Stripe's hosted pages ─────────────
    const checkoutMatch = path.match(/^\/checkout\/([^/]+)(\/pay|\/cancel)?$/);
    if (checkoutMatch?.[1] !== undefined) {
      const checkout = checkouts.get(checkoutMatch[1]);
      if (checkout === undefined) return page("Unknown session", "<p>No such checkout session.</p>");

      if (checkoutMatch[2] === "/cancel") return seeOther(checkout.cancelUrl);

      if (checkoutMatch[2] === "/pay" && request.method === "POST") {
        checkout.paid = true;
        subscriptions.set(checkout.customer, {
          subscription: checkout.subscription,
          customer: checkout.customer,
        });
        // The event the entitlement actually turns on. `mode` and
        // `payment_status` are both guards the translator applies before
        // granting: a setup-mode session is not a subscription starting, and
        // an unpaid one can still be declined by the bank.
        await deliver("checkout.session.completed", {
          id: checkout.session,
          object: "checkout.session",
          mode: "subscription",
          payment_status: "paid",
          customer: checkout.customer,
          subscription: checkout.subscription,
          client_reference_id: checkout.workspace,
          metadata: checkout.metadata,
        });
        return seeOther(checkout.successUrl);
      }

      return page(
        "Confirm subscription",
        `<h2 style="margin-top:0">Subscribe to Counted</h2>
         <dl>
           <dt>Workspace</dt><dd>${checkout.workspace || "—"}</dd>
           <dt>Plan</dt><dd>${checkout.metadata["counted_plan"] ?? "pro"} ·
             ${checkout.metadata["counted_cadence"] ?? "monthly"}</dd>
           <dt>Price</dt><dd>${checkout.price || "—"}</dd>
         </dl>
         <form method="post" action="/checkout/${checkout.session}/pay">
           <button type="submit">Pay</button>
         </form>
         <p><a href="/checkout/${checkout.session}/cancel">Cancel and go back</a></p>`,
      );
    }

    const portalMatch = path.match(/^\/portal\/([^/]+)(\/cancel)?$/);
    if (portalMatch?.[1] !== undefined) {
      const portal = portals.get(portalMatch[1]);
      if (portal === undefined) return page("Unknown session", "<p>No such portal session.</p>");

      if (portalMatch[2] === "/cancel" && request.method === "POST") {
        const known = subscriptions.get(portal.customer);
        if (known !== undefined) {
          await deliver("customer.subscription.deleted", {
            id: known.subscription,
            object: "subscription",
            customer: known.customer,
          });
        } else {
          console.log(`  → no subscription remembered for ${portal.customer}; nothing cancelled`);
        }
        return seeOther(portal.returnUrl);
      }

      return page(
        "Billing",
        `<h2 style="margin-top:0">Manage billing</h2>
         <p>Customer <code>${portal.customer}</code>.</p>
         <form method="post" action="/portal/${portalMatch[1]}/cancel">
           <button type="submit">Cancel subscription</button>
         </form>
         <p><a href="${portal.returnUrl}">Back to Counted</a></p>`,
      );
    }

    /**
     * The outbox's receiver. The worker signs and POSTs monitor envelopes at
     * `COUNTED_OUTBOX_SINK_URL`, and with nowhere to send them the dispatch
     * job has nothing to do and its whole path goes unexercised locally.
     */
    if (path === "/outbox" && request.method === "POST") {
      const body = await request.text();
      // The envelope's name, never its payload: `CredentialIssued` carries the
      // key it just minted, and a terminal is a place secrets get pasted from.
      let described = `${body.length} bytes`;
      try {
        const envelope = JSON.parse(body) as { id?: unknown; type?: unknown };
        described = `${String(envelope.type)} ${String(envelope.id)}`;
      } catch {
        // Not JSON. The length is all there is to say, and it is enough.
      }
      console.log(`outbox ← ${described}`);
      return new Response(null, { status: 204 });
    }

    return Response.json({ error: { message: `no ${request.method} ${path} here` } }, { status: 404 });
  },
});

console.log(`  stripe stand-in  ${ORIGIN}  (checkout pages, webhooks to ${API})`);

const stop = () => {
  void server.stop(true);
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
