import { describe, expect, test } from "bun:test";
import { apiDocument } from "./index";
import {
  buildRequest,
  buildCustomRequest,
  initialValue,
  operationsOf,
  operationGroupsOf,
  parameterSchema,
  requestSchema,
  resolveSchema,
  validateValue,
  variantIndex,
  type ApiDocument,
  type Operation,
  type Schema,
} from "./model";

const operations = operationsOf(apiDocument);
const operation = (id: string) =>
  operations.find((item) => item.operationId === id)!;
const session = { kind: "session" } as const;
const document: ApiDocument = {
  openapi: "3.1.2",
  info: { title: "Fixture", version: "1" },
  paths: {},
  components: {
    schemas: {
      Name: { type: "string", minLength: 2 },
      Amount: { type: "integer", minimum: 1 },
    },
  },
};

describe("the generated API document", () => {
  test("resource navigation includes every operation exactly once", () => {
    const groups = operationGroupsOf(apiDocument);
    const ids = groups.flatMap((group) =>
      group.operations.map((operation) => operation.operationId),
    );
    expect(ids.sort()).toEqual(
      operations.map((operation) => operation.operationId).sort(),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      groups
        .find((group) => group.name === "insights")
        ?.operations.map((operation) => operation.operationId),
    ).toEqual(
      operations
        .filter((operation) => operation.operationId.startsWith("tiles."))
        .map((operation) => operation.operationId),
    );
    expect(
      groups
        .find((group) => group.name === "members")
        ?.operations.map((operation) => operation.operationId),
    ).toEqual([
      "workspaces.members",
      "workspaces.changeRole",
      "workspaces.removeMember",
      "workspaces.leave",
    ]);
  });
  test("resource navigation follows tag order, omits empty groups, and retains undeclared or untagged operations", () => {
    const groups = operationGroupsOf({
      ...document,
      tags: [{ name: "second" }, { name: "first" }, { name: "unused" }],
      paths: {
        "/first": { get: { operationId: "first", tags: ["first", "second"] } },
        "/second": { get: { operationId: "second", tags: ["second"] } },
        "/new": { get: { operationId: "new", tags: ["new"] } },
        "/untagged": { get: { operationId: "untagged" } },
      },
    });
    expect(groups.map((group) => group.name)).toEqual([
      "second",
      "first",
      "new",
      "other",
    ]);
    expect(
      groups.flatMap((group) =>
        group.operations.map((operation) => operation.operationId),
      ),
    ).toEqual(["second", "first", "new", "untagged"]);
  });
  test("discovers every documented operation without an endpoint allowlist", () => {
    const count = Object.values(apiDocument.paths).flatMap((item) =>
      Object.keys(item).filter((key) =>
        /^(get|post|put|patch|delete|head|options|trace)$/.test(key),
      ),
    ).length;
    expect(operations.length).toBe(count);
    expect(new Set(operations.map((item) => item.operationId)).size).toBe(
      count,
    );
    expect(count).toBeGreaterThan(50);
    expect(operations.map((item) => item.operationId)).toContain("queries.run");
  });
  test("every parameter and request schema compiles, including references and analysis unions", () => {
    for (const operation of operations) {
      const schemas = operation.parameters
        .map(parameterSchema)
        .concat(requestSchema(operation) ? [requestSchema(operation)!] : []);
      for (const schema of schemas)
        expect(() =>
          validateValue(apiDocument, schema, initialValue(apiDocument, schema)),
        ).not.toThrow();
    }
  }, 30_000);
});

describe("schema controls and validation", () => {
  test("follows local references and validates referenced constraints", () => {
    expect(
      resolveSchema(document, {
        $ref: "#/components/schemas/Name",
        description: "Name",
      }),
    ).toEqual({ type: "string", minLength: 2, description: "Name" });
    expect(
      validateValue(document, { $ref: "#/components/schemas/Amount" }, 0)
        .length,
    ).toBeGreaterThan(0);
    expect(
      validateValue(document, { $ref: "#/components/schemas/Amount" }, 2),
    ).toEqual([]);
  });
  test("rejects mismatched constants and disjoint unions", () => {
    expect(
      validateValue(document, { const: "count" }, "sum").length,
    ).toBeGreaterThan(0);
    expect(
      validateValue(document, { oneOf: [{ const: "a" }, { const: "b" }] }, "c")
        .length,
    ).toBeGreaterThan(0);
  });
  test("validates numeric bounds, formats, and additional properties", () => {
    expect(
      validateValue(document, { type: "number", exclusiveMinimum: 0 }, 0)
        .length,
    ).toBeGreaterThan(0);
    expect(
      validateValue(document, { type: "string", format: "email" }, "invalid")
        .length,
    ).toBeGreaterThan(0);
    expect(
      validateValue(
        document,
        { type: "object", additionalProperties: false },
        { extra: true },
      ).length,
    ).toBeGreaterThan(0);
  });
  test("seeds required fields without adding every optional field", () => {
    expect(
      initialValue(
        document,
        {
          type: "object",
          properties: {
            workspaceId: { type: "string" },
            limit: { type: "integer", minimum: 1 },
            optional: { type: "boolean" },
          },
          required: ["workspaceId", "limit"],
        },
        { workspaceId: "workspace" },
      ),
    ).toEqual({ workspaceId: "workspace", limit: 1 });
  });
  test("selects a tagged variant and retains null as a separate value", () => {
    const variants: Schema[] = [
      { type: "object", properties: { kind: { const: "relative" } } },
      { type: "object", properties: { kind: { const: "absolute" } } },
      { type: "null" },
    ];
    expect(variantIndex(document, variants, { kind: "absolute" })).toBe(1);
    expect(variantIndex(document, variants, null)).toBe(2);
  });
});

describe("request construction", () => {
  test("GET uses the same-origin forwarder with only the user's session", () => {
    const request = buildRequest(
      apiDocument,
      operation("workspaces.get"),
      { "path:workspaceId": "ws_example" },
      undefined,
      session,
    );
    expect(request.url).toBe("/api/v1/workspaces/ws_example");
    expect(request.init.credentials).toBe("same-origin");
    expect(request.init.redirect).toBe("error");
    expect(new Headers(request.init.headers).has("authorization")).toBe(false);
    expect(request.init.body).toBeUndefined();
  });
  test("API key testing omits the session so it cannot mask a key's permissions", () => {
    const request = buildRequest(
      apiDocument,
      operation("credentials.self"),
      {},
      undefined,
      { kind: "bearer", token: " ck_test " },
    );
    expect(new Headers(request.init.headers).get("authorization")).toBe(
      "Bearer ck_test",
    );
    expect(request.init.credentials).toBe("omit");
    expect(() =>
      buildRequest(apiDocument, operation("credentials.self"), {}, undefined, {
        kind: "bearer",
        token: " ",
      }),
    ).toThrow("Enter an API key");
  });
  test("POST, PATCH, and DELETE retain their actual method and JSON body", () => {
    const create = buildRequest(
      apiDocument,
      operation("dashboards.create"),
      { "path:workspaceId": "ws" },
      { name: "Example" },
      session,
    );
    expect(create.init.method).toBe("POST");
    expect(create.init.body).toBe('{"name":"Example"}');
    expect(new Headers(create.init.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(
      buildRequest(
        apiDocument,
        operation("dashboards.rename"),
        { "path:dashboardId": "dash" },
        { name: "Updated" },
        session,
      ).init.method,
    ).toBe("PATCH");
    expect(
      buildRequest(
        apiDocument,
        operation("dashboards.delete"),
        { "path:dashboardId": "dash" },
        undefined,
        session,
      ).init.method,
    ).toBe("DELETE");
  });
  test("serializes content-based JSON query parameters without losing the object", () => {
    const window = { kind: "relative", amount: 7, unit: "day" };
    const request = buildRequest(
      apiDocument,
      operation("share.readouts"),
      {
        "query:shareToken": "token",
        "query:window": window,
        "query:deadlineMs": 1000,
      },
      undefined,
      { kind: "none" },
    );
    const url = new URL(request.url, "https://app.counted.dev");
    expect(JSON.parse(url.searchParams.get("window")!)).toEqual(window);
    expect(url.searchParams.get("shareToken")).toBe("token");
    expect(request.init.credentials).toBe("omit");
  });
  test("retains false, zero, empty string, and null; omits only undefined", () => {
    const operation: Operation = {
      operationId: "fixture",
      method: "GET",
      path: "/v1/example",
      summary: "Example",
      parameters: ["false", "zero", "empty", "null", "omit"].map((name) => ({
        name,
        in: "query",
        schema: {},
      })),
    };
    const request = buildRequest(
      document,
      operation,
      {
        "query:false": false,
        "query:zero": 0,
        "query:empty": "",
        "query:null": null,
      },
      undefined,
      session,
    );
    expect(request.url).toBe(
      "/api/v1/example?false=false&zero=0&empty=&null=null",
    );
  });
  test("rejects missing parameters and malformed JSON bodies before sending", () => {
    expect(() =>
      buildRequest(
        apiDocument,
        operation("dashboards.create"),
        {},
        { name: "Example" },
        session,
      ),
    ).toThrow("workspaceId is required");
    expect(() =>
      buildRequest(
        apiDocument,
        operation("dashboards.create"),
        { "path:workspaceId": "ws" },
        { name: "" },
        session,
      ),
    ).toThrow("Request body");
  });
  test("encodes path/query inputs and rejects traversal or arbitrary API targets", () => {
    const request = buildRequest(
      apiDocument,
      operation("workspaces.get"),
      { "path:workspaceId": "a/b?c#d" },
      undefined,
      session,
    );
    expect(request.url).toBe("/api/v1/workspaces/a%2Fb%3Fc%23d");
    expect(() =>
      buildRequest(
        apiDocument,
        operation("workspaces.get"),
        { "path:workspaceId": ".." },
        undefined,
        session,
      ),
    ).toThrow("path segment");
    expect(() =>
      buildRequest(
        document,
        { ...operation("workspaces.get"), path: "https://example.com/v1" },
        {},
        undefined,
        session,
      ),
    ).toThrow("Counted API");
  });
});

describe("custom requests", () => {
  test("supports ingestion and auth through the existing proxy", () => {
    const ingest = buildCustomRequest(
      "/v1/events",
      "POST",
      { events: [] },
      { kind: "bearer", token: "ck_example" },
    );
    expect(ingest.url).toBe("/api/v1/events");
    expect(ingest.init.credentials).toBe("omit");
    expect(
      buildCustomRequest("/api/auth/get-session", "GET", undefined, session)
        .url,
    ).toBe("/api/auth/get-session");
    expect(
      buildCustomRequest(
        "/v1/shared/dashboard?shareToken=token",
        "GET",
        undefined,
        { kind: "none" },
      ).url,
    ).toBe("/api/v1/shared/dashboard?shareToken=token");
  });
  test("rejects off-origin targets, traversal, webhook routes, and GET bodies", () => {
    for (const path of [
      "https://example.com",
      "//example.com/v1",
      "/v1/../api/auth",
      "/v1/%2e%2e/other",
      "/v1/example#fragment",
      "/v1/webhooks/stripe",
    ]) {
      expect(() => buildCustomRequest(path, "POST", {}, session)).toThrow();
    }
    expect(() => buildCustomRequest("/v1/events", "GET", {}, session)).toThrow(
      "cannot have a body",
    );
  });
});
