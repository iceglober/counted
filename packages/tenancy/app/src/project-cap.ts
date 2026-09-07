/**
 * Enforcing the project cap — the workspace's half of creating a project.
 *
 * Creating a project is two aggregates: this one agrees the project may exist
 * and takes the slot, `@counted/projects-app` creates it with its first
 * credential. Neither package may import the other, so the composition root
 * calls both **inside one `UnitOfWork.transact`**. That is why these functions
 * take repositories rather than a unit of work: a use case that opened its own
 * transaction would guarantee the split write it exists to prevent — the
 * workspace reserving a slot for a project whose creation then failed.
 *
 * All four commands go through the same load-apply-save path, and all four
 * consult the same count (`Workspace.projectCount`). v2 had the cap check
 * filtering for active projects and the loader counting every row, so the create
 * button and the usage bar could disagree about whether a customer was full.
 */

import { err, isErr, ok, type Instant, type ProjectId, type Result, type WorkspaceId } from "@counted/kernel";
import type { Workspace, WorkspaceApplied, WorkspaceError } from "@counted/tenancy-domain";
import type { WorkspaceRepository } from "./ports";

export type ProjectCapDeps = { readonly workspaces: WorkspaceRepository };

export type ReserveProjectSlotCommand = {
  readonly workspace: WorkspaceId;
  readonly project: ProjectId;
  readonly name: string;
};

export type ProjectSlotCommand = {
  readonly workspace: WorkspaceId;
  readonly project: ProjectId;
};

/**
 * Take a slot for a new project, or refuse.
 *
 * Returns the saved workspace so the caller can read the new count without a
 * second load.
 */
export const reserveProjectSlot = async (
  deps: ProjectCapDeps,
  command: ReserveProjectSlotCommand,
  at: Instant,
): Promise<Result<Workspace, WorkspaceError>> =>
  mutate(deps, command.workspace, (workspace) =>
    workspace.registerProject(command.project, command.name, at),
  );

/** Archive: the project and its data stay, the slot is freed. */
export const releaseProjectSlot = async (
  deps: ProjectCapDeps,
  command: ProjectSlotCommand,
  at: Instant,
): Promise<Result<Workspace, WorkspaceError>> =>
  mutate(deps, command.workspace, (workspace) => workspace.archiveProject(command.project, at));

/** Un-archive, which re-checks the cap — the slot may have been taken since. */
export const restoreProjectSlot = async (
  deps: ProjectCapDeps,
  command: ProjectSlotCommand,
  at: Instant,
): Promise<Result<Workspace, WorkspaceError>> =>
  mutate(deps, command.workspace, (workspace) => workspace.restoreProject(command.project, at));

/**
 * Drop the project from the register because it was deleted.
 *
 * Called in the same transaction as `ProjectRepository.delete`. Skipping it
 * leaves a slot held by a project that no longer exists, and a customer who
 * cannot create another with no way to find out why.
 */
export const dropProjectSlot = async (
  deps: ProjectCapDeps,
  command: ProjectSlotCommand,
  at: Instant,
): Promise<Result<Workspace, WorkspaceError>> =>
  mutate(deps, command.workspace, (workspace) => workspace.deregisterProject(command.project, at));

const mutate = async (
  deps: ProjectCapDeps,
  id: WorkspaceId,
  command: (workspace: Workspace) => Result<WorkspaceApplied, WorkspaceError>,
): Promise<Result<Workspace, WorkspaceError>> => {
  const workspace = await deps.workspaces.find(id);
  if (workspace === null) return err({ kind: "NoSuchWorkspace", workspace: id });

  const applied = command(workspace);
  if (isErr(applied)) return applied;

  await deps.workspaces.save(applied.value.workspace, applied.value.events);
  return ok(applied.value.workspace);
};
