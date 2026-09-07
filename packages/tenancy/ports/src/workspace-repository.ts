/**
 * WorkspaceRepository — loading and saving the tenancy aggregate whole.
 *
 * Aggregate-shaped rather than table-shaped. v1 had no repository layer at all:
 * eight modules imported a raw `pg.Pool` and built SQL strings, and two flows
 * labelled "transactional" were not.
 *
 * `save` takes the aggregate **and its events**, so persisting state and
 * enqueuing the outbox happen in one transaction or neither does.
 *
 * **Why the type parameters.** `Workspace` and `WorkspaceEvent` live in
 * `@counted/tenancy-domain`, and a ports package that imported them would make
 * the storage contract depend on the aggregate's internals — which it does not
 * need. It needs to know an id goes in and a value comes out. Close the
 * parameters once, in `@counted/tenancy-app`:
 *
 *     import type { Workspace, WorkspaceEvent } from "@counted/tenancy-domain"
 *     import type { WorkspaceRepository as Repo } from "@counted/tenancy-ports"
 *     export type WorkspaceRepository = Repo<Workspace, WorkspaceEvent>
 */

import type { AccountId, DomainEvent, Role, WorkspaceId } from "@counted/kernel";

/**
 * One line of "where do I belong".
 *
 * Not a full `Workspace`. Hydrating each would load every member and every
 * project to render a list of names — and the role comes along because the
 * console needs both answers ("where may I go", "what may I do there") from
 * one round trip. Remembering "the current workspace" anywhere else would be a
 * fourth piece of state free to disagree with the other three.
 */
export type WorkspaceSummary = {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly role: Role;
};

export interface WorkspaceRepository<Workspace, WorkspaceEvent extends DomainEvent> {
  find(id: WorkspaceId): Promise<Workspace | null>;

  listForAccount(account: AccountId): Promise<readonly WorkspaceSummary[]>;

  save(workspace: Workspace, events: readonly WorkspaceEvent[]): Promise<void>;
}
