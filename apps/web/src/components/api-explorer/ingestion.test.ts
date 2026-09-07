import { expect, test } from "bun:test";
import { INGESTION_PATHS, INGESTION_SCHEMAS, API_INFO, SECURITY_SCHEME_DEFINITIONS } from "@counted/contract";
import { buildRequest, initialValue, operationsOf, operationGroupsOf, requestSchema, validateValue, type ApiDocument } from "@counted/openapi";

const document = { openapi: "3.1.2", info: API_INFO, paths: INGESTION_PATHS,
  components: { schemas: INGESTION_SCHEMAS, securitySchemes: SECURITY_SCHEME_DEFINITIONS } } as unknown as ApiDocument;
const operation = operationsOf(document)[0]!;
const event = { name: "page_view", visitId: "ephemeral-visit", properties: { url: "/pricing", source: "explorer" } };

test("ingestion appears in the Events resource and its generated form produces a valid request", () => {
  expect(operationGroupsOf(document)[0]?.name).toBe("events");
  expect(operation.operationId).toBe("events.ingest");
  const schema = requestSchema(operation)!;
  const body = initialValue(document, schema, { events: [event] });
  expect(validateValue(document, schema, body)).toEqual([]);
  const request = buildRequest(document, operation, {}, body, { kind: "bearer", token: "ck_example" });
  expect(request.url).toBe("/api/v1/events");
  expect(request.init.credentials).toBe("omit");
  expect(new Headers(request.init.headers).get("authorization")).toBe("Bearer ck_example");
  expect(JSON.parse(String(request.init.body))).toEqual({ events: [event] });
});

test("beacon authentication sends the key as a query parameter without adding session authority", () => {
  const request = buildRequest(document, operation, {}, { events: [event] }, { kind: "query", name: "key", token: "ck_beacon" });
  expect(request.url).toBe("/api/v1/events?key=ck_beacon");
  expect(new Headers(request.init.headers).has("authorization")).toBe(false);
  expect(request.init.credentials).toBe("omit");
});

test("the form catches invalid event fields before a write", () => {
  expect(() => buildRequest(document, operation, {}, { events: [{ name: "bad name", visitId: "" }] }, { kind: "bearer", token: "ck_example" }))
    .toThrow("Request body");
});
