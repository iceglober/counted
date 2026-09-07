/**
 * Where a resource sits in the tenancy tree.
 *
 * Q2 compares a principal's binding against this, so getting it from the
 * resource itself — never from the request — is the whole point. v1 derived
 * ownership per route with a hand-written join, each written slightly
 * differently, one of which treated a NULL owner as "everyone".
 *
 * **An unresolvable resource is a 404 and a resource out of reach is a 403,
 * and that is a deliberate disclosure.** A caller who guesses a dashboard id
 * can tell "no such dashboard" from "not yours". The alternative — 404 for
 * both — hides that, and costs the console the ability to say "this dashboard
 * was deleted" instead of "you cannot see this". Ids are UUIDv7, so guessing
 * one is not a practical attack; a `GET /v1/dashboards/{id}` enumeration is.
 * If ids ever become guessable, this is the decision to revisit.
 */

import type { DashboardId, MonitorId, ProjectId, WorkspaceId } from "@counted/kernel";
import type { Placement, Resource } from "@counted/authorization";
import type { ResourceType } from "@counted/contract";
import { DashboardId as toDashboardId, MonitorId as toMonitorId, ProjectId as toProjectId, WorkspaceId as toWorkspaceId } from "@counted/kernel";
import { fromDashboardError, fromMonitorError, fromProjectError, fromWorkspaceError, type Fault } from "../faults";

/** The reads a placement needs, and nothing else. */
export type PlacementReader = {
  workspaceExists(workspace: WorkspaceId): Promise<boolean>;
  /** `undefined` for no such project; `null` workspace for an unclaimed one. */
  projectPlacement(project: ProjectId): Promise<{ workspace: WorkspaceId | null } | undefined>;
  dashboardWorkspace(dashboard: DashboardId): Promise<WorkspaceId | undefined>;
  monitorPlacement(
    monitor: MonitorId,
  ): Promise<{ workspace: WorkspaceId; project: ProjectId } | undefined>;
};

export type Located = {
  readonly resource: Resource;
  readonly placement: Placement;
};

export type Location = { readonly ok: true; readonly located: Located } | { readonly ok: false; readonly fault: Fault };

/**
 * Turn `(resourceType, id)` into the resource and its placement.
 *
 * `credential` has no case because no route in `@counted/contract` authorizes
 * against one — credential routes are authorized on the project that owns the
 * key, which is the resource whose reach actually decides the question. If a
 * route ever names `resource: "credential"`, this switch stops compiling, which
 * is the point of not writing a `default` that guesses.
 */
export const locate = async (
  reader: PlacementReader,
  type: ResourceType,
  raw: string,
): Promise<Location> => {
  switch (type) {
    case "workspace": {
      const workspace = toWorkspaceId(raw);
      return (await reader.workspaceExists(workspace))
        ? found({ type: "workspace", id: workspace }, { workspace, project: null })
        : missing(fromWorkspaceError({ kind: "NoSuchWorkspace", workspace }));
    }

    case "project": {
      const project = toProjectId(raw);
      const placement = await reader.projectPlacement(project);
      if (placement === undefined) {
        return missing(fromProjectError({ kind: "NoSuchProject", project }));
      }
      // An unclaimed project is placed nowhere. `covers` refuses it for every
      // workspace-scoped binding, which is right: it is adopted through a claim
      // grant, never through membership.
      return found({ type: "project", id: project }, { workspace: placement.workspace, project });
    }

    case "dashboard": {
      const dashboard = toDashboardId(raw);
      const workspace = await reader.dashboardWorkspace(dashboard);
      if (workspace === undefined) {
        return missing(fromDashboardError({ kind: "NoSuchDashboard", dashboard }));
      }
      // Placed AT the workspace, project `null` — which is exactly what makes a
      // project-narrowed service key unable to reach it. That refusal is the
      // v2 bug being fixed, not a gap: see `placement.ts` in
      // @counted/authorization.
      return found({ type: "dashboard", id: dashboard }, { workspace, project: null });
    }

    case "monitor": {
      const monitor = toMonitorId(raw);
      const placement = await reader.monitorPlacement(monitor);
      if (placement === undefined) {
        return missing(fromMonitorError({ kind: "NoSuchMonitor", monitor }));
      }
      return found(
        { type: "monitor", id: monitor },
        { workspace: placement.workspace, project: placement.project },
      );
    }

    case "credential":
      return missing({
        code: "INTERNAL_SERVER_ERROR",
        message: "No route authorizes against a credential.",
        data: { reason: "UnresolvableResource", resource: `credential:${raw}` },
      });
  }
};

const found = (resource: Resource, placement: Placement): Location => ({
  ok: true,
  located: { resource, placement },
});

const missing = (fault: Fault): Location => ({ ok: false, fault });
