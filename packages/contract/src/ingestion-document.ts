import * as z from "zod";
import type { OpenAPIDocument } from "@orpc/openapi";
import { IngestEventSchema, IngestRequestSchema, IngestReceiptSchema, IngestFailureSchema } from "./schemas/ingestion";

type SchemaObject = NonNullable<NonNullable<OpenAPIDocument["components"]>["schemas"]>[string];
const jsonSchema = (schema: z.ZodType): SchemaObject => {
  const { $schema: _, ...generated } = z.toJSONSchema(schema);
  // Both describe JSON Schema 2020-12; oRPC narrows some string vocabularies
  // further than Zod's output type (for example contentEncoding).
  return generated as unknown as SchemaObject;
};

/** The hot path shares the public wire contract while retaining its group-commit transport. */
export const INGESTION_SCHEMAS = {
  IngestEvent: jsonSchema(IngestEventSchema),
  IngestRequest: jsonSchema(IngestRequestSchema),
  IngestReceipt: jsonSchema(IngestReceiptSchema),
  IngestFailure: jsonSchema(IngestFailureSchema),
};

const failure = (description: string, code: string, retryable: boolean, reason?: string) => ({
  description,
  content: { "application/json": {
    schema: { $ref: "#/components/schemas/IngestFailure" },
    example: { code, detail: description, retryable, ...(reason ? { reason } : {}) },
  } },
});

export const INGESTION_PATHS = {
  "/v1/events": { post: {
    operationId: "events.ingest", tags: ["events"], summary: "Ingest events",
    description: "Write a batch to the credential’s project. A 202 is returned after group commit is durable; inspect rejected and outcomes because valid events may be accepted alongside invalid ones. Use a project ingest key, or a project-bound service key with events:write. Console sessions and workspace-wide keys cannot ingest. Default limits are 250 events and 1 MiB per batch. Keep idempotencyKey and occurredAt unchanged when retrying. The beacon query-key option supports clients that cannot set Authorization headers.",
    security: [{ ingestKey: [] }, { serviceKey: [] }, { ingestBeacon: [] }],
    "x-counted-transport": "group-commit",
    requestBody: { required: true, content: { "application/json": {
      schema: { $ref: "#/components/schemas/IngestRequest" },
      example: { events: [{ name: "page_view", visitId: "ephemeral-visit", properties: { url: "/pricing", source: "docs" } }] },
    } } },
    responses: {
      "202": {
        description: "The receipt follows a durable commit. Accepted plus deduplicated plus rejected equals the submitted event count.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/IngestReceipt" }, examples: {
          accepted: { summary: "All events stored", value: { accepted: 2, deduplicated: 0, rejected: 0 } },
          retry: { summary: "A previously committed event", value: { accepted: 0, deduplicated: 1, rejected: 0 } },
          partial: { summary: "One invalid event", value: { accepted: 1, deduplicated: 0, rejected: 1, outcomes: [{ index: 1, accepted: false, reason: "MalformedEvent" }] } },
        } } },
      },
      "400": failure("The body must be JSON with an events array.", "BAD_REQUEST", false),
      "401": failure("No usable credential was presented.", "UNAUTHORIZED", false),
      "402": failure("The workspace event quota refuses further ingestion.", "PAYMENT_REQUIRED", false, "PlanExceeded"),
      "403": failure("This credential cannot write events to a project.", "FORBIDDEN", false, "NotPermitted"),
      "404": failure("No such project.", "NOT_FOUND", false),
      "413": failure("The event count or body size exceeds the configured limit.", "PAYLOAD_TOO_LARGE", false),
      "429": { ...failure("Too many requests. Back off before retrying.", "TOO_MANY_REQUESTS", true, "RateLimited"), headers: {
        "Retry-After": { description: "Minimum seconds to wait before retrying.", schema: { type: "string", pattern: "^[0-9]+$" } },
      } },
      "503": failure("The event store is unavailable. Retry with the same event keys and timestamps.", "SERVICE_UNAVAILABLE", true, "SinkUnavailable"),
    },
  } },
};
