/**
 * Shapes shared by every endpoint.
 *
 * The schemas are the source. OpenAPI is generated from them, and CI fails if
 * the committed document differs from what the code produces — so the spec
 * cannot drift.
 *
 * v1's spec was a hand-written 1020-line literal with no codegen, no
 * validation and no contract test. It had twelve-plus documented-versus-actual
 * mismatches, claimed `POST /dashboards` required three fields when the code
 * required one, described `Project` as four safe fields while the route
 * returned the whole row including `serverKey` and `claimToken`, and omitted
 * `/provision` entirely — the endpoint its own agent cards advertised as the
 * entry point.
 */

import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { ERROR_CODES, type ErrorCode } from "../errors";

extendZodWithOpenApi(z);

export { z };

/**
 * The error envelope, once, for every failure.
 *
 * RFC 9457 problem+json, plus four fields the RFC leaves open and every real
 * client needs: a stable `code` to branch on, a `requestId` to quote, a
 * `retryable` flag so an SDK does not have to guess, and `fields` for
 * validation.
 *
 * v1 had eight envelope shapes — bare arrays, bare objects, `{data, meta}`,
 * `{insights}`, naked 204s and 202s, `{ok:true}`, `{received:true}`,
 * `{status:"ok"}` — with no code, no request id and no field-level errors
 * anywhere. Validation failures were prose strings, so branching on a failure
 * meant matching on English.
 */
export const FieldErrorSchema = z
  .object({
    /** Dotted path with array indices, e.g. `events[1].name`. */
    path: z.string().openapi({ example: "events[1].name" }),
    /** Machine-branchable; Zod's issue code, already a closed set. */
    code: z.string().openapi({ example: "invalid_type" }),
    message: z.string().openapi({ example: "Expected string, received number." }),
    /** Present for enum failures, so a client can render the choices. */
    allowed: z.array(z.string()).optional(),
  })
  .openapi("FieldError");

export const ProblemSchema = z
  .object({
    type: z.string().openapi({ example: "https://counted.dev/errors/request.validation_failed" }),
    title: z.string().openapi({ example: "Validation Failed" }),
    status: z.number().int().openapi({ example: 422 }),
    /** Stable and namespaced. The field a client should actually branch on. */
    code: z.enum(ERROR_CODES as unknown as [ErrorCode, ...ErrorCode[]]).openapi({
      example: "request.validation_failed",
      description: "Stable machine-readable code. Branch on this, not on status or prose.",
    }),
    detail: z.string().openapi({ example: "2 fields are invalid." }),
    /** Correlates a user's report with a log line. Returned on every response. */
    requestId: z.string().openapi({ example: "req_01J8ZQ5S0000000000000000" }),
    /**
     * Whether resending the same request could succeed. Part of the contract
     * rather than a client-side guess — v1's SDKs retried any non-2xx, so a
     * 400 for a malformed batch was resent four times unchanged.
     */
    retryable: z.boolean().openapi({ example: false }),
    docs: z.string().openapi({ example: "https://counted.dev/docs/errors#request-validation_failed" }),
    /** The path that failed, when it helps to repeat it. */
    instance: z.string().optional(),
    /** Present when specific fields were rejected. Every one of them. */
    fields: z.array(FieldErrorSchema).optional(),
    /** Seconds, mirroring the `Retry-After` header where one is sent. */
    retryAfter: z.number().int().nonnegative().optional(),
  })
  .openapi("Problem");



/** Identifiers are opaque strings on the wire; their shape is our business. */
export const ProjectIdSchema = z.string().uuid().openapi({ example: "3f1a2b4c-5d6e-4f70-8a91-2b3c4d5e6f70" });
export const WorkspaceIdSchema = z.string().uuid();
export const DashboardIdSchema = z.string().uuid();

/** ISO-8601 in UTC. The only time format the API speaks. */
export const InstantSchema = z
  .string()
  .datetime()
  .openapi({ example: "2026-03-17T14:37:00.000Z", description: "ISO-8601, UTC" });

export const GrainSchema = z.enum(["hour", "day", "week", "month"]).openapi("Grain");

export const WindowSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("relative"),
      amount: z.number().int().positive(),
      unit: z.enum(["hour", "day", "week", "month"]),
    }),
    z.object({ kind: z.literal("absolute"), from: InstantSchema, to: InstantSchema }),
  ])
  .openapi("Window");

export const MeasureSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("count") }),
    // Named basis, so the API cannot answer a question about people with a
    // number about visits. v1 accepted `unique_users` and compiled it to
    // COUNT(DISTINCT session_id).
    z.object({ kind: z.literal("distinct"), basis: z.enum(["visit", "person"]) }),
    z.object({
      kind: z.literal("aggregate"),
      fn: z.enum(["sum", "avg", "min", "max"]),
      property: z.string().min(1),
    }),
  ])
  .openapi("Measure");

export const FieldRefSchema = z
  .discriminatedUnion("source", [
    z.object({
      source: z.literal("system"),
      key: z.enum([
        "event_name",
        "os_name",
        "os_version",
        "locale",
        "app_version",
        "device_model",
        "country_code",
        "sdk_version",
      ]),
    }),
    // A customer property named `locale` stays a property. v1 checked its
    // system allowlist first and returned our column's numbers for theirs.
    z.object({ source: z.literal("property"), key: z.string().min(1) }),
  ])
  .openapi("FieldRef");

const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * Predicates are recursive, so the type is declared explicitly — Zod cannot
 * infer through `z.lazy`.
 *
 * Ordering comparisons take a number, which is what lets the compiler emit a
 * guarded cast. v1's `gt`/`lt` cast to numeric with no guard, so one
 * non-numeric row raised 22P02 and failed the entire insight.
 */
export type PredicateInput =
  | { op: "eq" | "neq"; field: z.infer<typeof FieldRefSchema>; value: z.infer<typeof ScalarSchema> }
  | { op: "in" | "notIn"; field: z.infer<typeof FieldRefSchema>; values: z.infer<typeof ScalarSchema>[] }
  | { op: "contains" | "startsWith" | "endsWith"; field: z.infer<typeof FieldRefSchema>; value: string }
  | { op: "gt" | "gte" | "lt" | "lte"; field: z.infer<typeof FieldRefSchema>; value: number }
  | { op: "exists" | "notExists"; field: z.infer<typeof FieldRefSchema> }
  | { op: "and" | "or"; operands: PredicateInput[] }
  | { op: "not"; operand: PredicateInput };

/**
 * Registered as a named component with an explicit object type.
 *
 * The predicate grammar is recursive, and the generator cannot walk a
 * `z.lazy` on its own. The runtime schema below still validates the full
 * grammar — this only affects how much structure the document spells out, and
 * the alternative was a generator crash.
 */
export const PredicateSchema: z.ZodType<PredicateInput> = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(["eq", "neq"]), field: FieldRefSchema, value: ScalarSchema }),
    z.object({ op: z.enum(["in", "notIn"]), field: FieldRefSchema, values: z.array(ScalarSchema).min(1) }),
    z.object({ op: z.enum(["contains", "startsWith", "endsWith"]), field: FieldRefSchema, value: z.string() }),
    z.object({ op: z.enum(["gt", "gte", "lt", "lte"]), field: FieldRefSchema, value: z.number() }),
    z.object({ op: z.enum(["exists", "notExists"]), field: FieldRefSchema }),
    z.object({ op: z.enum(["and", "or"]), operands: z.array(PredicateSchema).min(1) }),
    z.object({ op: z.literal("not"), operand: PredicateSchema }),
  ]),
).openapi("Predicate", {
  type: "object",
  description:
    "A filter expression. Leaves compare a field; `and`/`or`/`not` compose them. " +
    "Ordering comparisons (gt/gte/lt/lte) take a number, which is what lets the " +
    "compiler emit a guarded numeric cast.",
});

export const DimensionSchema = z
  .discriminatedUnion("by", [
    z.object({ by: z.literal("field"), field: FieldRefSchema }),
    z.object({ by: z.literal("time"), grain: GrainSchema }),
  ])
  .openapi("Dimension");

/** One question. The same shape a dashboard tile and a monitor both hold. */
export const AnalysisSchema = z
  .object({
    measure: MeasureSchema,
    events: z.array(z.string().min(1)).optional(),
    where: PredicateSchema.optional(),
    groupBy: z.array(DimensionSchema).optional(),
    window: WindowSchema,
    orderBy: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  })
  .openapi("Analysis");
