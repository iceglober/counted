/**
 * The ingestion contract — the most important shape in the product.
 *
 * v1 returned `202` with an **empty body**. No event ids, no accepted/rejected
 * counts, no server timestamp, no idempotency key. And past the hard quota
 * limit it returned a byte-identical `202` with the event silently discarded,
 * so a customer could be losing every event and see nothing but success.
 *
 * Here a receipt says what happened, per event, and the quota state is named.
 */

import { InstantSchema, z } from "./common";

export const IngestEventSchema = z
  .object({
    name: z.string().min(1).max(200),
    /** Client-generated, ephemeral, not an identity. */
    visitId: z.string().min(1).max(100),
    /**
     * Only ever supplied by the customer's own application, via identify().
     * Counted never derives or infers one.
     */
    userId: z.string().min(1).max(200).optional(),
    /**
     * When it happened. The SDK stamps this at track() time and holds it in its
     * on-device queue, so a retry carries the same instant — which is what
     * makes the dedup key work.
     */
    occurredAt: InstantSchema.optional(),
    /** Makes a retry idempotent. Same key plus same instant is the same event. */
    idempotencyKey: z.string().min(1).max(200).optional(),
    properties: z
      .record(z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]))
      .refine((p) => Object.keys(p).length <= 50, { message: "at most 50 properties" })
      .optional(),
    systemProperties: z.record(z.string().nullable()).optional(),
  })
  .openapi("IngestEvent");

export const IngestRequestSchema = z
  .object({ events: z.array(IngestEventSchema).min(1).max(50) })
  .openapi("IngestRequest");

/** Per event, so one bad event does not reject the whole batch. */
export const IngestOutcomeSchema = z
  .discriminatedUnion("accepted", [
    z.object({ index: z.number().int(), accepted: z.literal(true), deduplicated: z.boolean() }),
    z.object({ index: z.number().int(), accepted: z.literal(false), reason: z.string() }),
  ])
  .openapi("IngestOutcome");

/**
 * Quota is named rather than implied. `overage` means stored but past the
 * allowance; `rejected` means not stored. v1 had no name for the middle band
 * and made the third indistinguishable from success.
 */
export const QuotaStateSchema = z
  .object({
    state: z.enum(["ok", "overage", "rejected"]),
    used: z.number().int(),
    limit: z.number().int().nullable(),
  })
  .openapi("QuotaState");

export const IngestReceiptSchema = z
  .object({
    accepted: z.number().int(),
    deduplicated: z.number().int(),
    rejected: z.number().int(),
    outcomes: z.array(IngestOutcomeSchema),
    quota: QuotaStateSchema,
    /** A real commit time, not a guess — the write has landed. */
    committedAt: InstantSchema,
  })
  .openapi("IngestReceipt");
