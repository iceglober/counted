/**
 * Dashboards, and the readout fan-out.
 *
 * Every mutation runs inside `deps.uow.transact` because the use cases in
 * `@counted/dashboarding-app` assume they already are — `UnitOfWork` is generic
 * in the repository bundle precisely so the composition root chooses it
 * (V3-SPEC §5). A `Result` returned from `transact` is a *successful*
 * transaction reporting a refused rule and it commits, which is why every
 * refusal below is raised outside the callback rather than thrown inside it.
 */

import { DashboardId, TileId, Duration, Instant, isErr, unbrand } from "@counted/kernel";
import {
  createDashboard,
  setDashboardLayout,
  deleteDashboard,
  listDashboards,
  renameDashboard,
  setDefaultDashboard,
  shareDashboard,
  unshareDashboard,
} from "@counted/dashboarding-app";
import { toWindow } from "../analysis/wire";
import { fromDashboardError, raise } from "../faults";
import * as serialize from "../serialize";
import { dashboardDeps } from "../wiring";
import type { HandlerDeps } from "./deps";
import { runDashboard } from "./readouts";
import { locatedWorkspace, orAnalysisFault, orDashboardFault } from "./support";

export const dashboardRoutes = ({ deps, guarded }: HandlerDeps) => {
  const dashboardOf = async (id: DashboardId) => {
    const found = await deps.reads.dashboards.find(id);
    if (found === null) raise(fromDashboardError({ kind: "NoSuchDashboard", dashboard: id }));
    return found;
  };

  return {
    list: guarded.dashboards.list.handler(async ({ context }) => {
      const workspace = locatedWorkspace(context.authority.located);
      const items = await listDashboards(dashboardDeps(deps, deps.reads), workspace);
      return { items: items.map(serialize.dashboardSummary) };
    }),

    create: guarded.dashboards.create.handler(async ({ input, context }) => {
      const workspace = locatedWorkspace(context.authority.located);
      const created = await deps.uow.transact((repositories) =>
        createDashboard(dashboardDeps(deps, repositories), { workspace, name: input.name }),
      );
      return { dashboard: serialize.dashboard(orDashboardFault(created)) };
    }),

    get: guarded.dashboards.get.handler(async ({ input }) => ({
      dashboard: serialize.dashboard(await dashboardOf(DashboardId(input.dashboardId))),
    })),

    layout: guarded.dashboards.layout.handler(async ({ input }) => {
      const changed = await deps.uow.transact((repositories) => setDashboardLayout(dashboardDeps(deps, repositories), {
        dashboard: DashboardId(input.dashboardId),
        placements: input.placements.map((item) => ({ ...item, id: TileId(item.id), width: item.width as import("@counted/dashboarding-domain").TileWidth })),
      }));
      return { dashboard: serialize.dashboard(orDashboardFault(changed)) };
    }),

    rename: guarded.dashboards.rename.handler(async ({ input }) => {
      const renamed = await deps.uow.transact((repositories) =>
        renameDashboard(dashboardDeps(deps, repositories), {
          dashboard: DashboardId(input.dashboardId),
          name: input.name,
        }),
      );
      return { dashboard: serialize.dashboard(orDashboardFault(renamed)) };
    }),

    delete: guarded.dashboards.delete.handler(async ({ input }) => {
      const id = DashboardId(input.dashboardId);
      const deleted = await deps.uow.transact((repositories) =>
        deleteDashboard(dashboardDeps(deps, repositories), id),
      );
      orDashboardFault(deleted);
      return { deleted: true as const, dashboard: unbrand(id) };
    }),

    setDefault: guarded.dashboards.setDefault.handler(async ({ input }) => {
      const marked = await deps.uow.transact((repositories) =>
        setDefaultDashboard(dashboardDeps(deps, repositories), DashboardId(input.dashboardId)),
      );
      return { dashboard: serialize.dashboard(orDashboardFault(marked)) };
    }),

    readouts: guarded.dashboards.readouts.handler(async ({ input, context }) => {
      const dashboard = await dashboardOf(DashboardId(input.dashboardId));
      const window =
        input.window === undefined ? null : orAnalysisFault(toWindow(input.window));

      return {
        readouts: await runDashboard(deps, {
          dashboard,
          window,
          deadline:
            input.deadlineMs === undefined
              ? deps.config.queryDeadline
              : Duration.millis(input.deadlineMs),
          now: context.at,
          traceId: context.traceId,
        }),
      };
    }),

    share: guarded.dashboards.share.handler(async ({ input, context }) => {
      const ttl =
        input.expiresInMs === undefined
          ? deps.config.shareLinkTtl
          : Duration.millis(input.expiresInMs);

      const shared = await deps.uow.transact((repositories) =>
        shareDashboard(dashboardDeps(deps, repositories), {
          dashboard: DashboardId(input.dashboardId),
          ttl,
        }),
      );
      if (isErr(shared)) raise(fromDashboardError(shared.error));

      // The token exists here and nowhere else. `share` on the dashboard shape
      // carries only the expiry, so a later read cannot hand anyone a working
      // link — revoking and re-sharing is the only way to get a URL back.
      return {
        link: {
          token: shared.value.token,
          expiresAt: Instant.toISO(Instant.plus(context.at, ttl)),
        },
      };
    }),

    unshare: guarded.dashboards.unshare.handler(async ({ input }) => {
      const unshared = await deps.uow.transact((repositories) =>
        unshareDashboard(dashboardDeps(deps, repositories), DashboardId(input.dashboardId)),
      );
      return { dashboard: serialize.dashboard(orDashboardFault(unshared)) };
    }),
  };
};
