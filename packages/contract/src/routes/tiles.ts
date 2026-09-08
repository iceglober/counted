/**
 * Tiles — the whole of them, which v2 did not have.
 *
 * v2 could create and delete a dashboard but a tile could only be written by
 * replacing the dashboard wholesale, so two people editing one dashboard would
 * silently overwrite each other and the console had to send every tile back on
 * every change. Each mutation here is the one the domain actually implements:
 * `addTile`, `updateTile`, `resizeTile`, `moveTile`, `reorderTiles`,
 * `removeTile`.
 *
 * Resize, move and reorder are separate from update because they are separate
 * refusals. Resizing to the width a tile already has is `WidthUnchanged`;
 * moving to the index it already occupies is `PositionUnchanged`; and a
 * reorder that names an index outside the dashboard is `IndexOutOfRange`. Folding
 * them into one PATCH would collapse three specific answers into "invalid".
 *
 * The tile-order route is `/tile-order` rather than `/tiles/order`, so that no
 * path can be read as either a tile whose id is "order" or the ordering itself.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";
import { route } from "../route";
import { TILE_ERRORS } from "../errors";
import { DashboardIdSchema, ProjectIdSchema, TileIdSchema } from "../primitives";
import { AnalysisSchema } from "../schemas/analysis";
import {
  DashboardSchema,
  TileSchema,
  TileViewSchema,
  TileWidthSchema,
} from "../schemas/dashboarding";

const TAGS = ["insights"] as const;

const write = (param: string) =>
  ({
    kind: "resource",
    permission: "dashboards:write",
    resource: "dashboard",
    param,
  }) as const;

export const get = oc
  .meta(
    route({
      id: "tiles.get",
      method: "GET",
      path: "/v1/dashboards/{dashboardId}/tiles/{tileId}",
      summary: "Read one insight",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "dashboards:read",
        resource: "dashboard",
        param: "dashboardId",
      },
    }),
  )
  .errors(TILE_ERRORS)
  .input(z.object({ dashboardId: DashboardIdSchema, tileId: TileIdSchema }))
  .output(z.object({ tile: TileSchema }));

export const add = oc
  .meta(
    route({
      id: "tiles.add",
      method: "POST",
      path: "/v1/dashboards/{dashboardId}/tiles",
      summary: "Add an insight",
      description:
        "An insight names its own project, so one dashboard can show two products side by side. Refused with `TooManyTiles` at the limit, and the dashboard is left untouched.",
      tags: TAGS,
      authorize: write("dashboardId"),
      successStatus: 201,
    }),
  )
  .errors(TILE_ERRORS)
  .input(
    z.object({
      dashboardId: DashboardIdSchema,
      title: z.string().min(1).max(200),
      project: ProjectIdSchema,
      analysis: AnalysisSchema,
      view: TileViewSchema,
      width: TileWidthSchema,
    }),
  )
  .output(z.object({ dashboard: DashboardSchema, tile: TileSchema }));

export const update = oc
  .meta(
    route({
      id: "tiles.update",
      method: "PATCH",
      path: "/v1/dashboards/{dashboardId}/tiles/{tileId}",
      summary: "Change an insight's title, view or question",
      description: "Omitted fields are left alone. Width and position have their own routes.",
      tags: TAGS,
      authorize: write("dashboardId"),
    }),
  )
  .errors(TILE_ERRORS)
  .input(
    z.object({
      dashboardId: DashboardIdSchema,
      tileId: TileIdSchema,
      title: z.string().min(1).max(200).optional(),
      analysis: AnalysisSchema.optional(),
      view: TileViewSchema.optional(),
    }),
  )
  .output(z.object({ dashboard: DashboardSchema, tile: TileSchema }));

export const resize = oc
  .meta(
    route({
      id: "tiles.resize",
      method: "PUT",
      path: "/v1/dashboards/{dashboardId}/tiles/{tileId}/width",
      summary: "Set an insight's width",
      description: "Twelfths of a row, 1 to 12. The only width vocabulary there is.",
      tags: TAGS,
      authorize: write("dashboardId"),
    }),
  )
  .errors(TILE_ERRORS)
  .input(
    z.object({
      dashboardId: DashboardIdSchema,
      tileId: TileIdSchema,
      width: TileWidthSchema,
    }),
  )
  .output(z.object({ dashboard: DashboardSchema, tile: TileSchema }));

export const move = oc
  .meta(
    route({
      id: "tiles.move",
      method: "PUT",
      path: "/v1/dashboards/{dashboardId}/tiles/{tileId}/position",
      summary: "Move an insight to an index",
      tags: TAGS,
      authorize: write("dashboardId"),
    }),
  )
  .errors(TILE_ERRORS)
  .input(
    z.object({
      dashboardId: DashboardIdSchema,
      tileId: TileIdSchema,
      index: z.int().nonnegative(),
    }),
  )
  .output(z.object({ dashboard: DashboardSchema }));

export const reorder = oc
  .meta(
    route({
      id: "tiles.reorder",
      method: "PUT",
      path: "/v1/dashboards/{dashboardId}/tile-order",
      summary: "Replace the insight order",
      description:
        "The list must name every insight on the dashboard exactly once — a partial order is a lost insight.",
      tags: TAGS,
      authorize: write("dashboardId"),
    }),
  )
  .errors(TILE_ERRORS)
  .input(
    z.object({
      dashboardId: DashboardIdSchema,
      tiles: z.array(TileIdSchema).min(1),
    }),
  )
  .output(z.object({ dashboard: DashboardSchema }));

export const remove = oc
  .meta(
    route({
      id: "tiles.remove",
      method: "DELETE",
      path: "/v1/dashboards/{dashboardId}/tiles/{tileId}",
      summary: "Remove an insight",
      tags: TAGS,
      authorize: write("dashboardId"),
    }),
  )
  .errors(TILE_ERRORS)
  .input(z.object({ dashboardId: DashboardIdSchema, tileId: TileIdSchema }))
  .output(z.object({ dashboard: DashboardSchema, removed: TileIdSchema }));
