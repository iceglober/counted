/**
 * The port type parameters, closed once.
 *
 * `@counted/projects-ports` is generic in the aggregate and its event type so
 * that seven packages could be written in parallel against a tree that
 * compiles (V3-SPEC §5). This file is where the generics get their arguments,
 * and it is the only place in the context that should mention `Repo<…, …>`.
 *
 * `ProjectRepositories` bundles the outbox with the repository on purpose:
 * `Outbox.enqueue` must run inside `UnitOfWork.transact` and nowhere else, and
 * the only way to make that mechanically true is to hand it out through the
 * same callback that opens the transaction.
 */

import type { Clock, IdGenerator } from "@counted/kernel/ports";
import type { CredentialStore } from "@counted/identity-ports";
import type { Outbox, UnitOfWork } from "@counted/persistence-ports";
import type { Project, ProjectEvent } from "@counted/projects-domain";
import type { ProjectRepository as Repo } from "@counted/projects-ports";

export type ProjectRepository = Repo<Project, ProjectEvent>;

export type ProjectRepositories = {
  readonly projects: ProjectRepository;
  readonly outbox: Outbox;
};

export type ProjectUnitOfWork = UnitOfWork<ProjectRepositories>;

/**
 * What every use case in this package needs.
 *
 * Notably absent: `@counted/authorization`. The permission decision runs in
 * `apps/*` before the use case, and a use case that re-checked it would be a
 * second policy (V3-SPEC §7). What arrives here instead is `held` — the
 * issuer's already-expanded permission set, as a value — which is what
 * `grantableTo` needs to answer Q3 without owning the grant table.
 */
export type ProjectDependencies = {
  readonly uow: ProjectUnitOfWork;
  readonly credentials: CredentialStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
};
