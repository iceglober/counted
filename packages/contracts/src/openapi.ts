/**
 * The OpenAPI document, generated from the Zod schemas.
 *
 * Nothing here is hand-written prose about what the API does — the shapes come
 * from the same schemas the server validates with, so the document cannot
 * describe an endpoint that does not exist or omit one that does.
 *
 * `openapi.json` is a committed build artifact. CI regenerates it and fails on
 * any difference, which is what makes drift impossible rather than merely
 * discouraged.
 */

import { OpenApiGeneratorV31, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { ProblemSchema } from "./schemas/common";
import { IngestReceiptSchema, IngestRequestSchema } from "./schemas/ingest";
import { QueryRequestSchema, QueryResponseSchema } from "./schemas/query";
import { LivenessSchema, ReadinessSchema } from "./schemas/health";

export const OPENAPI_VERSION = "3.1.0";
export const API_VERSION = "0.1.0";

const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});

export const buildRegistry = (): OpenAPIRegistry => {
  const registry = new OpenAPIRegistry();

  const ingestKey = registry.registerComponent("securitySchemes", "ingestKey", {
    type: "apiKey",
    in: "header",
    name: "Project-Key",
    description: "A public ingest credential. Safe to embed; grants events:write and nothing else.",
  });
  const serviceKey = registry.registerComponent("securitySchemes", "serviceKey", {
    type: "http",
    scheme: "bearer",
    description: "A secret service credential, scoped to the operations it was issued for.",
  });

  registry.registerPath({
    method: "get",
    path: "/health",
    summary: "Liveness",
    description:
      "Is this process running? Never touches the database, so a database blip cannot cause a restart loop.",
    tags: ["health"],
    responses: { 200: { description: "Alive", ...json(LivenessSchema) } },
  });

  registry.registerPath({
    method: "get",
    path: "/health/ready",
    summary: "Readiness",
    description: "Can this instance serve traffic? Pings the store and reports what it verified at boot.",
    tags: ["health"],
    responses: {
      200: { description: "Ready", ...json(ReadinessSchema) },
      503: { description: "Not ready", ...json(ReadinessSchema) },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/events",
    summary: "Ingest events",
    description:
      "Accepts up to 50 events. Resolves only after the batch is durably committed, so a 202 means the " +
      "data is written. Every event gets its own outcome, and the quota state is named rather than implied.",
    tags: ["ingest"],
    security: [{ [ingestKey.name]: [] }],
    request: { body: json(IngestRequestSchema) },
    responses: {
      202: { description: "Committed", ...json(IngestReceiptSchema) },
      400: problem("The batch could not be read"),
      401: problem("Missing or unknown credential"),
      403: problem("The credential may not write events"),
      413: problem("Payload too large"),
      429: problem("Rate limited; see Retry-After"),
      503: problem("The store is unavailable; retry"),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/query",
    summary: "Run an analysis",
    description: "Answers one question. The response is tagged with its shape; the caller never has to infer it.",
    tags: ["read"],
    security: [{ [serviceKey.name]: [] }],
    request: { body: json(QueryRequestSchema) },
    responses: {
      200: { description: "The answer", ...json(QueryResponseSchema) },
      400: problem("The analysis is not well formed"),
      401: problem("Missing or unknown credential"),
      403: problem("The credential may not read this project"),
      504: problem("The query exceeded its budget"),
    },
  });

  return registry;
};

export const buildOpenApiDocument = (): object =>
  new OpenApiGeneratorV31(buildRegistry().definitions).generateDocument({
    openapi: OPENAPI_VERSION,
    info: {
      title: "Counted API",
      version: API_VERSION,
      description:
        "Privacy-first product analytics. No cookies, no fingerprinting, no PII. " +
        "Identity is optional and always supplied by the caller.",
    },
    servers: [{ url: "https://api.counted.dev" }],
    tags: [
      { name: "health", description: "Liveness and readiness" },
      { name: "ingest", description: "Writing events" },
      { name: "read", description: "Asking questions" },
    ],
  });
