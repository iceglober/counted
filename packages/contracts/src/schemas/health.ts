import { z } from "./common";

export const LivenessSchema = z
  .object({ status: z.literal("ok"), release: z.string(), uptimeSeconds: z.number().int() })
  .openapi("Liveness");

export const ReadinessSchema = z
  .object({
    status: z.enum(["ready", "unavailable"]),
    release: z.string(),
    checkMs: z.number().int(),
    store: z
      .object({
        engine: z.string(),
        partitioning: z.enum(["declarative", "hypertable", "none"]),
        timescale: z.boolean(),
        approximateDistinct: z.boolean(),
        timeZone: z.string(),
      })
      .optional(),
    bucketContract: z.object({ verified: z.boolean(), samples: z.number().int().optional() }).optional(),
  })
  .openapi("Readiness");
