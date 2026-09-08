import * as z from "zod";
import { MAX_ID_LENGTH } from "@counted/kernel";

/** The accepted event wire shape. Invalid individual events receive receipt outcomes. */
export const IngestEventSchema = z.looseObject({
  name: z.string().min(1).max(128).regex(/^[^\s\u0000-\u001f\u007f]+$/)
    .describe("Your event name, such as page_view. The agent_ prefix uses the published agent vocabulary."),
  visitId: z.string().min(1).max(MAX_ID_LENGTH).regex(/^\S+$/)
    .describe("An ephemeral activity grouping held in memory, with a fresh value after 30 minutes idle. Never a persistent user or device identifier."),
  userId: z.string().min(1).max(128).nullable().optional()
    .describe("Optional customer-supplied opaque identifier from an explicit identify() call. Email addresses are refused. Omit for anonymous events."),
  occurredAt: z.union([z.iso.datetime(), z.number()]).nullable().optional()
    .describe("ISO-8601 UTC or epoch milliseconds. Omit to use receipt time. Default admission allows 30 days of age and five minutes of future clock skew."),
  idempotencyKey: z.string().nullable().optional()
    .describe("A unique key for this event. Reuse the same key AND occurredAt when retrying. Without both, cross-request deduplication is not guaranteed."),
  properties: z.record(z.string().min(1).max(64), z.union([z.string().max(1024), z.number(), z.boolean(), z.null()]))
    .nullable().optional().describe("Up to 64 flat custom properties. Strings, numbers, booleans and null are supported; nested objects and arrays are rejected. Do not send PII."),
  systemProperties: z.looseObject({
    os_name: z.string().nullable().optional(),
    os_version: z.string().nullable().optional(),
    locale: z.string().nullable().optional(),
    app_version: z.string().nullable().optional(),
    device_model: z.string().nullable().optional(),
    sdk_version: z.string().nullable().optional(),
  }).nullable().optional().describe("Optional system dimensions; strings are trimmed and capped at 128 characters. Country is derived at the edge and cannot be supplied here."),
});

export const IngestRequestSchema = z.looseObject({
  events: z.array(IngestEventSchema).max(250)
    .describe("Up to 250 events per batch by default. The project and workspace come from the credential, never from this body."),
});

export const IngestEventOutcomeSchema = z.object({
  index: z.int().nonnegative().describe("Zero-based position in the submitted events array."),
  accepted: z.literal(false),
  reason: z.enum(["MalformedEvent", "UnknownEventName", "ClockSkew", "PersonIdRequired", "PersonIdTooLong", "PersonIdLooksLikeEmail"]),
});

export const IngestReceiptSchema = z.object({
  accepted: z.int().nonnegative().describe("Events newly written durably."),
  deduplicated: z.int().nonnegative().describe("Events already stored, or repeated within this batch."),
  rejected: z.int().nonnegative().describe("Events rejected individually. A 202 can still contain rejections."),
  outcomes: z.array(IngestEventOutcomeSchema).optional()
    .describe("Only rejected events are listed. Omitted when no events were rejected. Fix these events before submitting them again."),
});

export const IngestFailureSchema = z.looseObject({
  code: z.string(), detail: z.string(), retryable: z.boolean(),
  reason: z.string().optional(),
  required: z.string().optional(),
  count: z.number().optional(), max: z.number().optional(), bytes: z.number().optional(),
  limit: z.number().optional(), used: z.number().optional(), retryAfterMs: z.number().optional(),
}).describe("Whole-batch failure: no event was acknowledged. Only retry when retryable is true; observe Retry-After when present.");

export type IngestEvent = z.infer<typeof IngestEventSchema>;
export type IngestRequest = z.infer<typeof IngestRequestSchema>;
export type IngestReceipt = z.infer<typeof IngestReceiptSchema>;
export type IngestFailure = z.infer<typeof IngestFailureSchema>;
