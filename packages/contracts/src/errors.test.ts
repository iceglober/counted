import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  ERRORS,
  ERROR_CODES,
  ProblemSchema,
  definitionOf,
  docsUriFor,
  fieldsFrom,
  formatPath,
  isErrorCode,
  problemFor,
  typeUriFor,
  validationDetail,
} from "./index";

const REQUEST_ID = "req_01J8ZQ5S0000000000000000AB";

describe("the registry is closed and complete", () => {
  test("every code produces a problem the schema accepts", () => {
    // The constructor and the schema are the same shape by construction —
    // `Problem` is inferred from `ProblemSchema`. This asserts it at runtime
    // too, for every code, so adding one cannot ship a body that fails
    // validation on the way out.
    for (const code of ERROR_CODES) {
      const parsed = ProblemSchema.safeParse(problemFor(code, REQUEST_ID));
      expect({ code, ok: parsed.success }).toEqual({ code, ok: true });
    }
  });

  test("every code has a documented status, title, summary and docs anchor", () => {
    // A code with no documentation is a code a client meets in production and
    // cannot look up.
    for (const code of ERROR_CODES) {
      const definition = definitionOf(code);
      expect(definition.status).toBeGreaterThanOrEqual(400);
      expect(definition.status).toBeLessThan(600);
      expect(definition.title.length).toBeGreaterThan(0);
      expect(definition.summary.length).toBeGreaterThan(20);
      expect(docsUriFor(code)).toContain("/docs/errors#");
    }
  });

  test("every code is namespaced", () => {
    // `auth.*`, `quota.*`, `request.*` and so on. A flat `not_found` would
    // collide the moment two subsystems both wanted it.
    for (const code of ERROR_CODES) expect(code).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  test("the type URI is stable and derived from the code", () => {
    expect(typeUriFor("quota.exceeded")).toBe("https://counted.dev/errors/quota.exceeded");
  });

  test("an unknown string is not a code", () => {
    expect(isErrorCode("quota.exceeded")).toBe(true);
    expect(isErrorCode("quota.made_up")).toBe(false);
  });

  test("retryable is set deliberately, not derived from the status class", () => {
    // Both are 429 and they differ, which is the whole point: a rate limit
    // clears on its own, a monthly quota does not. v1's SDKs retried any
    // non-2xx, so an over-quota batch was resent four times.
    expect(ERRORS["rate.limited"].retryable).toBe(true);
    expect(ERRORS["quota.exceeded"].retryable).toBe(false);
    expect(ERRORS["quota.exceeded"].status).toBe(ERRORS["rate.limited"].status);
  });

  test("no 5xx code claims a client did something wrong, and no 4xx blames us", () => {
    for (const code of ERROR_CODES) {
      const definition = definitionOf(code);
      if (code.startsWith("internal.")) expect(definition.status).toBeGreaterThanOrEqual(500);
      if (code.startsWith("request.")) expect(definition.status).toBeLessThan(500);
    }
  });
});

describe("a problem is complete without anyone remembering to fill it in", () => {
  test("detail falls back to the registry summary", () => {
    const problem = problemFor("query.timeout", REQUEST_ID);
    expect(problem.detail).toBe(ERRORS["query.timeout"].summary);
  });

  test("status, title, type, docs and retryable all come from the code", () => {
    // So a route cannot answer 403 with a body that says 404 — there is no
    // parameter to get wrong.
    const problem = problemFor("auth.forbidden", REQUEST_ID, { detail: "nope" });
    expect(problem).toMatchObject({
      status: 403,
      title: "Forbidden",
      code: "auth.forbidden",
      retryable: false,
      requestId: REQUEST_ID,
      detail: "nope",
    });
  });

  test("empty optionals are omitted rather than sent as null", () => {
    const problem = problemFor("internal.error", REQUEST_ID, { fields: [] });
    expect(problem).not.toHaveProperty("fields");
    expect(problem).not.toHaveProperty("instance");
    expect(problem).not.toHaveProperty("retryAfter");
  });
});

describe("field errors come from the schema, not from prose", () => {
  const schema = z.object({
    name: z.string().min(1),
    threshold: z.number(),
    channels: z.array(z.enum(["email", "slack", "webhook"])),
  });

  const failureOf = (input: unknown) => {
    const parsed = schema.safeParse(input);
    if (parsed.success) throw new Error("expected a failure");
    return fieldsFrom(parsed.error);
  };

  test("every invalid field is reported, not just the first", () => {
    // Reporting one at a time turns fixing a payload into a conversation.
    const fields = failureOf({ name: "", threshold: "12", channels: ["email"] });
    expect(fields.length).toBeGreaterThanOrEqual(2);
    expect(fields.map((f) => f.path).sort()).toEqual(["name", "threshold"]);
  });

  test("array paths are written the way a developer would index them", () => {
    const fields = failureOf({ name: "a", threshold: 1, channels: ["email", "carrier-pigeon"] });
    expect(fields[0]!.path).toBe("channels[1]");
  });

  test("an enum failure carries the allowed values", () => {
    // So a client can render the choices instead of linking to documentation.
    const fields = failureOf({ name: "a", threshold: 1, channels: ["carrier-pigeon"] });
    expect(fields[0]!.allowed).toEqual(["email", "slack", "webhook"]);
  });

  test("every field error carries a machine-readable code", () => {
    for (const field of failureOf({ name: "", threshold: "x", channels: [] })) {
      expect(field.code.length).toBeGreaterThan(0);
      expect(field.message.length).toBeGreaterThan(0);
    }
  });

  test("paths format the way the examples claim", () => {
    expect(formatPath(["events", 1, "name"])).toBe("events[1].name");
    expect(formatPath([0, "id"])).toBe("[0].id");
    // An empty path means the failure is about the body as a whole.
    expect(formatPath([])).toBe("");
  });

  test("the detail line counts, and the list does the work", () => {
    expect(validationDetail([{ path: "a", code: "x", message: "y" }])).toBe("1 field is invalid.");
    expect(validationDetail([
      { path: "a", code: "x", message: "y" },
      { path: "b", code: "x", message: "y" },
    ])).toBe("2 fields are invalid.");
  });

  test("a validation problem validates against the schema, fields and all", () => {
    const fields = failureOf({ name: "", threshold: "x", channels: ["nope"] });
    const problem = problemFor("request.validation_failed", REQUEST_ID, {
      detail: validationDetail(fields),
      fields,
      instance: "/v1/monitors",
    });
    expect(ProblemSchema.safeParse(problem).success).toBe(true);
    expect(problem.status).toBe(422);
  });
});
