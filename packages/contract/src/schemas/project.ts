/**
 * Project shapes, including the two that make the no-signup path work.
 *
 * A project can exist without a workspace. That is not an edge case to be
 * tidied away: it is the entire "run one command, send an event, sign up
 * later" path, and v1 broke it by requiring a workspace before a provisioning
 * key could send anything. `workspace` is nullable here for that reason, and a
 * `ClaimGrant` is what turns an unclaimed project into an owned one.
 */

import * as z from "zod";
import { InstantSchema, ProjectIdSchema, WorkspaceIdSchema } from "../primitives";

/**
 * `inherit` and an explicit day count are different statements: the first
 * follows the plan when the plan changes, the second is a ceiling the customer
 * chose and is still clamped by the plan.
 */
export const RetentionPolicySchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("inherit") }),
    z.object({ kind: z.literal("days"), days: z.int().positive().max(3650) }),
  ])
  .meta({ id: "RetentionPolicy", description: "How long this project's events are kept." });

export const ProjectSchema = z
  .object({
    id: ProjectIdSchema,
    name: z.string(),
    workspace: WorkspaceIdSchema.nullable().describe("Null until the project is claimed."),
    archived: z.boolean(),
    retention: RetentionPolicySchema,
    effectiveRetentionDays: z
      .int()
      .nullable()
      .describe("The policy after the plan's ceiling is applied. Null means unlimited."),
    claimedAt: InstantSchema.nullable(),
  })
  .meta({ id: "Project", description: "A project, claimed or not." });

export const ProjectSummarySchema = z
  .object({
    id: ProjectIdSchema,
    workspace: WorkspaceIdSchema.nullable(),
    name: z.string(),
    archived: z.boolean(),
  })
  .meta({ id: "ProjectSummary", description: "A project in a list." });

/**
 * The token that claims a provisioned project, returned once at provisioning.
 *
 * Counted stores only its digest, which is why this is the sole moment it
 * exists — and why claiming is a route an API key can call. In v2 claiming
 * required a browser session, so an agent could create a project and then had
 * no way to keep it.
 */
export const ClaimGrantSchema = z
  .object({
    token: z.string().describe("Shown once. Present it to the claim route to take ownership."),
    expiresAt: InstantSchema,
  })
  .meta({ id: "ClaimGrant", description: "Permission to claim a provisioned project." });
