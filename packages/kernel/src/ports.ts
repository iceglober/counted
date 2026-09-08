/**
 * The three capabilities more than one context needs and none of them owns.
 *
 * They live in the kernel because the alternative is worse: putting `Clock` in
 * one context's ports package and having six others import it makes that
 * context look like a dependency of the whole system when it is not.
 *
 * **No domain package may import this file.** A domain function is handed the
 * instant it acts at and the id it mints with; it never reaches for either.
 * That is the difference between a testable rule and ambient state, and it is
 * enforced by the `domain-takes-values-not-capabilities` rule in
 * .dependency-cruiser.cjs. Import it from `app`, from adapters, and from the
 * composition root.
 */

import type { Duration } from "./duration";
import { Instant } from "./instant";

/** Where time enters the system. Exactly one implementation reads a machine clock. */
export interface Clock {
  now(): Instant;
}

/** A clock frozen at one instant. For tests and for deterministic replay. */
export const fixedClock = (at: Instant): Clock => ({ now: () => at });

/**
 * A clock that advances only when told to. Lets a test express "an hour
 * passes" without sleeping and without touching global state.
 */
export const scriptedClock = (start: Instant): Clock & { advance(by: Duration): void } => {
  let current = start;
  return {
    now: () => current,
    advance(by: Duration) {
      current = Instant.plus(current, by);
    },
  };
};

/**
 * Ids and the only randomness the system has. The domain forbids both, so
 * every id is minted here and passed in — which is also what makes aggregate
 * tests deterministic without patching globals.
 */
export interface IdGenerator {
  next(): string;
}

export type Notification =
  | {
      readonly channel: "email";
      /** Stable provider idempotency key when the caller has a durable delivery. */
      readonly id?: string;
      readonly to: string;
      readonly subject: string;
      readonly body: string;
    }
  | {
      readonly channel: "webhook";
      readonly url: string;
      /**
       * Stable across redeliveries, and sent as `webhook-id`. Part of the
       * notification rather than passed alongside it, because the receiver's
       * ability to deduplicate is part of what is being delivered — delivery is
       * at-least-once, and this is what makes that survivable.
       */
      readonly id: string;
      readonly payload: unknown;
    };

/**
 * Delivering a notification. Shared by tenancy (billing warnings, invitations)
 * and dashboarding (monitor breaches), which is why it belongs to neither.
 */
export interface Notifier {
  deliver(notification: Notification): Promise<void>;
}
