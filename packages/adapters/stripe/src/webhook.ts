/**
 * Verifying and translating Stripe webhooks.
 *
 * Two jobs, kept apart:
 *
 *   **Verify.** Constant-time HMAC over `timestamp.body`, with a tolerance
 *   window. Done by hand rather than through the SDK so the check is visible
 *   and testable — this is the one place where getting it wrong means anyone
 *   on the internet can grant themselves a paid plan.
 *
 *   **Translate.** Stripe's event vocabulary into ours. The domain reasons
 *   about five things that can happen to a subscription; Stripe has dozens of
 *   event types, and the ones we do not act on are acknowledged rather than
 *   guessed at, so Stripe stops retrying them.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  Instant,
  WorkspaceId,
  isPlanId,
  type BillingEvent,
  type PlanId,
} from "@counted/domain";
import type { VerifiedWebhook, WebhookRejection } from "@counted/ports";

/**
 * How far out of step a timestamp may be.
 *
 * Five minutes is Stripe's own recommendation. It bounds a replay: a captured
 * request stops working shortly after it was captured, even though its
 * signature stays valid forever.
 */
export const TOLERANCE_SECONDS = 300;

type Parsed = { timestamp: number; signatures: readonly string[] };

/** `t=1699999999,v1=abc…,v1=def…` — several signatures during a secret rotation. */
const parseHeader = (header: string): Parsed | null => {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && value !== undefined) timestamp = Number(value);
    if (key === "v1" && value !== undefined) signatures.push(value);
  }
  if (timestamp === null || !Number.isFinite(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
};

const constantTimeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // `timingSafeEqual` throws on a length mismatch, which would itself be a
  // timing signal. Compare lengths first and keep the comparison constant-time
  // for equal-length inputs, which is the case that matters.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

export type VerifyOptions = {
  readonly secret: string;
  readonly toleranceSeconds?: number;
};

export const verifySignature = (
  body: string,
  header: string | undefined,
  at: Instant,
  options: VerifyOptions,
): { ok: true } | { ok: false; error: WebhookRejection } => {
  if (header === undefined || header.length === 0) return { ok: false, error: { reason: "bad_signature" } };

  const parsed = parseHeader(header);
  if (parsed === null) return { ok: false, error: { reason: "bad_signature" } };

  const tolerance = options.toleranceSeconds ?? TOLERANCE_SECONDS;
  const ageSeconds = Math.abs(Math.floor(Instant.toEpochMillis(at) / 1000) - parsed.timestamp);
  // Checked before the HMAC, so a flood of stale replays costs a subtraction
  // rather than a hash each.
  if (ageSeconds > tolerance) return { ok: false, error: { reason: "stale", ageSeconds } };

  const expected = createHmac("sha256", options.secret).update(`${parsed.timestamp}.${body}`, "utf8").digest("hex");
  // Any of them: Stripe sends several while a secret is being rotated, and
  // rejecting the new one during the overlap would be an outage.
  const matched = parsed.signatures.some((candidate) => constantTimeEquals(candidate, expected));
  return matched ? { ok: true } : { ok: false, error: { reason: "bad_signature" } };
};

// ── Translation ──────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

const asObject = (raw: unknown): Json | null =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Json) : null;

const asString = (raw: unknown): string | null => (typeof raw === "string" && raw.length > 0 ? raw : null);

/** Stripe sends seconds; the domain speaks milliseconds. */
const asInstant = (raw: unknown): Instant | null =>
  typeof raw === "number" && Number.isFinite(raw) ? Instant.fromEpochMillis(raw * 1000) : null;

/**
 * Which plan a subscription is on.
 *
 * Read from metadata we set at checkout rather than inferred from a price id,
 * so adding a price does not silently mean "unknown plan". An unrecognised
 * value falls back to free: a typo must never hand out a paid allowance.
 */
const planFrom = (metadata: Json | null): PlanId => {
  const raw = asString(metadata?.["counted_plan"]);
  return raw !== null && isPlanId(raw) ? raw : "free";
};

const workspaceFrom = (metadata: Json | null): WorkspaceId | null => {
  const raw = asString(metadata?.["counted_workspace_id"]);
  return raw === null ? null : WorkspaceId(raw);
};

/**
 * Stripe statuses we treat as paid.
 *
 * `trialing` counts: a trial is a customer using the product on the plan they
 * chose. `past_due` deliberately does not — it becomes its own transition, so
 * the entitlement stays but is flagged in grace.
 */
const ACTIVE_STATUSES: readonly string[] = ["active", "trialing"];

export const translate = (payload: unknown): Omit<VerifiedWebhook, "id" | "type"> & { id: string; type: string } | null => {
  const root = asObject(payload);
  if (root === null) return null;

  const id = asString(root["id"]);
  const type = asString(root["type"]);
  if (id === null || type === null) return null;

  const object = asObject(asObject(root["data"])?.["object"] ?? null);
  const metadata = asObject(object?.["metadata"] ?? null);
  const workspace = workspaceFrom(metadata);

  const event = ((): BillingEvent | null => {
    switch (type) {
      case "checkout.session.completed": {
        const customer = asString(object?.["customer"]);
        const subscription = asString(object?.["subscription"]);
        // Without both we cannot act, and guessing would be worse than
        // acknowledging and alerting on the log line.
        if (customer === null || subscription === null) return null;
        return {
          kind: "checkout_completed",
          plan: planFrom(metadata),
          customer,
          subscription,
          renewsAt: asInstant(object?.["expires_at"]),
        };
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = asString(object?.["id"]);
        if (subscription === null) return null;
        const status = asString(object?.["status"]) ?? "";
        return {
          kind: "subscription_updated",
          plan: planFrom(metadata),
          subscription,
          renewsAt: asInstant(object?.["current_period_end"]),
          active: ACTIVE_STATUSES.includes(status),
        };
      }

      case "customer.subscription.deleted": {
        const subscription = asString(object?.["id"]);
        return subscription === null ? null : { kind: "subscription_canceled", subscription };
      }

      case "invoice.payment_failed": {
        const subscription = asString(object?.["subscription"]);
        return subscription === null ? null : { kind: "payment_failed", subscription };
      }

      case "invoice.payment_succeeded": {
        const subscription = asString(object?.["subscription"]);
        return subscription === null ? null : { kind: "payment_recovered", subscription };
      }

      default:
        // Everything else: recorded, acknowledged, not acted on. Returning an
        // error instead would make Stripe retry an event we will never want.
        return null;
    }
  })();

  return { id, type, workspace, event };
};
