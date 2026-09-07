/**
 * Renaming, archiving, restoring, retention, claiming, deleting.
 *
 * Every one of these is the same three steps — load, apply a domain command,
 * persist the aggregate with its events — so they share `mutate`. The one that
 * is not is `deleteProject`, because deletion is not a state the aggregate can
 * be in and because it has to reach into the credential store.
 */

import {
  ClaimDigest,
  credentialStatus,
  type Project,
  type ProjectApplied,
  type ProjectError,
  type ProjectSnapshot,
  type RetentionPolicy,
} from "@counted/projects-domain";
import { err, ok, type ProjectId, type Result, type WorkspaceId } from "@counted/kernel";
import { envelopes } from "./envelopes";
import type { ProjectDependencies } from "./ports";

/**
 * Load, decide, save — in one transaction, with the events written beside the
 * aggregate that produced them.
 *
 * A domain refusal returns an `Err` **without throwing**, which means the
 * transaction commits. That is deliberate and matches V3-SPEC §5: nothing was
 * written, so there is nothing to roll back, and throwing would make every
 * refused rename look like a database failure in the logs.
 */
const mutate = async (
  deps: ProjectDependencies,
  id: ProjectId,
  decide: (project: Project) => Result<ProjectApplied, ProjectError>,
): Promise<Result<ProjectSnapshot, ProjectError>> =>
  deps.uow.transact(async ({ projects, outbox }) => {
    const project = await projects.find(id);
    if (project === null) return err({ kind: "NoSuchProject", project: id });

    const decided = decide(project);
    if (!decided.ok) return decided;

    await projects.save(decided.value.project, decided.value.events);
    await outbox.enqueue(envelopes(decided.value.events, deps.ids));
    return ok(decided.value.project.snapshot());
  });

export const renameProject = (
  deps: ProjectDependencies,
  command: { readonly project: ProjectId; readonly name: string },
): Promise<Result<ProjectSnapshot, ProjectError>> => {
  const at = deps.clock.now();
  return mutate(deps, command.project, (project) => project.rename(command.name, at));
};

export const archiveProject = (
  deps: ProjectDependencies,
  command: { readonly project: ProjectId },
): Promise<Result<ProjectSnapshot, ProjectError>> => {
  const at = deps.clock.now();
  return mutate(deps, command.project, (project) => project.archive(at));
};

export const restoreProject = (
  deps: ProjectDependencies,
  command: { readonly project: ProjectId },
): Promise<Result<ProjectSnapshot, ProjectError>> => {
  const at = deps.clock.now();
  return mutate(deps, command.project, (project) => project.restore(at));
};

export const setProjectRetention = (
  deps: ProjectDependencies,
  command: { readonly project: ProjectId; readonly retention: RetentionPolicy },
): Promise<Result<ProjectSnapshot, ProjectError>> => {
  const at = deps.clock.now();
  return mutate(deps, command.project, (project) =>
    project.setRetention(command.retention, at),
  );
};

/**
 * Adopt an unclaimed project into a workspace.
 *
 * The caller presents a digest, never a token: hashing is the adapter's, and a
 * use case that took the raw token would have to know which algorithm — which
 * then has to be kept in step with whatever minted it.
 *
 * **The project's keys move with it.** An unclaimed project's ingest key had
 * to be issued against the holding workspace, so after a claim the workspace
 * recorded on that key is the installation's and not the customer's. Nothing
 * about what the key can do depends on it — an ingest principal's binding is
 * read from the project — but everything about whether the customer can *see*
 * it does: their own key would be missing from their workspace's credential
 * listing, and `credentials.self` would answer with an id belonging to nobody
 * they have heard of.
 *
 * It runs after the claim commits, and a failure there is reported by leaving
 * the keys where they are rather than by undoing the claim. The project is
 * genuinely theirs at that point; refusing the claim over a bookkeeping column
 * would be the worse trade, and the same call run again fixes it.
 */
export const claimProject = async (
  deps: ProjectDependencies,
  command: {
    readonly project: ProjectId;
    readonly digest: string;
    readonly into: WorkspaceId;
  },
): Promise<Result<ProjectSnapshot, ProjectError>> => {
  const at = deps.clock.now();
  const claimed = await mutate(deps, command.project, (project) =>
    project.claim(ClaimDigest(command.digest), command.into, at),
  );
  if (!claimed.ok) return claimed;

  await deps.credentials.reassignProject(command.project, command.into);
  return claimed;
};

/**
 * Delete a project and everything under it.
 *
 * Credentials are revoked **first**, and the order is the whole design. If the
 * revocations succeed and the delete then fails, the surviving state is a
 * project nobody can write to — recoverable, and safe. The other order leaves
 * live keys pointing at a project that no longer exists, which is a credential
 * with no owner and no console page to revoke it from.
 *
 * Already-dead keys are skipped rather than re-revoked, so a retried delete
 * does not fail on the second attempt.
 */
export const deleteProject = async (
  deps: ProjectDependencies,
  command: { readonly project: ProjectId },
): Promise<Result<void, ProjectError>> => {
  const at = deps.clock.now();

  const project = await deps.uow.transact(({ projects }) => projects.find(command.project));
  if (project === null) return err({ kind: "NoSuchProject", project: command.project });

  const existing = await deps.credentials.list({ level: "project", project: command.project });
  for (const credential of existing) {
    if (credentialStatus(credential, at) === "revoked") continue;
    await deps.credentials.revoke(credential.id, at);
  }

  await deps.uow.transact(async ({ projects, outbox }) => {
    await projects.delete(command.project);
    await outbox.enqueue(
      envelopes(
        [
          {
            kind: "ProjectDeleted",
            project: command.project,
            workspace: project.workspace,
            at,
          },
        ],
        deps.ids,
      ),
    );
  });

  return ok(undefined);
};
