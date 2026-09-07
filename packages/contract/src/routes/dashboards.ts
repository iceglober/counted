/**
 * Dashboards and their readouts.
 *
 * `dashboards.readouts` returns an outcome per tile rather than failing the
 * request when one question cannot be answered. Eleven tiles with answers and a
 * twelfth saying "the engine timed out" is a usable page; a 504 for the whole
 * dashboard is not. The single-question route, `queries.run`, does the
 * opposite, because there the failed question is the only one there was.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";
import { route } from "../route";
import { DASHBOARD_ERRORS } from "../errors";
import { DashboardIdSchema, DurationMsSchema, WorkspaceIdSchema } from "../primitives";
import {
  TilePlacementSchema,
  DashboardSchema,
  DashboardSummarySchema,
  ShareLinkSchema,
} from "../schemas/dashboarding";
import { WindowSchema } from "../schemas/analysis";
import { ReadoutSchema } from "../schemas/readout";

const TAGS = ["dashboards"] as const;

const NameSchema = z.string().min(1).max(200);

export const list = oc
  .meta(
    route({
      id: "dashboards.list",
      method: "GET",
      path: "/v1/workspaces/{workspaceId}/dashboards",
      summary: "List a workspace's dashboards",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "dashboards:read",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(DASHBOARD_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema }))
  .output(z.object({ items: z.array(DashboardSummarySchema) }));

export const create = oc
  .meta(
    route({
      id: "dashboards.create",
      method: "POST",
      path: "/v1/workspaces/{workspaceId}/dashboards",
      summary: "Create a dashboard",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "dashboards:write",
        resource: "workspace",
        param: "workspaceId",
      },
      successStatus: 201,
    }),
  )
  .errors(DASHBOARD_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema, name: NameSchema }))
  .output(z.object({ dashboard: DashboardSchema }));

export const get = oc
  .meta(
    route({
      id: "dashboards.get",
      method: "GET",
      path: "/v1/dashboards/{dashboardId}",
      summary: "Read a dashboard and its insights",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "dashboards:read",
        resource: "dashboard",
        param: "dashboardId",
      },
    }),
  )
  .errors(DASHBOARD_ERRORS)
  .input(z.object({ dashboardId: DashboardIdSchema }))
  .output(z.object({ dashboard: DashboardSchema }));

export const rename = oc
  .meta(
    route({
      id: "dashboards.rename",
      method: "PATCH",
      path: "/v1/dashboards/{dashboardId}",
      summary: "Rename a dashboard",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "dashboards:write",
        resource: "dashboard",
        param: "dashboardId",
      },
    }),
  )
  .errors(DASHBOARD_ERRORS)
  .input(z.object({ dashboardId: DashboardIdSchema, name: NameSchema }))
  .output(z.object({ dashboard: DashboardSchema }));

export const remove = oc
  .meta(
    route({
      id: "dashboards.delete",
      method: "DELETE",
      path: "/v1/dashboards/{dashboardId}",
      summary: "Delete a dashboard",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "dashboards:write",
        resource: "dashboard",
        param: "dashboardId",
      },
    }),
  )
  .errors(DASHBOARD_ERRORS)
  .input(z.object({ dashboardId: DashboardIdSchema }))
  .output(z.object({ deleted: z.literal(true), dashboard: DashboardIdSchema }));

export const setDefault = oc
  .meta(
    route({
      id: "dashboards.setDefault",
      method: "PUT",
      path: "/v1/dashboards/{dashboardId}/default",
      summary: "Make this the workspace's default dashboard",
      description: "Clears the flag on whichever dashboard held it. A workspace has at most one.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "dashboards:write",
        resource: "dashboard",
        param: "dashboardId",
      },
    }),
  )
  .errors(DASHBOARD_ERRORS)
  .input(z.object({ dashboardId: DashboardIdSchema }))
  .output(z.object({ dashboard: DashboardSchema }));

export const readouts = oc
  .meta(
    route({
      id: "dashboards.readouts",
      method: "POST",
      path: "/v1/dashboards/{dashboardId}/readouts",
      summary: "Run every insight on a dashboard",
      description:
        "One outcome per insight. `window` rebases every insight's question onto a different interval, which is how a range picker works without an insight storing a second copy of its question.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "queries:run",
        resource: "dashboard",
        param: "dashboardId",
      },
    }),
  )
  .errors(DASHBOARD_ERRORS)
  .input(
    z.object({
      dashboardId: DashboardIdSchema,
      window: WindowSchema.optional(),
      /** Per-tile budget. The engine gives up at this point and says so. */
      deadlineMs: DurationMsSchema.optional(),
    }),
  )
  .output(z.object({ readouts: z.array(ReadoutSchema) }));

export const share = oc
  .meta(
    route({
      id: "dashboards.share",
      method: "POST",
      path: "/v1/dashboards/{dashboardId}/share",
      summary: "Create a read-only share link",
      description:
        "The token is returned once. A share link reaches its own dashboard by identity and may run only the queries that dashboard's insights name — it is not a workspace-wide read token.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "dashboards:write",
        resource: "dashboard",
        param: "dashboardId",
      },
      successStatus: 201,
    }),
  )
  .errors(DASHBOARD_ERRORS)
  .input(
    z.object({
      dashboardId: DashboardIdSchema,
      expiresInMs: DurationMsSchema.optional(),
    }),
  )
  .output(z.object({ link: ShareLinkSchema }));

export const unshare = oc
  .meta(
    route({
      id: "dashboards.unshare",
      method: "DELETE",
      path: "/v1/dashboards/{dashboardId}/share",
      summary: "Revoke a share link",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "dashboards:write",
        resource: "dashboard",
        param: "dashboardId",
      },
    }),
  )
  .errors(DASHBOARD_ERRORS)
  .input(z.object({ dashboardId: DashboardIdSchema }))
  .output(z.object({ dashboard: DashboardSchema }));

export const layout = oc.meta(route({
  id: "dashboards.layout", method: "PUT", path: "/v1/dashboards/{dashboardId}/layout",
  summary: "Arrange and resize the insights on a dashboard",
  description: "Replace every insight's grid position, width and height in one transaction. The complete layout must fit the twelve-column grid without overlaps. Repeating the same layout succeeds.",
  tags: TAGS,
  authorize: { kind: "resource", permission: "dashboards:write", resource: "dashboard", param: "dashboardId" },
})).errors(DASHBOARD_ERRORS)
  .input(z.object({ dashboardId: DashboardIdSchema, placements: z.array(TilePlacementSchema).max(50) }))
  .output(z.object({ dashboard: DashboardSchema }));
