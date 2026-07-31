/**
 * Reading.
 *
 * Every response is self-describing. v1's `/query` multiplexed three different
 * shapes onto one endpoint with no discriminator, so the client had to
 * reconstruct the branch condition itself — and `meta.totalEvents` meant three
 * different things depending which branch had fired.
 */

import { AnalysisSchema, GrainSchema, InstantSchema, PredicateSchema, WindowSchema, z } from "./common";

/**
 * A funnel is ordered, and says so.
 *
 * `conversionWindow` is required rather than optional. v1's funnel was an
 * unordered set intersection whose own doc-comment claimed "in sequence", and
 * it silently dropped each step's property filters. Both are expressible here
 * and neither is optional.
 */
export const FunnelStepSchema = z
  .object({
    events: z.array(z.string().min(1)).min(1),
    where: PredicateSchema.optional(),
    label: z.string().min(1).optional(),
  })
  .openapi("FunnelStep");

export const FunnelSchema = z
  .object({
    steps: z.array(FunnelStepSchema).min(2).max(10),
    window: WindowSchema,
    /** Milliseconds. How long a visitor has to complete the whole sequence. */
    conversionWindowMs: z.number().int().positive(),
    /** Visit-scoped by default; person-scoped needs identify(). */
    basis: z.enum(["visit", "person"]).optional(),
    where: PredicateSchema.optional(),
  })
  .openapi("Funnel");

/**
 * Retention is person-scoped, and the schema will not express anything else.
 *
 * v1 offered it on visits. A visit expires after thirty minutes idle, so every
 * cohort past period 0 was ~0 by construction — and the column was labelled
 * "Users". Here the literal `"person"` is the only accepted value, so the
 * broken question cannot be asked.
 */
export const RetentionSchema = z
  .object({
    window: WindowSchema,
    grain: GrainSchema,
    periods: z.number().int().positive().max(60),
    basis: z.literal("person"),
    startEvents: z.array(z.string().min(1)).optional(),
    returnEvents: z.array(z.string().min(1)).optional(),
    where: PredicateSchema.optional(),
  })
  .openapi("Retention");

/** The three shapes a question comes in, tagged. */
export const QuestionSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("analysis"), analysis: AnalysisSchema }),
    z.object({ kind: z.literal("funnel"), funnel: FunnelSchema }),
    z.object({ kind: z.literal("retention"), retention: RetentionSchema }),
  ])
  .openapi("Question");

/**
 * The body of a query. The project is named in the path, not repeated here.
 *
 * Carrying it in both places would let them disagree, and the guard has
 * already resolved and authorized the path one — so a body `projectId` would
 * either be ignored or become a second, unauthorized way to name a project.
 */
export const QueryRequestSchema = z.object({ question: QuestionSchema }).openapi("QueryRequest");

const SeriesPointSchema = z.object({ bucketStart: InstantSchema, value: z.number() });

/** Tagged, always. The client never has to infer which shape it received. */
export const ReadoutValueSchema = z
  .discriminatedUnion("shape", [
    z.object({ shape: z.literal("scalar"), value: z.number() }),
    z.object({ shape: z.literal("series"), points: z.array(SeriesPointSchema) }),
    z.object({
      shape: z.literal("breakdown"),
      rows: z.array(z.object({ label: z.string(), value: z.number() })),
    }),
    z.object({
      shape: z.literal("funnel"),
      steps: z.array(
        z.object({
          label: z.string(),
          reached: z.number().int(),
          rate: z.number(),
          cumulativeRate: z.number(),
          droppedOff: z.number().int(),
        }),
      ),
      overallRate: z.number(),
    }),
    z.object({
      shape: z.literal("retention"),
      offsets: z.array(z.number().int()),
      cohorts: z.array(
        z.object({
          start: InstantSchema,
          size: z.number().int(),
          // null means the period has not begun — distinct from zero, which
          // means nobody came back. v1 conflated them.
          cells: z.array(
            z.object({ offset: z.number().int(), returned: z.number().int(), rate: z.number() }).nullable(),
          ),
        }),
      ),
    }),
  ])
  .openapi("ReadoutValue");

/**
 * A failure is a value, not an absence.
 *
 * v1's dashboard loader wrapped every query in `Promise.allSettled` and turned
 * any rejection into `emptyData()`, so a broken query and a genuinely empty
 * project rendered identically. A readout is either an answer or a stated
 * reason there is none.
 */
export const ReadoutFailureSchema = z
  .object({
    code: z.enum(["timeout", "unsupported", "store_unavailable", "invalid_request"]),
    detail: z.string(),
    retriable: z.boolean(),
  })
  .openapi("ReadoutFailure");

export const ReadoutSchema = z
  .discriminatedUnion("ok", [
    z.object({ id: z.string(), ok: z.literal(true), value: ReadoutValueSchema, computedAt: InstantSchema }),
    z.object({ id: z.string(), ok: z.literal(false), failure: ReadoutFailureSchema }),
  ])
  .openapi("Readout");

export const QueryResponseSchema = z
  .object({ value: ReadoutValueSchema, computedAt: InstantSchema })
  .openapi("QueryResponse");

/**
 * Every tile answered in one response.
 *
 * `statements` is reported because the number of round trips a dashboard costs
 * is the thing that went wrong in v1 — 24 tiles meant 24 serialised queries —
 * and a number nobody can see is a number nobody notices growing.
 */
export const DashboardDataResponseSchema = z
  .object({
    readouts: z.array(ReadoutSchema),
    statements: z.number().int(),
    computedAt: InstantSchema,
  })
  .openapi("DashboardDataResponse");
