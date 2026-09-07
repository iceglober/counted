/**
 * An answer, or a stated reason there is none. Never a silent blank.
 *
 * Two shapes on the wire, and the split is deliberate:
 *
 *   - `AnsweredReadoutSchema` is what a single-question route returns. If that
 *     question cannot be answered the route fails with the status V3-SPEC §6
 *     maps — 504 for an engine timeout, 501 for retention — because the caller
 *     asked one thing and there is nothing to render.
 *   - `ReadoutSchema` carries the outcome inside the body, and is what a
 *     whole-dashboard route returns. One tile timing out must not fail the
 *     page; the other eleven tiles have answers and the twelfth says why it
 *     does not.
 *
 * v1 returned an empty series for both cases, so "no events yet" and "the
 * query died" rendered as the same flat line.
 */

import * as z from "zod";
import { DurationMsSchema, InstantSchema, TileIdSchema } from "../primitives";

export const SeriesPointSchema = z.object({
  bucketStart: InstantSchema,
  value: z.number(),
});

export const BreakdownRowSchema = z.object({
  label: z.string(),
  value: z.number(),
  keys: z.array(z.string().nullable()).optional(),
});

/**
 * `percentChange` is null rather than zero or infinity when the previous window
 * had no events. There is no percentage change from nothing, and every number
 * you could put there is a lie a dashboard will render as a badge.
 */
export const TrendSchema = z.object({
  current: z.number(),
  previous: z.number(),
  absoluteChange: z.number(),
  percentChange: z.number().nullable(),
  direction: z.enum(["up", "down", "flat"]),
});

export const FunnelStepResultSchema = z.object({
  label: z.string(),
  reached: z.number(),
  rate: z.number(),
  cumulativeRate: z.number(),
  droppedOff: z.number(),
});

export const FunnelResultSchema = z.object({
  steps: z.array(FunnelStepResultSchema),
  overallRate: z.number(),
});

export const ReadoutValueSchema = z
  .discriminatedUnion("shape", [
    z.object({
      shape: z.literal("scalar"),
      value: z.number(),
      trend: TrendSchema.optional(),
    }),
    z.object({
      shape: z.literal("series"),
      points: z.array(SeriesPointSchema),
      series: z
        .array(
          z.object({
            key: z.string().nullable(),
            label: z.string(),
            points: z.array(SeriesPointSchema),
          }),
        )
        .optional(),
      trend: TrendSchema.optional(),
    }),
    z.object({
      shape: z.literal("breakdown"),
      rows: z.array(BreakdownRowSchema),
      dimensions: z
        .array(z.object({ key: z.string(), label: z.string() }))
        .optional(),
    }),
    z.object({ shape: z.literal("funnel"), result: FunnelResultSchema }),
  ])
  .meta({
    id: "ReadoutValue",
    description: "An answer, shaped like the question.",
  });

/**
 * The same four kinds, with the same payloads, as the engine's own failures.
 * `NotImplemented` names the missing capability rather than saying "error", so
 * a console can render "retention is not available yet" instead of a spinner
 * that never stops.
 */
export const ReadoutFailureSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("Timeout"), budgetMs: DurationMsSchema }),
    z.object({ kind: z.literal("Unavailable"), detail: z.string() }),
    z.object({ kind: z.literal("InvalidQuery"), detail: z.string() }),
    z.object({
      kind: z.literal("NotImplemented"),
      feature: z.enum(["retention", "group_by", "nested_predicates"]),
    }),
  ])
  .meta({ id: "ReadoutFailure", description: "Why there is no answer." });

export const AnsweredReadoutSchema = z
  .object({
    id: z.string(),
    value: ReadoutValueSchema,
    computedAt: InstantSchema,
  })
  .meta({
    id: "AnsweredReadout",
    description: "A question that was answered.",
  });

export const ReadoutSchema = z
  .discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      id: z.string(),
      tile: TileIdSchema.optional(),
      value: ReadoutValueSchema,
      computedAt: InstantSchema,
    }),
    z.object({
      ok: z.literal(false),
      id: z.string(),
      tile: TileIdSchema.optional(),
      failure: ReadoutFailureSchema,
    }),
  ])
  .meta({
    id: "Readout",
    description:
      "One insight's outcome. Carried in the body so one failure cannot fail the page.",
  });
