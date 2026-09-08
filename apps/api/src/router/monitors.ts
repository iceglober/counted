/**
 * Monitors: a scalar question watched against a threshold.
 *
 * "The analysis must produce one number" is enforced here through the
 * `isScalar` function the composition root supplies — the rule belongs to
 * analytics, and `@counted/dashboarding-domain` holds the analysis as an opaque
 * `A` (V3-SPEC §7). A series or a breakdown is refused with
 * `AnalysisMustBeScalar` rather than silently reduced to its first bucket.
 *
 * v2 had enable and disable and nothing else: a monitor could only come into
 * existence through a database write, and changing a threshold meant deleting
 * and recreating it — which reset the breach state and re-announced a breach
 * that had already been reported.
 */

import { Duration, MonitorId, unbrand } from "@counted/kernel";
import {
  createMonitor,
  deleteMonitor,
  disableMonitor,
  enableMonitor,
  getMonitor,
  listMonitorsForProject,
  listMonitorsForWorkspace,
  updateMonitor,
} from "@counted/dashboarding-app";
import { toAnalysis } from "../analysis/wire";
import * as serialize from "../serialize";
import { monitorDeps } from "../wiring";
import type { HandlerDeps } from "./deps";
import {
  locatedProject,
  locatedWorkspace,
  orAnalysisFault,
  orMonitorFault,
} from "./support";

export const monitorRoutes = ({ deps, guarded }: HandlerDeps) => ({
  list: guarded.monitors.list.handler(async ({ context }) => {
    const workspace = locatedWorkspace(context.authority.located);
    const items = await listMonitorsForWorkspace(monitorDeps(deps, deps.reads), workspace);
    return { items: items.map(serialize.monitor) };
  }),

  listForProject: guarded.monitors.listForProject.handler(async ({ context }) => {
    const project = locatedProject(context.authority.located);
    const items = await listMonitorsForProject(monitorDeps(deps, deps.reads), project);
    return { items: items.map(serialize.monitor) };
  }),

  create: guarded.monitors.create.handler(async ({ input, context }) => {
    const project = locatedProject(context.authority.located);
    const workspace = locatedWorkspace(context.authority.located);
    const analysis = orAnalysisFault(toAnalysis(input.analysis));

    const created = await deps.uow.transact((repositories) =>
      createMonitor(monitorDeps(deps, repositories), {
        workspace,
        project,
        name: input.name,
        analysis,
        threshold: input.threshold,
        ...(input.cooldownMs === undefined ? {} : { cooldown: Duration.millis(input.cooldownMs) }),
        channels: input.channels,
      }),
    );
    return { monitor: serialize.monitor(orMonitorFault(created)) };
  }),

  get: guarded.monitors.get.handler(async ({ input }) => {
    const found = await getMonitor(monitorDeps(deps, deps.reads), MonitorId(input.monitorId));
    return { monitor: serialize.monitor(orMonitorFault(found)) };
  }),

  /**
   * One update surface, three domain commands, kept apart on purpose.
   *
   * Retargeting the question resets breach state; changing the cooldown or the
   * channels does not. Collapsing them into one `UPDATE … SET` — which is what
   * v1 did to alerts — is how muting a channel makes a monitor re-announce a
   * breach it already reported.
   */
  update: guarded.monitors.update.handler(async ({ input }) => {
    const analysis =
      input.analysis === undefined ? undefined : orAnalysisFault(toAnalysis(input.analysis));

    const updated = await deps.uow.transact((repositories) =>
      updateMonitor(monitorDeps(deps, repositories), {
        monitor: MonitorId(input.monitorId),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(analysis === undefined ? {} : { analysis }),
        ...(input.threshold === undefined ? {} : { threshold: input.threshold }),
        ...(input.cooldownMs === undefined ? {} : { cooldown: Duration.millis(input.cooldownMs) }),
        ...(input.channels === undefined ? {} : { channels: input.channels }),
      }),
    );
    return { monitor: serialize.monitor(orMonitorFault(updated)) };
  }),

  enable: guarded.monitors.enable.handler(async ({ input }) => {
    const enabled = await deps.uow.transact((repositories) =>
      enableMonitor(monitorDeps(deps, repositories), MonitorId(input.monitorId)),
    );
    return { monitor: serialize.monitor(orMonitorFault(enabled)) };
  }),

  disable: guarded.monitors.disable.handler(async ({ input }) => {
    const disabled = await deps.uow.transact((repositories) =>
      disableMonitor(monitorDeps(deps, repositories), MonitorId(input.monitorId)),
    );
    return { monitor: serialize.monitor(orMonitorFault(disabled)) };
  }),

  delete: guarded.monitors.delete.handler(async ({ input }) => {
    const id = MonitorId(input.monitorId);
    orMonitorFault(
      await deps.uow.transact((repositories) =>
        deleteMonitor(monitorDeps(deps, repositories), id),
      ),
    );
    return { deleted: true as const, monitor: unbrand(id) };
  }),
});
