/** Re-exports and shared shapes so port files do not each reach into the domain. */
export type { CredentialDigest, CredentialPrefix, Instant } from "@counted/domain";

/** A domain event with the metadata the outbox needs to route and dedup it. */
export type DomainEventEnvelope = {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: import("@counted/domain").Instant;
  readonly payload: unknown;
};
