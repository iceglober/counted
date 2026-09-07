/**
 * `POST /v1/webhooks/stripe` — hand-written, because a framework that has
 * parsed the JSON has destroyed the thing being verified.
 *
 * The signature is computed over the body exactly as sent. Re-serialising a
 * parsed object changes key order and whitespace and the signature stops
 * matching, so this route reads `request.text()` and hands the string straight
 * to the gateway. That is the whole reason it is not an oRPC procedure.
 *
 * **Everything that is not a signature failure answers 200.** Stripe retries a
 * non-2xx for three days; an endpoint that 500s on the event types it does not
 * handle spends those days being hammered while the ones it does handle queue
 * behind it. An unrecognised type, and an event about a customer we cannot
 * identify, are both acknowledged — retrying will not make an unknown customer
 * known.
 *
 * A bad signature is a 400 and stays one. It is the one case where a retry is
 * pointless *and* the delivery must not be treated as ours.
 */

import { Instant } from "@counted/kernel";
import { recordBillingEvent, type RecordBillingEventDeps } from "@counted/tenancy-app";
import type { Logger } from "../logging";

export type WebhookOutcome = {
  readonly status: number;
  readonly body: unknown;
};

export type WebhookDeps = {
  readonly billing: RecordBillingEventDeps;
  readonly logger: Logger;
};

/** Stripe's own header. Named here so the route does not hunt for it inline. */
export const STRIPE_SIGNATURE_HEADER = "stripe-signature";

export const handleStripeWebhook = async (
  deps: WebhookDeps,
  request: Request,
  at: Instant,
): Promise<WebhookOutcome> => {
  const body = await request.text();
  const signature = request.headers.get(STRIPE_SIGNATURE_HEADER) ?? undefined;

  const outcome = await recordBillingEvent(deps.billing, { body, signature }, at);

  if (!outcome.ok) {
    switch (outcome.error.kind) {
      case "BadSignature":
      case "Stale":
      case "Malformed":
        // 400 and no retry. A forged delivery, a replayed one, and a body we
        // cannot read are all "do not send this again"; only the log
        // distinguishes them, and `Stale` carries its age so a clock-skew
        // outage is visible as one.
        deps.logger.warn("stripe delivery refused", {
          reason: outcome.error.kind,
          ...(outcome.error.kind === "Stale" ? { ageSeconds: outcome.error.ageSeconds } : {}),
        });
        return { status: 400, body: { error: outcome.error.kind } };
      default:
        // Something on our side failed after the signature checked out. 500 so
        // Stripe retries: the delivery was genuine and we lost it.
        deps.logger.error("stripe delivery failed", { reason: outcome.error.kind });
        return { status: 500, body: { error: outcome.error.kind } };
    }
  }

  const applied = outcome.value;
  deps.logger.info("stripe delivery handled", {
    result: applied.kind,
    ...(applied.kind === "ignored" ? { reason: applied.reason, event: applied.event } : {}),
    ...(applied.kind === "duplicate" ? { event: applied.event } : {}),
  });

  return { status: 200, body: { received: true, result: applied.kind } };
};
