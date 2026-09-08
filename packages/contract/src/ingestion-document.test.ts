import { expect, test } from "bun:test";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { contract, API_INFO, SECURITY_SCHEME_DEFINITIONS } from "./index";
import { INGESTION_PATHS, INGESTION_SCHEMAS } from "./ingestion-document";
import { IngestReceiptSchema } from "./schemas/ingestion";

test("the same generated reference includes the dedicated ingestion transport without adding an RPC handler", async () => {
  const document = await new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] }).generate(contract, {
    base: { info: API_INFO, paths: INGESTION_PATHS,
      components: { schemas: INGESTION_SCHEMAS, securitySchemes: { ...SECURITY_SCHEME_DEFINITIONS } } },
  });
  const ingest = document.paths?.["/v1/events"]?.post;
  expect(ingest?.operationId).toBe("events.ingest");
  expect(ingest?.tags).toEqual(["events"]);
  expect(ingest?.security).toEqual([{ ingestKey: [] }, { serviceKey: [] }, { ingestBeacon: [] }]);
  expect(ingest?.responses?.["202"]).toBeDefined();
  expect(document.paths?.["/v1/me"]?.get).toBeDefined();
  expect(document.components?.schemas?.["IngestRequest"]).toBeDefined();
  expect("events" in contract).toBe(false);
});

test("every success example is a valid receipt, including a partial batch", () => {
  const examples = INGESTION_PATHS["/v1/events"].post.responses["202"].content["application/json"].examples;
  for (const example of Object.values(examples)) expect(IngestReceiptSchema.safeParse(example.value).success).toBe(true);
});
