/**
 * ProjectRepository — the Project aggregate, loaded and saved whole.
 *
 * Type parameters follow the convention described in
 * `@counted/tenancy-ports/workspace-repository`: `Project` and `ProjectEvent`
 * live in `@counted/projects-domain` and are closed in `@counted/projects-app`.
 */

import type { DomainEvent, ProjectId, WorkspaceId } from "@counted/kernel";

/** Enough to render a project picker without hydrating every aggregate. */
export type ProjectSummary = {
  readonly id: ProjectId;
  readonly workspace: WorkspaceId;
  readonly name: string;
  readonly archived: boolean;
};

export interface ProjectRepository<Project, ProjectEvent extends DomainEvent> {
  find(id: ProjectId): Promise<Project | null>;

  /**
   * Every project in the workspace, archived ones included. Filtering is the
   * caller's decision: the console hides archived projects, the quota check
   * counts them, and a repository that chose for both would be wrong for one.
   */
  listForWorkspace(workspace: WorkspaceId): Promise<readonly Project[]>;

  summariesForWorkspace(workspace: WorkspaceId): Promise<readonly ProjectSummary[]>;

  save(project: Project, events: readonly ProjectEvent[]): Promise<void>;

  /**
   * Remove the project and everything under it.
   *
   * Separate from `save` because deletion is not a state the aggregate can be
   * in — and because v1's version ran outside the surrounding transaction,
   * which is the failure this signature exists to make impossible: it is only
   * reachable through a `UnitOfWork`.
   */
  delete(id: ProjectId): Promise<void>;
}
