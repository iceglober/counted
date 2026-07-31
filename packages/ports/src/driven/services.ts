/**
 * The remaining outbound ports: the small capabilities the domain cannot have
 * because they are I/O or non-determinism.
 */

import type { CredentialDigest, CredentialPrefix, DomainEventEnvelope, Instant } from "./types";

/**
 * Ids and secrets. The domain forbids randomness (`domain-has-no-io`), so
 * every id and every secret is minted out here and passed in. That is also
 * what makes aggregate tests deterministic without patching globals.
 */
export interface IdGenerator {
  next(): string;
}

export interface SecretGenerator {
  /** A fresh secret plus the digest to store. The secret is shown once. */
  issue(kind: string): {
    readonly secret: string;
    readonly digest: CredentialDigest;
    /** The display stub — what a human sees in a key list. Not sensitive. */
    readonly prefix: CredentialPrefix;
  };
  /** Hash a presented secret for comparison. Never reverses. */
  digest(secret: string): CredentialDigest;
}

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  invalidate(prefix: string): Promise<void>;
}

/**
 * Outbox — domain events leaving the transaction that produced them.
 *
 * Written in the same transaction as the aggregate, dispatched later by the
 * worker. That is what makes "the change happened but the email did not" a
 * recoverable state rather than a lost one.
 */
export interface Outbox {
  enqueue(events: readonly DomainEventEnvelope[]): Promise<void>;
  claim(limit: number): Promise<readonly DomainEventEnvelope[]>;
  markDispatched(ids: readonly string[], at: Instant): Promise<void>;
}

export type Notification =
  | { readonly channel: "email"; readonly to: string; readonly subject: string; readonly body: string }
  | { readonly channel: "webhook"; readonly url: string; readonly payload: unknown };

export interface Notifier {
  deliver(notification: Notification): Promise<void>;
}
