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

/**
 * Who the caller is, and what it may do.
 *
 * Exists so an integrator debugging a 403 can ask the API rather than guess.
 * v1 had no way to ask this at all.
 */
export const PrincipalSchema = z
  .object({
    principal: z.string().openapi({ example: "service:cred_01J8ZQ" }),
    kind: z.enum(["anonymous", "account", "ingest", "service", "share", "worker"]),
    /** Where the scopes come from: a credential, a membership, or nowhere. */
    scopeSource: z.enum(["none", "credential", "membership"]),
    scopes: z.array(z.string()),
  })
  .openapi("PrincipalDescription");
