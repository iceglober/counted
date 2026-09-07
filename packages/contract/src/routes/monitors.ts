/**
 * Monitors — a scalar question watched against a threshold.
 *
 * v2 had enable and disable and nothing else: a monitor could only come into
 * existence through a database write, and changing its threshold meant deleting
 * and recreating it, which reset the breach state and re-announced a breach
 * that had already been reported. Create, update and delete are here, and the
 * update route keeps the two apart deliberately — retargeting the question
 * resets breach state, while changing the cooldown or the channels does not.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";
import { route } from "../route";
import { MONITOR_ERRORS } from "../errors";
import {
  DurationMsSchema,
  MonitorIdSchema,
  ProjectIdSchema,
  WorkspaceIdSchema,
} from "../primitives";
import { AnalysisSchema } from "../schemas/analysis";
import { ChannelSchema, MonitorSchema, ThresholdSchema } from "../schemas/dashboarding";

const TAGS = ["monitors"] as const;

export const list = oc
  .meta(
    route({
      id: "monitors.list",
      method: "GET",
      path: "/v1/workspaces/{workspaceId}/monitors",
      summary: "List a workspace's monitors",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "monitors:read",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(MONITOR_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema }))
  .output(z.object({ items: z.array(MonitorSchema) }));

export const listForProject = oc
  .meta(
    route({
      id: "monitors.listForProject",
      method: "GET",
      path: "/v1/projects/{projectId}/monitors",
      summary: "List a project's monitors",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "monitors:read",
        resource: "project",
        param: "projectId",
      },
    }),
  )
  .errors(MONITOR_ERRORS)
  .input(z.object({ projectId: ProjectIdSchema }))
  .output(z.object({ items: z.array(MonitorSchema) }));

export const create = oc
  .meta(
    route({
      id: "monitors.create",
      method: "POST",
      path: "/v1/projects/{projectId}/monitors",
      summary: "Create a monitor",
      description:
        "The analysis must produce one number. A series or a breakdown is refused with `AnalysisMustBeScalar` rather than being silently reduced to its first bucket.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "monitors:write",
        resource: "project",
        param: "projectId",
      },
      successStatus: 201,
    }),
  )
  .errors(MONITOR_ERRORS)
  .input(
    z.object({
      projectId: ProjectIdSchema,
      name: z.string().min(1).max(200),
      analysis: AnalysisSchema,
      threshold: ThresholdSchema,
      cooldownMs: DurationMsSchema.optional(),
      channels: z.array(ChannelSchema).default([]),
    }),
  )
  .output(z.object({ monitor: MonitorSchema }));

export const get = oc
  .meta(
    route({
      id: "monitors.get",
      method: "GET",
      path: "/v1/monitors/{monitorId}",
      summary: "Read a monitor",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "monitors:read",
        resource: "monitor",
        param: "monitorId",
      },
    }),
  )
  .errors(MONITOR_ERRORS)
  .input(z.object({ monitorId: MonitorIdSchema }))
  .output(z.object({ monitor: MonitorSchema }));

export const update = oc
  .meta(
    route({
      id: "monitors.update",
      method: "PATCH",
      path: "/v1/monitors/{monitorId}",
      summary: "Change a monitor",
      description:
        "Changing `analysis` or `threshold` retargets the monitor and clears its breach state. Changing `cooldownMs` or `channels` does not — muting a channel must not re-announce a breach that was already reported.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "monitors:write",
        resource: "monitor",
        param: "monitorId",
      },
    }),
  )
  .errors(MONITOR_ERRORS)
  .input(
    z.object({
      monitorId: MonitorIdSchema,
      name: z.string().min(1).max(200).optional(),
      analysis: AnalysisSchema.optional(),
      threshold: ThresholdSchema.optional(),
      cooldownMs: DurationMsSchema.optional(),
      channels: z.array(ChannelSchema).optional(),
    }),
  )
  .output(z.object({ monitor: MonitorSchema }));

export const enable = oc
  .meta(
    route({
      id: "monitors.enable",
      method: "POST",
      path: "/v1/monitors/{monitorId}/enable",
      summary: "Enable a monitor",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "monitors:write",
        resource: "monitor",
        param: "monitorId",
      },
    }),
  )
  .errors(MONITOR_ERRORS)
  .input(z.object({ monitorId: MonitorIdSchema }))
  .output(z.object({ monitor: MonitorSchema }));

export const disable = oc
  .meta(
    route({
      id: "monitors.disable",
      method: "POST",
      path: "/v1/monitors/{monitorId}/disable",
      summary: "Disable a monitor",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "monitors:write",
        resource: "monitor",
        param: "monitorId",
      },
    }),
  )
  .errors(MONITOR_ERRORS)
  .input(z.object({ monitorId: MonitorIdSchema }))
  .output(z.object({ monitor: MonitorSchema }));

export const remove = oc
  .meta(
    route({
      id: "monitors.delete",
      method: "DELETE",
      path: "/v1/monitors/{monitorId}",
      summary: "Delete a monitor",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "monitors:write",
        resource: "monitor",
        param: "monitorId",
      },
    }),
  )
  .errors(MONITOR_ERRORS)
  .input(z.object({ monitorId: MonitorIdSchema }))
  .output(z.object({ deleted: z.literal(true), monitor: MonitorIdSchema }));
