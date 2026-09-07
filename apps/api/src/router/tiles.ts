/**
 * Tiles — six routes, because they are six refusals.
 *
 * Resizing to the width a tile already has is `WidthUnchanged`; moving to the
 * index it already occupies is `PositionUnchanged`; a reorder naming an index
 * outside the dashboard is `IndexOutOfRange`. Folding them into one PATCH
 * collapses three specific answers into "invalid", and the console then has
 * nothing to say beyond "that did not work".
 *
 * v2 could only write a tile by replacing the whole dashboard, so two people
 * editing one dashboard silently overwrote each other.
 */

import { DashboardId, ProjectId, TileId, unbrand } from "@counted/kernel";
import type { TileWidth } from "@counted/dashboarding-domain";
import {
  addTile,
  moveTile,
  removeTile,
  reorderTiles,
  resizeTile,
  updateTile,
} from "@counted/dashboarding-app";
import { toAnalysis } from "../analysis/wire";
import { fromDashboardError, raise } from "../faults";
import * as serialize from "../serialize";
import { dashboardDeps } from "../wiring";
import type { HandlerDeps } from "./deps";
import { orAnalysisFault, orDashboardFault } from "./support";

export const tileRoutes = ({ deps, guarded }: HandlerDeps) => {
  /**
   * The tile a mutation produced, found by id on the dashboard it came back on.
   *
   * Looked up rather than carried, because the aggregate is the authority on
   * what the tile now is — a handler that echoed its own input back would
   * report a width the domain had clamped.
   */
  const tileOn = (dashboard: Parameters<typeof serialize.dashboard>[0], tile: TileId) => {
    const found = dashboard.tile(tile);
    if (found === undefined) raise(fromDashboardError({ kind: "NoSuchTile", tile }));
    return serialize.tile(found);
  };

  return {
    get: guarded.tiles.get.handler(async ({ input }) => {
      const dashboard = await deps.reads.dashboards.find(DashboardId(input.dashboardId));
      if (dashboard === null) {
        raise(fromDashboardError({ kind: "NoSuchDashboard", dashboard: DashboardId(input.dashboardId) }));
      }
      return { tile: tileOn(dashboard, TileId(input.tileId)) };
    }),

    add: guarded.tiles.add.handler(async ({ input }) => {
      const analysis = orAnalysisFault(toAnalysis(input.analysis));

      // The tile's id is minted inside the use case, so the added tile is
      // identified by being the one that was not there before. Comparing ids is
      // exact; comparing titles would pick the wrong tile on a dashboard with
      // two cards called "Signups".
      const before = await deps.reads.dashboards.find(DashboardId(input.dashboardId));
      const existing = new Set((before?.tiles ?? []).map((tile) => unbrand(tile.id)));

      const added = await deps.uow.transact((repositories) =>
        addTile(dashboardDeps(deps, repositories), {
          dashboard: DashboardId(input.dashboardId),
          title: input.title,
          project: ProjectId(input.project),
          analysis,
          view: input.view,
          width: input.width as TileWidth,
        }),
      );
      const dashboard = orDashboardFault(added);
      const created = dashboard.tiles.find((tile) => !existing.has(unbrand(tile.id)));
      if (created === undefined) {
        raise({
          code: "INTERNAL_SERVER_ERROR",
          message: "The insight was added but could not be identified.",
          data: { reason: "TileNotIdentified" },
        });
      }

      return { dashboard: serialize.dashboard(dashboard), tile: serialize.tile(created) };
    }),

    update: guarded.tiles.update.handler(async ({ input }) => {
      const tile = TileId(input.tileId);
      const analysis =
        input.analysis === undefined ? undefined : orAnalysisFault(toAnalysis(input.analysis));

      const updated = await deps.uow.transact((repositories) =>
        updateTile(dashboardDeps(deps, repositories), {
          dashboard: DashboardId(input.dashboardId),
          tile,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(analysis === undefined ? {} : { analysis }),
          ...(input.view === undefined ? {} : { view: input.view }),
        }),
      );
      const dashboard = orDashboardFault(updated);
      return { dashboard: serialize.dashboard(dashboard), tile: tileOn(dashboard, tile) };
    }),

    resize: guarded.tiles.resize.handler(async ({ input }) => {
      const tile = TileId(input.tileId);
      const resized = await deps.uow.transact((repositories) =>
        resizeTile(dashboardDeps(deps, repositories), {
          dashboard: DashboardId(input.dashboardId),
          tile,
          width: input.width as TileWidth,
        }),
      );
      const dashboard = orDashboardFault(resized);
      return { dashboard: serialize.dashboard(dashboard), tile: tileOn(dashboard, tile) };
    }),

    move: guarded.tiles.move.handler(async ({ input }) => {
      const moved = await deps.uow.transact((repositories) =>
        moveTile(dashboardDeps(deps, repositories), {
          dashboard: DashboardId(input.dashboardId),
          tile: TileId(input.tileId),
          position: input.index,
        }),
      );
      return { dashboard: serialize.dashboard(orDashboardFault(moved)) };
    }),

    reorder: guarded.tiles.reorder.handler(async ({ input }) => {
      const reordered = await deps.uow.transact((repositories) =>
        reorderTiles(dashboardDeps(deps, repositories), {
          dashboard: DashboardId(input.dashboardId),
          order: input.tiles.map((id) => TileId(id)),
        }),
      );
      return { dashboard: serialize.dashboard(orDashboardFault(reordered)) };
    }),

    remove: guarded.tiles.remove.handler(async ({ input }) => {
      const tile = TileId(input.tileId);
      const removed = await deps.uow.transact((repositories) =>
        removeTile(dashboardDeps(deps, repositories), {
          dashboard: DashboardId(input.dashboardId),
          tile,
        }),
      );
      return { dashboard: serialize.dashboard(orDashboardFault(removed)), removed: unbrand(tile) };
    }),
  };
};
