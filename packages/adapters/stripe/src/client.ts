/**
 * Constructing the real Stripe client. The only line in this package that
 * touches the SDK at runtime.
 *
 * Kept apart from `stripeBillingGateway` so the gateway takes a `StripeApi`
 * and can be tested without a key, a network or a fake HTTP layer — and so the
 * composition root is the only place a secret key is read.
 *
 * The API version is left at the SDK's own default (2026-08-26.dahlia for
 * stripe@22.6.0). Pinning it here would fix the wire format while the *types*
 * this package reads against keep moving with the package version, which is
 * the mismatch that hides field relocations like `current_period_end` leaving
 * `Subscription` — see translate.ts.
 */

import Stripe from "stripe";
import type { StripeApi } from "./gateway";

export type StripeClientConfig = {
  readonly secretKey: string;
  /** Retries on Stripe's side of a network failure. Stripe's own default is 0. */
  readonly maxNetworkRetries?: number;
  /**
   * Where the API lives, when it is not Stripe.
   *
   * This is what `stripe-mock` is for, and what the end-to-end journey suite
   * points at a local stub. Without it there is no way to exercise checkout
   * end to end without a live secret key, so the route that takes a customer's
   * money can only ever be tested by taking money — which is why nobody tests
   * it. Unset in production, and a live `sk_live_` key with this set would
   * still only ever talk to whatever it names.
   */
  readonly apiBase?: string;
};

/**
 * Split an origin into the three options Stripe's SDK actually takes. It has
 * no single base-URL option: `host`, `port` and `protocol` are separate, and
 * setting only `host` leaves the port at 443 and the protocol at https.
 */
const apiTarget = (base: string): Pick<Stripe.StripeConfig, "host" | "port" | "protocol"> => {
  const url = new URL(base);
  const protocol = url.protocol === "http:" ? "http" : "https";
  return {
    host: url.hostname,
    port: Number(url.port === "" ? (protocol === "http" ? "80" : "443") : url.port),
    protocol,
  };
};

export const stripeClient = (config: StripeClientConfig): StripeApi =>
  new Stripe(config.secretKey, {
    maxNetworkRetries: config.maxNetworkRetries ?? 2,
    ...(config.apiBase === undefined ? {} : apiTarget(config.apiBase)),
  });
