import { describe, expect, test } from "bun:test";
import {
  AnalysisSchema,
  IngestReceiptSchema,
  IngestRequestSchema,
  PredicateSchema,
  ProblemSchema,
  QueryResponseSchema,
  buildOpenApiDocument,
} from "./index";

describe("the schemas validate, not just describe", () => {
  test("a well-formed ingest batch is accepted", () => {
    const parsed = IngestRequestSchema.safeParse({
      events: [
        {
          name: "page_view",
          visitId: "1720656000.k3j9x2mp",
          occurredAt: "2026-03-17T14:37:00.000Z",
          idempotencyKey: "abc",
          properties: { path: "/pricing", amount: 12.5, trial: false, coupon: null },
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  test("an empty batch and an oversized one are both rejected", () => {
    expect(IngestRequestSchema.safeParse({ events: [] }).success).toBe(false);
    const many = Array.from({ length: 51 }, () => ({ name: "e", visitId: "v" }));
    expect(IngestRequestSchema.safeParse({ events: many }).success).toBe(false);
  });

  test("more than fifty properties is rejected", () => {
    const properties = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i]));
    expect(
      IngestRequestSchema.safeParse({ events: [{ name: "e", visitId: "v", properties }] }).success,
    ).toBe(false);
  });

  test("userId is optional and never required", () => {
    // Counted never derives identity; it arrives only if the customer calls
    // identify(). The contract has to make that shape possible and never
    // mandatory.
    expect(IngestRequestSchema.safeParse({ events: [{ name: "e", visitId: "v" }] }).success).toBe(true);
    expect(
      IngestRequestSchema.safeParse({ events: [{ name: "e", visitId: "v", userId: "usr_1" }] }).success,
    ).toBe(true);
  });
});

describe("ordering comparisons are numeric in the contract too", () => {
  test("gt takes a number", () => {
    expect(
      PredicateSchema.safeParse({ op: "gt", field: { source: "property", key: "amount" }, value: 100 }).success,
    ).toBe(true);
  });

  test("gt against a string is refused at the edge, before it reaches the compiler", () => {
    // v1 emitted an unguarded ::numeric cast and one bad row failed the whole
    // insight. Rejecting the shape here means the compiler never sees it.
    expect(
      PredicateSchema.safeParse({ op: "gt", field: { source: "property", key: "amount" }, value: "100" }).success,
    ).toBe(false);
  });

  test("equality still accepts any scalar", () => {
    for (const value of ["pro", 1, true, null]) {
      expect(
        PredicateSchema.safeParse({ op: "eq", field: { source: "property", key: "x" }, value }).success,
      ).toBe(true);
    }
  });

  test("nested composition parses", () => {
    const nested = {
      op: "and",
      operands: [
        { op: "eq", field: { source: "system", key: "os_name" }, value: "macOS" },
        { op: "not", operand: { op: "exists", field: { source: "property", key: "coupon" } } },
      ],
    };
    expect(PredicateSchema.safeParse(nested).success).toBe(true);
  });

  test("an empty and/or group is refused", () => {
    expect(PredicateSchema.safeParse({ op: "and", operands: [] }).success).toBe(false);
  });

  test("a system field must be one of ours; anything else must be a property", () => {
    expect(PredicateSchema.safeParse({ op: "exists", field: { source: "system", key: "amount" } }).success).toBe(false);
    expect(PredicateSchema.safeParse({ op: "exists", field: { source: "property", key: "amount" } }).success).toBe(true);
  });
});

describe("responses are self-describing", () => {
  test("every readout carries its shape", () => {
    // v1's /query multiplexed three shapes onto one endpoint with no
    // discriminator, so the client reconstructed the branch condition itself.
    const shapes = [
      { shape: "scalar", value: 42 },
      { shape: "series", points: [{ bucketStart: "2026-03-17T00:00:00.000Z", value: 1 }] },
      { shape: "breakdown", rows: [{ label: "macOS", value: 3 }] },
    ];
    for (const value of shapes) {
      expect(QueryResponseSchema.safeParse({ value, computedAt: "2026-03-17T14:37:00.000Z" }).success).toBe(true);
    }
  });

  test("an untagged readout is refused", () => {
    expect(
      QueryResponseSchema.safeParse({ value: { value: 42 }, computedAt: "2026-03-17T14:37:00.000Z" }).success,
    ).toBe(false);
  });

  test("a retention cell may be null, meaning the period has not begun", () => {
    const value = {
      shape: "retention",
      offsets: [0, 1, 2],
      cohorts: [
        {
          start: "2026-03-01T00:00:00.000Z",
          size: 10,
          cells: [{ offset: 0, returned: 10, rate: 100 }, { offset: 1, returned: 0, rate: 0 }, null],
        },
      ],
    };
    expect(QueryResponseSchema.safeParse({ value, computedAt: "2026-03-17T14:37:00.000Z" }).success).toBe(true);
  });
});

describe("the ingest receipt says what happened", () => {
  test("per-event outcomes and a named quota state", () => {
    // v1 returned 202 with an empty body, and an over-quota drop was
    // byte-identical to success.
    const receipt = {
      accepted: 1,
      deduplicated: 1,
      rejected: 1,
      outcomes: [
        { index: 0, accepted: true, deduplicated: false },
        { index: 1, accepted: true, deduplicated: true },
        { index: 2, accepted: false, reason: "name must not be empty" },
      ],
      quota: { state: "overage", used: 120_000, limit: 100_000 },
      committedAt: "2026-03-17T14:37:00.000Z",
    };
    expect(IngestReceiptSchema.safeParse(receipt).success).toBe(true);
  });

  test("an accepted outcome cannot carry a rejection reason", () => {
    expect(
      IngestReceiptSchema.safeParse({
        accepted: 1,
        deduplicated: 0,
        rejected: 0,
        outcomes: [{ index: 0, accepted: true, reason: "why" }],
        quota: { state: "ok", used: 1, limit: null },
        committedAt: "2026-03-17T14:37:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("one error envelope", () => {
  test("problem+json with a request id", () => {
    const problem = {
      type: "https://counted.dev/problems/quota-exceeded",
      title: "Quota exceeded",
      status: 429,
      detail: "past the monthly allowance",
      requestId: "01JD8Z2K9Q",
    };
    expect(ProblemSchema.safeParse(problem).success).toBe(true);
  });

  test("a request id is required, so every failure is traceable", () => {
    expect(
      ProblemSchema.safeParse({ type: "x", title: "y", status: 500, detail: "z" }).success,
    ).toBe(false);
  });
});

describe("the generated document", () => {
  const doc = buildOpenApiDocument() as {
    openapi: string;
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
  };

  test("it describes every endpoint the code implements", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths).sort()).toEqual(["/health", "/health/ready", "/v1/events", "/v1/query"]);
  });

  test("schemas come from the same definitions the server validates with", () => {
    // Not a second, hand-written description that can disagree.
    for (const name of ["Problem", "Analysis", "IngestReceipt", "ReadoutValue", "Predicate"]) {
      expect(doc.components.schemas[name]).toBeDefined();
    }
  });

  test("errors are documented as problem+json, not as prose", () => {
    const ingest = doc.paths["/v1/events"]!.post as {
      responses: Record<string, { content?: Record<string, unknown> }>;
    };
    expect(ingest.responses["400"]!.content).toHaveProperty("application/problem+json");
    expect(ingest.responses["429"]!.content).toHaveProperty("application/problem+json");
  });

  test("both credential kinds are declared", () => {
    expect(doc.components.securitySchemes["ingestKey"]).toBeDefined();
    expect(doc.components.securitySchemes["serviceKey"]).toBeDefined();
  });

  test("generation is deterministic, or the drift gate would be noise", () => {
    expect(JSON.stringify(buildOpenApiDocument())).toBe(JSON.stringify(buildOpenApiDocument()));
  });
});
