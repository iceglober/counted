/**
 * The Analysis IR on the wire.
 *
 * One serializable definition of a question — "what to measure, over what
 * window, sliced how" — held by a dashboard tile, by a monitor, and posted
 * directly to the query route. v1 had four vocabularies for this idea and three
 * of them were undiscoverable; there is one here and it is the same shape the
 * domain holds.
 *
 * **Why the closed vocabularies are restated rather than imported.** The
 * contract is a leaf: it may import `@orpc/*`, `zod` and `@counted/kernel`, and
 * `Analysis` lives in `@counted/analytics-domain`. So `grain`, `summary`,
 * `basis` and the sixteen predicate operators appear here as literal enums. The
 * drift that would otherwise threaten is caught where the two meet:
 * `apps/api` converts wire to domain through an exhaustive switch, and a member
 * on one side with no counterpart on the other fails `assertNever` at compile
 * time.
 *
 * **Why dimension and measure names are open strings.** A project's answerable
 * dimensions are a per-project value — `DimensionCatalog.withIndexed` widens them
 * the day litics starts indexing a declared property. A closed enum
 * on the wire would refuse a legitimate custom dimension before the domain
 * could accept it. Unknown names are refused by the domain instead, as
 * `UnknownDimension` / `UnknownMeasure`, which are 422s in this contract.
 */

import * as z from "zod";
import { DurationMsSchema, InstantSchema } from "../primitives";

/** Which namespace a field comes from: a declared dimension, or an event property. */
export const FieldRefSchema = z
  .discriminatedUnion("source", [
    z.object({ source: z.literal("dimension"), key: z.string().min(1) }),
    z.object({ source: z.literal("property"), key: z.string().min(1) }),
  ])
  .meta({
    id: "FieldRef",
    description:
      "A field to filter or slice by. Dimensions are declared and indexed; properties are whatever the event carried.",
  });

export const ScalarValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/** The shape of the wire predicate, needed up front because the type recurses. */
export type WirePredicate =
  | {
      op: "eq" | "neq";
      field: z.infer<typeof FieldRefSchema>;
      value: z.infer<typeof ScalarValueSchema>;
    }
  | {
      op: "in" | "notIn";
      field: z.infer<typeof FieldRefSchema>;
      values: z.infer<typeof ScalarValueSchema>[];
    }
  | {
      op: "contains" | "startsWith" | "endsWith";
      field: z.infer<typeof FieldRefSchema>;
      value: string;
    }
  | {
      op: "gt" | "gte" | "lt" | "lte";
      field: z.infer<typeof FieldRefSchema>;
      value: number;
    }
  | { op: "exists" | "notExists"; field: z.infer<typeof FieldRefSchema> }
  | { op: "and" | "or"; operands: WirePredicate[] }
  | { op: "not"; operand: WirePredicate };

/**
 * Sixteen operators, one filter language.
 *
 * An event-name restriction is `eq(event_type, "purchase")` and not a separate
 * `events: string[]` field — v1 had both spellings with two compilers behind
 * them, and they disagreed about what an empty list meant.
 */
export const PredicateSchema: z.ZodType<WirePredicate> = z
  .lazy(() =>
    z.discriminatedUnion("op", [
      z.object({
        op: z.literal("eq"),
        field: FieldRefSchema,
        value: ScalarValueSchema,
      }),
      z.object({
        op: z.literal("neq"),
        field: FieldRefSchema,
        value: ScalarValueSchema,
      }),
      z.object({
        op: z.literal("in"),
        field: FieldRefSchema,
        values: z.array(ScalarValueSchema),
      }),
      z.object({
        op: z.literal("notIn"),
        field: FieldRefSchema,
        values: z.array(ScalarValueSchema),
      }),
      z.object({
        op: z.literal("contains"),
        field: FieldRefSchema,
        value: z.string(),
      }),
      z.object({
        op: z.literal("startsWith"),
        field: FieldRefSchema,
        value: z.string(),
      }),
      z.object({
        op: z.literal("endsWith"),
        field: FieldRefSchema,
        value: z.string(),
      }),
      z.object({
        op: z.literal("gt"),
        field: FieldRefSchema,
        value: z.number(),
      }),
      z.object({
        op: z.literal("gte"),
        field: FieldRefSchema,
        value: z.number(),
      }),
      z.object({
        op: z.literal("lt"),
        field: FieldRefSchema,
        value: z.number(),
      }),
      z.object({
        op: z.literal("lte"),
        field: FieldRefSchema,
        value: z.number(),
      }),
      z.object({ op: z.literal("exists"), field: FieldRefSchema }),
      z.object({ op: z.literal("notExists"), field: FieldRefSchema }),
      z.object({ op: z.literal("and"), operands: z.array(PredicateSchema) }),
      z.object({ op: z.literal("or"), operands: z.array(PredicateSchema) }),
      z.object({ op: z.literal("not"), operand: PredicateSchema }),
    ]),
  )
  .meta({
    id: "Predicate",
    description: "A filter over dimensions and event properties.",
  });

/** Whether a unique count is per visit or per identified person. */
export const CountingBasisSchema = z.enum(["visit", "person"]);

export const MeasureSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("count") }),
    z.object({ kind: z.literal("unique"), basis: CountingBasisSchema }),
    z.object({ kind: z.literal("sum"), name: z.string().min(1) }),
  ])
  .meta({ id: "Measure", description: "What is being counted." });

export const GrainSchema = z.enum(["hour", "day", "week", "month"]);
export const SummaryStatSchema = z.enum([
  "total",
  "average",
  "peak",
  "low",
  "latest",
]);
export const SortDirectionSchema = z.enum(["asc", "desc"]);

/**
 * The observation interval. Relative windows are stored, not resolved: a tile
 * saying "the last 7 days" must still mean that tomorrow, which is why the
 * absolute bounds are computed at query time and never written down.
 */
export const WindowSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("relative"),
      amount: z.int().positive(),
      unit: z.enum(["hour", "day", "week", "month"]),
    }),
    z.object({
      kind: z.literal("absolute"),
      from: InstantSchema,
      to: InstantSchema,
    }),
  ])
  .meta({ id: "Window", description: "The interval a question observes." });

export const FunnelStepSchema = z.object({
  label: z.string().min(1).optional(),
  events: z.array(z.string().min(1)).min(1),
  where: PredicateSchema.optional(),
});

/**
 * `conversionWindowMs` is a deadline, not an interval and not a bucket width.
 * The domain keeps `Window`, `Grain` and `ConversionWindow` as three mutually
 * unassignable types because v1 let a duration stand in for a window and the
 * substitution was silent.
 */
export const FunnelSchema = z
  .object({
    steps: z.array(FunnelStepSchema).min(2).max(10),
    window: WindowSchema,
    conversionWindowMs: DurationMsSchema.describe(
      "How long a person has to reach the last step after the first.",
    ),
    basis: CountingBasisSchema,
  })
  .meta({
    id: "Funnel",
    description: "An ordered sequence with a conversion deadline.",
  });

/**
 * The shape of the answer is part of the question.
 *
 * A monitor needs "this analysis produces one number" to be a property it can
 * check, not a guess from whether a `groupBy` field happens to be absent.
 */
export const AnalysisSchema = z
  .discriminatedUnion("shape", [
    z.object({
      shape: z.literal("scalar"),
      measure: MeasureSchema,
      where: PredicateSchema.optional(),
      window: WindowSchema,
      summary: SummaryStatSchema,
    }),
    z.object({
      shape: z.literal("series"),
      measure: MeasureSchema,
      where: PredicateSchema.optional(),
      window: WindowSchema,
      grain: GrainSchema,
      by: FieldRefSchema.optional().describe(
        "Split the trend by one property.",
      ),
      limit: z
        .int()
        .min(1)
        .max(3)
        .optional()
        .describe("Top groups over the whole period; defaults to three."),
    }),
    z.object({
      shape: z.literal("breakdown"),
      measure: MeasureSchema,
      where: PredicateSchema.optional(),
      window: WindowSchema,
      by: z
        .union([FieldRefSchema, z.array(FieldRefSchema).min(1).max(3)])
        .describe(
          "One property or an ordered tuple of up to three properties.",
        ),
      order: SortDirectionSchema,
      // A breakdown is one grouped query now, so the cap is a display bound
      // rather than a fan-out bound: it is how many rows come back, not how
      // many round trips they cost. Still capped, because a hundred bars is
      // already a table nobody reads.
      limit: z.int().positive().max(100),
    }),
    z.object({ shape: z.literal("funnel"), funnel: FunnelSchema }),
  ])
  .meta({
    id: "Analysis",
    description: "What to measure, over what window, sliced how.",
  });

/**
 * What a project's events actually offer, so a console can build a question
 * without guessing. `status` distinguishes a dimension that is indexed from one
 * that is declared but this project's index does not carry, so filtering on the
 * second returns a stated refusal rather than an empty chart. `country` used to
 * be the standing example and no longer is: it is derived at ingest from the
 * request address (which is then discarded) and every project's index carries it.
 */
export const ProjectSchemaSchema = z
  .object({
    events: z.array(z.string()),
    dimensions: z.array(
      z.object({
        name: z.string(),
        label: z.string(),
        status: z.enum(["indexed", "planned", "scanned", "unknown"]),
        source: z.enum(["dimension", "property"]).optional(),
      }),
    ),
    measures: z.array(z.string()),
  })
  .meta({
    id: "ProjectSchema",
    description: "The vocabulary a project's events carry.",
  });
