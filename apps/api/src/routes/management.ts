/**
 * Management: workspaces, projects, dashboards, monitors, credentials.
 *
 * Resource-oriented and consistent, which v1 was not: some endpoints returned
 * bare arrays and others `{data, meta}`, some took ids in the path and others
 * in the body, and `GET /projects` returned whole rows including secrets.
 *
 * Three rules hold throughout:
 *
 *   **Every response is built by `views.ts`**, whose types have no field a
 *   secret could occupy. A leak is a compile error.
 *
 *   **Every list is `{items: [...]}`**, so a client can write one helper.
 *
 *   **Every write goes through the aggregate**, so an invariant cannot be
 *   bypassed by a route that happens to know some SQL — which is how v1's
 *   project deletion ran a raw `pool.query` outside its own transaction.
 */

import {
  CredentialId,
  DashboardId,
  Dashboard,
  MonitorId,
  Project,
  ProjectId,
  WorkspaceId,
  Duration,
  type Principal,
  type Scope,
} from "@counted/domain";
import {
  CreateDashboardRequestSchema,
  CreateProjectRequestSchema,
  IssueCredentialRequestSchema,
  RotateCredentialRequestSchema,
  UpdateDashboardRequestSchema,
  UpdateMonitorRequestSchema,
  UpdateProjectRequestSchema,
  UpdateWorkspaceRequestSchema,
  fieldsFrom,
  validationDetail,
  type z,
} from "@counted/contracts";

import type { Context } from "hono";
import type { Dependencies } from "../composition";
import type { ApiEnv } from "../server";
import {
  dashboardFromPath,
  monitorFromPath,
  projectFromPath,
  requires,
  workspaceFromPath,
  type RouteDefinition,
} from "../http/route";
import { sendProblem } from "../http/respond";
import { body } from "../http/body";
import { credentialView, dashboardView, monitorView, projectView, workspaceView } from "./views";

/** Who to record as the author. A key acts for the account that issued it. */
const actorOf = (principal: Principal) =>
  principal.kind === "account" ? principal.account : principal.kind === "service" ? principal.onBehalfOf : null;

export const managementRoutes = (deps: Dependencies): readonly RouteDefinition[] => {
  const now = () => deps.clock.now();

  return [
    // ── Workspaces ───────────────────────────────────────────────────────────
    {
      method: "get",
      path: "/v1/workspaces/:workspaceId",
      security: requires("workspace:read", workspaceFromPath()),
      handler: async (c) => {
        const workspace = await deps.unitOfWork.transact((r) =>
          r.workspaces.find(WorkspaceId(c.req.param("workspaceId")!)),
        );
        if (workspace === null) return sendProblem(c, "resource.not_found");
        return c.json(workspaceView(workspace));
      },
    },
    {
      method: "patch",
      path: "/v1/workspaces/:workspaceId",
      security: requires("workspace:admin", workspaceFromPath()),
      handler: async (c) => {
        const parsed = await body(c, UpdateWorkspaceRequestSchema);
        if (!parsed.ok) return parsed.response;

        const updated = await deps.unitOfWork.transact(async (r) => {
          const workspace = await r.workspaces.find(WorkspaceId(c.req.param("workspaceId")!));
          if (workspace === null) return null;
          const applied = workspace.rename(parsed.value.name, now());
          if (!applied.ok) return applied;
          await r.workspaces.save(applied.value.workspace, applied.value.events);
          return applied;
        });

        if (updated === null) return sendProblem(c, "resource.not_found");
        if (!updated.ok) return sendProblem(c, "request.validation_failed", { detail: "The name is not usable." });
        return c.json(workspaceView(updated.value.workspace));
      },
    },

    // ── Projects ─────────────────────────────────────────────────────────────
    {
      method: "get",
      path: "/v1/workspaces/:workspaceId/projects",
      security: requires("projects:read", workspaceFromPath()),
      handler: async (c) => {
        const at = now();
        const projects = await deps.unitOfWork.transact((r) =>
          r.projects.listForWorkspace(WorkspaceId(c.req.param("workspaceId")!)),
        );
        // Metadata only. v1's equivalent returned `SELECT *` — serverKey,
        // apiKey and claimToken — to any member of the workspace.
        return c.json({ items: projects.map((p) => projectView(p, at)) });
      },
    },
    {
      method: "post",
      path: "/v1/workspaces/:workspaceId/projects",
      security: requires("projects:write", workspaceFromPath()),
      handler: async (c) => {
        const parsed = await body(c, CreateProjectRequestSchema);
        if (!parsed.ok) return parsed.response;

        const workspaceId = WorkspaceId(c.req.param("workspaceId")!);
        const at = now();
        const projectId = ProjectId(deps.ids.next());
        const issued = deps.secrets.issue("ck");

        const created = await deps.unitOfWork.transact(async (r) => {
          const workspace = await r.workspaces.find(workspaceId);
          if (workspace === null) return null;

          // Registering on the workspace enforces the project cap; creating the
          // project mints its first ingest credential. Both, or neither — v1
          // had no such boundary.
          const registered = workspace.provisionProject(projectId, parsed.value.name, at);
          if (!registered.ok) return registered;

          const project = Project.create(
            projectId,
            parsed.value.name,
            workspaceId,
            {
              id: CredentialId(deps.ids.next()),
              kind: "ingest",
              label: "Default",
              digest: issued.digest,
              prefix: issued.prefix,
            },
            at,
          );
          if (!project.ok) return project;

          await r.workspaces.save(registered.value.workspace, registered.value.events);
          await r.projects.save(project.value.project, project.value.events);
          return project;
        });

        if (created === null) return sendProblem(c, "resource.not_found");
        if (!created.ok) {
          return sendProblem(c, "resource.conflict", {
            detail: "The workspace cannot take another project — check its plan limits.",
          });
        }

        c.header("location", `/v1/projects/${projectId}`);
        // The secret is returned here and never again. This is one of exactly
        // two endpoints that can disclose one.
        return c.json(
          {
            project: projectView(created.value.project, at),
            credential: { credential: credentialView(created.value.credential, at), secret: issued.secret },
          },
          201,
        );
      },
    },
    {
      method: "get",
      path: "/v1/projects/:projectId",
      security: requires("projects:read", projectFromPath()),
      handler: async (c) => {
        const at = now();
        const project = await deps.unitOfWork.transact((r) =>
          r.projects.find(ProjectId(c.req.param("projectId")!)),
        );
        if (project === null) return sendProblem(c, "resource.not_found");
        return c.json(projectView(project, at));
      },
    },
    {
      method: "patch",
      path: "/v1/projects/:projectId",
      security: requires("projects:write", projectFromPath()),
      handler: async (c) => {
        const parsed = await body(c, UpdateProjectRequestSchema);
        if (!parsed.ok) return parsed.response;
        const at = now();

        const updated = await deps.unitOfWork.transact(async (r) => {
          const project = await r.projects.find(ProjectId(c.req.param("projectId")!));
          if (project === null) return null;
          const applied = project.rename(parsed.value.name, at);
          if (!applied.ok) return applied;
          await r.projects.save(applied.value.project, applied.value.events);
          return applied;
        });

        if (updated === null) return sendProblem(c, "resource.not_found");
        if (!updated.ok) return sendProblem(c, "request.validation_failed", { detail: "The name is not usable." });
        return c.json(projectView(updated.value.project, at));
      },
    },

    // ── Credentials ──────────────────────────────────────────────────────────
    {
      method: "get",
      path: "/v1/projects/:projectId/credentials",
      security: requires("credentials:read", projectFromPath()),
      handler: async (c) => {
        const at = now();
        const project = await deps.unitOfWork.transact((r) =>
          r.projects.find(ProjectId(c.req.param("projectId")!)),
        );
        if (project === null) return sendProblem(c, "resource.not_found");
        // Every credential, including revoked ones — an audit needs to see
        // what existed, not only what still works.
        return c.json({ items: project.snapshot().credentials.map((cred) => credentialView(cred, at)) });
      },
    },
    {
      method: "post",
      path: "/v1/projects/:projectId/credentials",
      security: requires("credentials:write", projectFromPath()),
      handler: async (c) => {
        const parsed = await body(c, IssueCredentialRequestSchema);
        if (!parsed.ok) return parsed.response;
        const at = now();
        const issued = deps.secrets.issue(parsed.value.kind === "ingest" ? "ck" : "sk");

        const result = await deps.unitOfWork.transact(async (r) => {
          const project = await r.projects.find(ProjectId(c.req.param("projectId")!));
          if (project === null) return null;
          const applied = project.issue(
            {
              id: CredentialId(deps.ids.next()),
              kind: parsed.value.kind,
              label: parsed.value.label,
              digest: issued.digest,
              prefix: issued.prefix,
              // Ignored for ingest keys: the aggregate forces events:write and
              // nothing else, whatever was asked for.
              ...(parsed.value.scopes === undefined ? {} : { scopes: parsed.value.scopes as Scope[] }),
            },
            at,
          );
          if (!applied.ok) return applied;
          await r.projects.save(applied.value.project, applied.value.events);
          return applied;
        });

        if (result === null) return sendProblem(c, "resource.not_found");
        if (!result.ok) {
          // Say which rule was broken. A generic "could not be issued" leaves
          // the caller to guess, and the commonest case has an obvious fix.
          if (result.error.kind === "ScopesRequired") {
            return sendProblem(c, "request.validation_failed", {
              detail: "A service credential must be issued with at least one scope.",
              fields: [{ path: "scopes", code: "required", message: "At least one scope is required." }],
            });
          }
          return sendProblem(c, "resource.conflict", { detail: "The credential could not be issued." });
        }

        return c.json({ credential: credentialView(result.value.credential, at), secret: issued.secret }, 201);
      },
    },
    {
      method: "post",
      path: "/v1/projects/:projectId/credentials/:credentialId/rotate",
      security: requires("credentials:write", projectFromPath()),
      handler: async (c) => {
        const parsed = await body(c, RotateCredentialRequestSchema);
        if (!parsed.ok) return parsed.response;
        const at = now();

        const result = await deps.unitOfWork.transact(async (r) => {
          const project = await r.projects.find(ProjectId(c.req.param("projectId")!));
          if (project === null) return null;
          const existing = project
            .snapshot()
            .credentials.find((cred) => String(cred.id) === c.req.param("credentialId"));
          if (existing === undefined) return null;

          const issued = deps.secrets.issue(existing.kind === "ingest" ? "ck" : "sk");
          const applied = project.rotate(
            CredentialId(c.req.param("credentialId")!),
            {
              id: CredentialId(deps.ids.next()),
              kind: existing.kind,
              label: parsed.value.label,
              digest: issued.digest,
              prefix: issued.prefix,
              ...(existing.scopes.length === 0 ? {} : { scopes: [...existing.scopes] }),
            },
            // The old secret keeps working for this long. Rotating without an
            // overlap breaks every deployed client at the instant of the click.
            Duration.hours(parsed.value.overlapHours),
            at,
          );
          if (!applied.ok) return { failed: true as const };
          await r.projects.save(applied.value.project, applied.value.events);
          return { failed: false as const, credential: applied.value.credential, secret: issued.secret };
        });

        if (result === null) return sendProblem(c, "resource.not_found");
        if (result.failed) {
          return sendProblem(c, "resource.conflict", { detail: "The credential could not be rotated." });
        }
        return c.json({ credential: credentialView(result.credential, at), secret: result.secret }, 201);
      },
    },
    {
      method: "delete",
      path: "/v1/projects/:projectId/credentials/:credentialId",
      security: requires("credentials:write", projectFromPath()),
      handler: async (c) => {
        const at = now();
        const result = await deps.unitOfWork.transact(async (r) => {
          const project = await r.projects.find(ProjectId(c.req.param("projectId")!));
          if (project === null) return null;
          const applied = project.revoke(CredentialId(c.req.param("credentialId")!), at);
          if (!applied.ok) return applied;
          await r.projects.save(applied.value.project, applied.value.events);
          return applied;
        });

        if (result === null) return sendProblem(c, "resource.not_found");
        if (!result.ok) {
          // The aggregate refuses to leave a project unable to ingest.
          return sendProblem(c, "resource.conflict", {
            detail: "That is the project's last usable ingest credential. Issue another one first.",
          });
        }
        return c.body(null, 204);
      },
    },

    // ── Dashboards ───────────────────────────────────────────────────────────
    {
      method: "get",
      path: "/v1/workspaces/:workspaceId/dashboards",
      security: requires("dashboards:read", workspaceFromPath()),
      handler: async (c) => {
        const dashboards = await deps.unitOfWork.transact((r) =>
          r.dashboards.listForWorkspace(WorkspaceId(c.req.param("workspaceId")!)),
        );
        return c.json({ items: dashboards.map(dashboardView) });
      },
    },
    {
      method: "post",
      path: "/v1/workspaces/:workspaceId/dashboards",
      security: requires("dashboards:write", workspaceFromPath()),
      handler: async (c) => {
        const parsed = await body(c, CreateDashboardRequestSchema);
        if (!parsed.ok) return parsed.response;

        const id = DashboardId(deps.ids.next());
        const workspace = WorkspaceId(c.req.param("workspaceId")!);
        // Empty. v1 auto-populated a new dashboard with four insights nobody
        // asked for, then made "default" mean two different things.
        const dashboard = Dashboard.create(id, workspace, parsed.value.name, now(), parsed.value.isDefault ?? false);
        if (!dashboard.ok) {
          return sendProblem(c, "request.validation_failed", { detail: "The name is not usable." });
        }

        await deps.unitOfWork.transact((r) =>
          r.dashboards.save(dashboard.value.dashboard, dashboard.value.events),
        );
        c.header("location", `/v1/dashboards/${id}`);
        return c.json(dashboardView(dashboard.value.dashboard), 201);
      },
    },
    {
      method: "get",
      path: "/v1/dashboards/:dashboardId",
      security: requires("dashboards:read", dashboardFromPath()),
      handler: async (c) => {
        const dashboard = await deps.unitOfWork.transact((r) =>
          r.dashboards.find(DashboardId(c.req.param("dashboardId")!)),
        );
        if (dashboard === null) return sendProblem(c, "resource.not_found");
        return c.json(dashboardView(dashboard));
      },
    },
    {
      method: "patch",
      path: "/v1/dashboards/:dashboardId",
      security: requires("dashboards:write", dashboardFromPath()),
      handler: async (c) => {
        const parsed = await body(c, UpdateDashboardRequestSchema);
        if (!parsed.ok) return parsed.response;
        const at = now();

        const updated = await deps.unitOfWork.transact(async (r) => {
          const dashboard = await r.dashboards.find(DashboardId(c.req.param("dashboardId")!));
          if (dashboard === null) return null;
          const applied = dashboard.rename(parsed.value.name, at);
          if (!applied.ok) return applied;
          await r.dashboards.save(applied.value.dashboard, applied.value.events);
          return applied;
        });

        if (updated === null) return sendProblem(c, "resource.not_found");
        if (!updated.ok) return sendProblem(c, "request.validation_failed", { detail: "The name is not usable." });
        return c.json(dashboardView(updated.value.dashboard));
      },
    },
    {
      method: "delete",
      path: "/v1/dashboards/:dashboardId",
      security: requires("dashboards:write", dashboardFromPath()),
      handler: async (c) => {
        const id = DashboardId(c.req.param("dashboardId")!);
        const found = await deps.unitOfWork.transact(async (r) => {
          const dashboard = await r.dashboards.find(id);
          if (dashboard === null) return false;
          await r.dashboards.delete(id);
          return true;
        });
        if (!found) return sendProblem(c, "resource.not_found");
        return c.body(null, 204);
      },
    },

    // ── Monitors ─────────────────────────────────────────────────────────────
    {
      method: "get",
      path: "/v1/projects/:projectId/monitors",
      security: requires("monitors:read", projectFromPath()),
      handler: async (c) => {
        const monitors = await deps.unitOfWork.transact((r) =>
          r.monitors.listForProject(ProjectId(c.req.param("projectId")!)),
        );
        return c.json({ items: monitors.map(monitorView) });
      },
    },
    {
      method: "get",
      path: "/v1/monitors/:monitorId",
      security: requires("monitors:read", monitorFromPath()),
      handler: async (c) => {
        const monitor = await deps.unitOfWork.transact((r) =>
          r.monitors.find(MonitorId(c.req.param("monitorId")!)),
        );
        if (monitor === null) return sendProblem(c, "resource.not_found");
        return c.json(monitorView(monitor));
      },
    },
    {
      method: "patch",
      path: "/v1/monitors/:monitorId",
      security: requires("monitors:write", monitorFromPath()),
      handler: async (c) => {
        const parsed = await body(c, UpdateMonitorRequestSchema);
        if (!parsed.ok) return parsed.response;
        const at = now();

        const updated = await deps.unitOfWork.transact(async (r) => {
          const monitor = await r.monitors.find(MonitorId(c.req.param("monitorId")!));
          if (monitor === null) return null;
          const applied = parsed.value.enabled ? monitor.enable(at) : monitor.disable(at);
          // Already in the requested state: the outcome the caller asked for
          // is the outcome, so this is not an error.
          if (!applied.ok) return { monitor };
          await r.monitors.save(applied.value.monitor, applied.value.events);
          return { monitor: applied.value.monitor };
        });

        if (updated === null) return sendProblem(c, "resource.not_found");
        return c.json(monitorView(updated.monitor));
      },
    },
  ];
};
