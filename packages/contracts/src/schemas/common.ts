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

extendZodWithOpenApi(z);

export { z };

/**
 * The error envelope, once, for every failure.
 *
 * RFC 9457 problem+json. v1 had eight envelope shapes — bare arrays, bare
 * objects, `{data, meta}`, `{insights}`, naked 204s and 202s, `{ok:true}`,
 * `{received:true}`, `{status:"ok"}` — with no code, no request id and no
 * field-level errors anywhere. Validation failures were prose strings.
 */
export const ProblemSchema = z
  .object({
    type: z.string().openapi({ example: "https://counted.dev/problems/quota-exceeded" }),
    title: z.string().openapi({ example: "Quota exceeded" }),
    status: z.number().int().openapi({ example: 429 }),
    detail: z.string().openapi({ example: "This workspace is past its monthly event allowance." }),
    /** Correlates a user's report with a log line. */
    requestId: z.string().openapi({ example: "01JD8Z2K9Q" }),
    /** Present when specific fields were rejected. */
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .openapi({ example: [{ path: "events[0].name", message: "must not be empty" }] }),
  })
  .openapi("Problem");

export type Problem = z.infer<typeof ProblemSchema>;

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
