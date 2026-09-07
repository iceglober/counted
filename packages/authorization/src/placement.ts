/**
 * Q2 — "is this resource inside this principal's reach".
 *
 * Two values and one pure function. `Placement` says where a resource sits in
 * the tenancy tree; `Binding` says how far a principal reaches; `covers`
 * compares them. No library knows our tenancy shape, so this is written out
 * rather than configured, and it is pure so the whole matrix can be tested
 * with no database.
 *
 * THE RULE THIS FILE EXISTS FOR. A resource placed AT the workspace — project
 * `null` — is not reachable by a principal bound to projects. v2 had the
 * opposite:
 *
 *     if (principal.projects === "all") return ALLOW;
 *     if (placement.project === null) return ALLOW;   // <- here
 *
 * so a service key issued on project A, narrowed to project A, could read,
 * write and delete every dashboard in the workspace, rename the workspace, and
 * open a billing checkout — because none of those resources is placed at a
 * project, and "no project" was read as "no restriction". The two are
 * opposites. `covers` treats an unnarrowed placement as *above* the binding
 * and denies it, and `placement.test.ts` proves that exact exploit is refused.
 *
 * The consequence is real and intended: a project-narrowed key cannot touch
 * workspace-placed resources at all. If a dashboard should be reachable by
 * such a key, the dashboard must be placed at a project, or the key must not
 * be narrowed. Widening `covers` instead is the v2 bug being reintroduced.
 */

import type {
  CredentialId,
  DashboardId,
  MonitorId,
  ProjectId,
  WorkspaceId,
} from "@counted/kernel";
import type { Principal } from "./principal";

/**
 * Where a resource sits. Every resource resolves to a workspace, and the
 * project-scoped ones also to a project. One fact, replacing v1's per-route
 * ownership joins — each written slightly differently, one of which treated a
 * NULL owner as "everyone".
 */
export type Placement = {
  /**
   * The workspace that owns the resource, or `null` when nothing does yet.
   *
   * An unclaimed project is the only thing placed nowhere: it exists, it has
   * an id, and its ingest key works, but no membership reaches it because
   * there is no workspace to be a member of. Nullable here rather than the
   * whole placement being `null`, because "a project nobody owns yet" and "no
   * such project" are different answers and the caller needs both.
   */
  readonly workspace: WorkspaceId | null;
  /** The project that owns the resource, or `null` when it sits at the workspace. */
  readonly project: ProjectId | null;
};

/** What is being reached for. The id matters only where identity is the binding. */
export type Resource =
  | { readonly type: "workspace"; readonly id: WorkspaceId }
  | { readonly type: "project"; readonly id: ProjectId }
  | { readonly type: "dashboard"; readonly id: DashboardId }
  | { readonly type: "monitor"; readonly id: MonitorId }
  | { readonly type: "credential"; readonly id: CredentialId };

export type ResourceType = Resource["type"];

/**
 * How far a principal reaches. Derived from the principal, never assembled at
 * a call site — `bindingOf` is the only constructor, so there is one answer to
 * "what does a service key with `projects: 'all'` reach" and it is here.
 */
export type Binding =
  /** Nothing at all. Anonymous, and an account with no membership. */
  | { readonly scope: "nothing" }
  /** Everything placed in one workspace, at any level below it. */
  | { readonly scope: "workspace"; readonly workspace: WorkspaceId }
  /**
   * Only what is placed IN one of these projects. Not the workspace above
   * them, and not a sibling project. `workspace` is `null` for a credential
   * bound to a project that no workspace owns yet.
   */
  | {
      readonly scope: "projects";
      readonly workspace: WorkspaceId | null;
      readonly projects: readonly ProjectId[];
    }
  /**
   * One dashboard by identity, plus the projects that dashboard reads from —
   * and nothing else, including a different dashboard in the same project. A
   * share link is a view of one page, not a guest account.
   */
  | {
      readonly scope: "dashboard";
      readonly dashboard: DashboardId;
      readonly projects: readonly ProjectId[];
    };

/**
 * Why a binding did not reach. Machine-readable because the audit log has to
 * distinguish "your key is for another workspace" from "your key is narrower
 * than this resource" — those are the same 403 to the caller and completely
 * different operational problems.
 */
export type CoverageGap =
  /** The principal reaches nothing: anonymous, or authenticated but not a member. */
  | "BoundToNothing"
  /** The resource belongs to no workspace yet, and this binding needs one. */
  | "Unplaced"
  /** The resource is in a different workspace. */
  | "DifferentWorkspace"
  /** The resource is in a project this binding does not name. */
  | "DifferentProject"
  /** The v2 bug, refused: workspace-placed resource, project-bound principal. */
  | "PlacedAboveBinding"
  /** A share link, pointed at someone else's dashboard. */
  | "DifferentDashboard";

export type Coverage =
  | { readonly covered: true }
  | { readonly covered: false; readonly gap: CoverageGap };

const COVERED: Coverage = { covered: true };
const missing = (gap: CoverageGap): Coverage => ({ covered: false, gap });

export const isCovered = (c: Coverage): c is { readonly covered: true } => c.covered;

/**
 * The reach of each principal kind, in one place.
 *
 * A human reaches the workspace they are a member of — the membership IS the
 * binding, which is why `WorkspaceRole` carries the workspace it was read in.
 * A credential reaches what it was issued against, and never inherits whatever
 * its issuer can do today.
 */
export const bindingOf = (principal: Principal): Binding => {
  switch (principal.kind) {
    case "anonymous":
      return { scope: "nothing" };

    case "account":
      return principal.standing === null
        ? { scope: "nothing" }
        : { scope: "workspace", workspace: principal.standing.workspace };

    case "service":
      return principal.projects === "all"
        ? { scope: "workspace", workspace: principal.workspace }
        : {
            scope: "projects",
            workspace: principal.workspace,
            projects: principal.projects,
          };

    case "ingest":
      return {
        scope: "projects",
        workspace: principal.workspace,
        projects: [principal.project],
      };

    case "share":
      return {
        scope: "dashboard",
        dashboard: principal.dashboard,
        projects: principal.projects,
      };
  }
};

/**
 * Q2. Pure, total, and the only comparison of a binding to a placement.
 *
 * `resource` is read in exactly one branch — a share link's own dashboard,
 * where identity rather than placement is the binding. It is a parameter of
 * the whole function anyway so the signature stays honest about what a
 * coverage question is: who reaches how far, toward what.
 */
export const covers = (binding: Binding, placement: Placement, resource: Resource): Coverage => {
  switch (binding.scope) {
    case "nothing":
      return missing("BoundToNothing");

    case "workspace":
      // Nothing owns it, so no membership and no workspace key reaches it. An
      // unclaimed project is adopted through a claim grant, never through
      // authorization.
      if (placement.workspace === null) return missing("Unplaced");
      return placement.workspace === binding.workspace
        ? COVERED
        : missing("DifferentWorkspace");

    case "projects":
      // Checked FIRST, and this order is the fix. v2 asked "is the resource in
      // one of my projects" only after short-circuiting on `project === null`,
      // which handed every workspace-placed resource to every narrowed key.
      if (placement.project === null) return missing("PlacedAboveBinding");
      if (!binding.projects.includes(placement.project)) return missing("DifferentProject");
      // A binding with no workspace is an unclaimed project's ingest key: the
      // project id above is the whole of its authority. Once the project is
      // claimed, a workspace-issued key must still match the workspace, so a
      // project id leaked from another tenant buys nothing.
      if (binding.workspace !== null && placement.workspace !== binding.workspace) {
        return missing("DifferentWorkspace");
      }
      return COVERED;

    case "dashboard":
      if (resource.type === "dashboard") {
        return resource.id === binding.dashboard ? COVERED : missing("DifferentDashboard");
      }
      // Everything else the link touches is a query against a project one of
      // its tiles reads. The workspace itself, and the workspace's other
      // dashboards, are above it.
      if (placement.project === null) return missing("PlacedAboveBinding");
      return binding.projects.includes(placement.project)
        ? COVERED
        : missing("DifferentProject");
  }
};

/** `covers`, when the caller only branches on the answer. */
export const reaches = (binding: Binding, placement: Placement, resource: Resource): boolean =>
  covers(binding, placement, resource).covered;
