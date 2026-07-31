/**
 * Reading.
 *
 * Every response is self-describing. v1's `/query` multiplexed three different
 * shapes onto one endpoint with no discriminator, so the client had to
 * reconstruct the branch condition itself — and `meta.totalEvents` meant three
 * different things depending which branch had fired.
 */

import { AnalysisSchema, InstantSchema, ProjectIdSchema, z } from "./common";

export const QueryRequestSchema = z
  .object({ projectId: ProjectIdSchema, analysis: AnalysisSchema })
  .openapi("QueryRequest");

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

export const QueryResponseSchema = z
  .object({ value: ReadoutValueSchema, computedAt: InstantSchema })
  .openapi("QueryResponse");
