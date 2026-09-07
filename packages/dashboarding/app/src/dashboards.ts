/**
 * Dashboard use cases — the half v2 was missing.
 *
 * v2's `Dashboard` aggregate had `addTile` implemented, tested and unreachable:
 * no route ever called it, so every dashboard a customer created stayed
 * permanently empty. The domain was never the problem. These are the functions
 * that make each command reachable, and `@counted/contract` gives each one a
 * procedure.
 *
 * Every use case assumes it is already inside a transaction. `UnitOfWork` is
 * generic in the repository bundle because the composition root chooses which
 * contexts are deployed together, so `transact` is wrapped there, not here. A
 * `Result` returned from one of these is a *successful* transaction reporting a
 * refused rule — it commits (V3-SPEC §5). If a refusal must roll back, the
 * caller throws.
 *
 * Authorization is not here either. It is decided in `apps/*` before the use
 * case runs; a use case that re-checked would be a second policy, and two
 * policies disagree eventually.
 */

import { DashboardId, err, Instant, isErr, ok, TileId } from "@counted/kernel";
import type { Duration, ProjectId, Result, WorkspaceId } from "@counted/kernel";
import { Dashboard, ShareGrant, Tile } from "@counted/dashboarding-domain";
import type { DashboardError, DashboardEvent, TileView, TileWidth } from "@counted/dashboarding-domain";
import type { DashboardSummary } from "@counted/dashboarding-ports";
import type { DashboardDeps } from "./ports";

type Outcome<A> = Promise<Result<Dashboard<A>, DashboardError>>;

/** Load or say precisely which id was not found. */
const load = async <A>(
  deps: DashboardDeps<A>,
  id: DashboardId,
): Promise<Result<Dashboard<A>, DashboardError>> => {
  const found = await deps.dashboards.find(id);
  return found === null ? err({ kind: "NoSuchDashboard", dashboard: id }) : ok(found);
};

/**
 * Run a command against a loaded dashboard and persist the aggregate with the
 * events it produced. `save` takes both because the adapter writes the rows and
 * the outbox entries in one transaction — that pairing is the reason a domain
 * event can never be published for a write that rolled back.
 */
const commit = async <A>(
  deps: DashboardDeps<A>,
  applied: Result<{ dashboard: Dashboard<A>; events: readonly DashboardEvent[] }, DashboardError>,
): Promise<Result<Dashboard<A>, DashboardError>> => {
  if (isErr(applied)) return applied;
  await deps.dashboards.save(applied.value.dashboard, applied.value.events);
  return ok(applied.value.dashboard);
};

// ── the dashboard ──────────────────────────────────────────────────────────

export type CreateDashboardInput = {
  readonly workspace: WorkspaceId;
  readonly name: string;
  readonly makeDefault?: boolean;
};

export const createDashboard = async <A>(
  deps: DashboardDeps<A>,
  input: CreateDashboardInput,
): Outcome<A> => {
  const at = deps.clock.now();

  const created = Dashboard.create<A>(
    DashboardId(deps.ids.next()),
    input.workspace,
    input.name,
    at,
    input.makeDefault === true,
  );
  if (isErr(created)) return created;

  // Clearing the previous default first keeps the invariant true at every point
  // a reader could observe it, rather than only after both writes land.
  if (input.makeDefault === true) {
    const cleared = await clearExistingDefault(deps, input.workspace);
    if (isErr(cleared)) return cleared;
  }

  await deps.dashboards.save(created.value.dashboard, created.value.events);
  return ok(created.value.dashboard);
};

export const getDashboard = <A>(deps: DashboardDeps<A>, dashboard: DashboardId): Outcome<A> =>
  load(deps, dashboard);

export const listDashboards = <A>(
  deps: DashboardDeps<A>,
  workspace: WorkspaceId,
): Promise<readonly DashboardSummary[]> => deps.dashboards.listForWorkspace(workspace);

export const renameDashboard = async <A>(
  deps: DashboardDeps<A>,
  input: { readonly dashboard: DashboardId; readonly name: string },
): Outcome<A> => {
  const found = await load(deps, input.dashboard);
  if (isErr(found)) return found;
  return commit(deps, found.value.rename(input.name, deps.clock.now()));
};

/**
 * Deleting emits nothing. `DashboardRepository.delete` takes an id and no
 * events, so there is no `DashboardDeleted` for the outbox to carry — a
 * subscriber that wants to know a dashboard went away currently cannot be told.
 * Flagged rather than worked around, because widening the port is a decision
 * that affects the adapter and the worker too.
 */
export const deleteDashboard = async <A>(
  deps: DashboardDeps<A>,
  dashboard: DashboardId,
): Promise<Result<void, DashboardError>> => {
  const found = await load(deps, dashboard);
  if (isErr(found)) return found;
  await deps.dashboards.delete(dashboard);
  return ok(undefined);
};

/**
 * At most one default per workspace, enforced across aggregates because that is
 * where it is knowable. v1 stated it as a partial unique index scoped to a user
 * while the loader resolved the default scoped to a project — so two rows could
 * both claim it and which one opened depended on which query ran.
 */
export const setDefaultDashboard = async <A>(
  deps: DashboardDeps<A>,
  dashboard: DashboardId,
): Outcome<A> => {
  const found = await load(deps, dashboard);
  if (isErr(found)) return found;
  if (found.value.isDefault) return err({ kind: "DefaultUnchanged" });

  const cleared = await clearExistingDefault(deps, found.value.workspace);
  if (isErr(cleared)) return cleared;

  return commit(deps, found.value.markDefault(deps.clock.now()));
};

const clearExistingDefault = async <A>(
  deps: DashboardDeps<A>,
  workspace: WorkspaceId,
): Promise<Result<void, DashboardError>> => {
  const current = await deps.dashboards.findDefault(workspace);
  if (current === null) return ok(undefined);
  const cleared = current.clearDefault(deps.clock.now());
  if (isErr(cleared)) return cleared;
  await deps.dashboards.save(cleared.value.dashboard, cleared.value.events);
  return ok(undefined);
};

// ── tiles ──────────────────────────────────────────────────────────────────

export type AddTileInput<A> = {
  readonly dashboard: DashboardId;
  readonly title: string;
  readonly project: ProjectId;
  readonly analysis: A;
  readonly view: TileView;
  readonly width: TileWidth;
};

export const addTile = async <A>(deps: DashboardDeps<A>, input: AddTileInput<A>): Outcome<A> => {
  const found = await load(deps, input.dashboard);
  if (isErr(found)) return found;

  const tile = Tile.of<A>(
    TileId(deps.ids.next()),
    input.title,
    input.project,
    input.analysis,
    input.view,
    input.width,
  );
  return commit(deps, found.value.addTile(tile, deps.clock.now()));
};

/**
 * A patch, not a replacement. The console edits a card on one form, and sending
 * the whole tile back would make a client that is one deploy behind silently
 * revert whatever field it did not know about.
 */
export type UpdateTileInput<A> = {
  readonly dashboard: DashboardId;
  readonly tile: TileId;
  readonly title?: string;
  readonly project?: ProjectId;
  readonly analysis?: A;
  readonly view?: TileView;
  readonly width?: TileWidth;
};

export const updateTile = async <A>(deps: DashboardDeps<A>, input: UpdateTileInput<A>): Outcome<A> => {
  const found = await load(deps, input.dashboard);
  if (isErr(found)) return found;

  const existing = found.value.tile(input.tile);
  if (existing === undefined) return err({ kind: "NoSuchTile", tile: input.tile });

  const next: Tile<A> = {
    ...existing,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.project === undefined ? {} : { project: input.project }),
    ...(input.analysis === undefined ? {} : { analysis: input.analysis }),
    ...(input.view === undefined ? {} : { view: input.view }),
    ...(input.width === undefined ? {} : { width: input.width }),
  };

  return commit(deps, found.value.updateTile(next, deps.clock.now()));
};

export const resizeTile = async <A>(
  deps: DashboardDeps<A>,
  input: { readonly dashboard: DashboardId; readonly tile: TileId; readonly width: TileWidth },
): Outcome<A> => {
  const found = await load(deps, input.dashboard);
  if (isErr(found)) return found;
  return commit(deps, found.value.resizeTile(input.tile, input.width, deps.clock.now()));
};

export const moveTile = async <A>(
  deps: DashboardDeps<A>,
  input: { readonly dashboard: DashboardId; readonly tile: TileId; readonly position: number },
): Outcome<A> => {
  const found = await load(deps, input.dashboard);
  if (isErr(found)) return found;
  return commit(deps, found.value.moveTile(input.tile, input.position, deps.clock.now()));
};

export const reorderTiles = async <A>(
  deps: DashboardDeps<A>,
  input: { readonly dashboard: DashboardId; readonly order: readonly TileId[] },
): Outcome<A> => {
  const found = await load(deps, input.dashboard);
  if (isErr(found)) return found;
  return commit(deps, found.value.reorderTiles(input.order, deps.clock.now()));
};

export const removeTile = async <A>(
  deps: DashboardDeps<A>,
  input: { readonly dashboard: DashboardId; readonly tile: TileId },
): Outcome<A> => {
  const found = await load(deps, input.dashboard);
  if (isErr(found)) return found;
  return commit(deps, found.value.removeTile(input.tile, deps.clock.now()));
};

// ── sharing ────────────────────────────────────────────────────────────────

export type SharedDashboard<A> = {
  readonly dashboard: Dashboard<A>;
  /** Returned once, put in the URL, never stored. */
  readonly token: string;
};

export const shareDashboard = async <A>(
  deps: DashboardDeps<A>,
  input: { readonly dashboard: DashboardId; readonly ttl: Duration },
): Promise<Result<SharedDashboard<A>, DashboardError>> => {
  const found = await load(deps, input.dashboard);
  if (isErr(found)) return found;

  const at = deps.clock.now();
  const minted = await deps.shareTokens.mint();
  const grant = ShareGrant.of(input.dashboard, minted.digest, Instant.plus(at, input.ttl));

  const applied = found.value.grantShare(grant, at);
  if (isErr(applied)) return applied;

  await deps.dashboards.save(applied.value.dashboard, applied.value.events);
  return ok({ dashboard: applied.value.dashboard, token: minted.token });
};

export const unshareDashboard = async <A>(
  deps: DashboardDeps<A>,
  dashboard: DashboardId,
): Outcome<A> => {
  const found = await load(deps, dashboard);
  if (isErr(found)) return found;
  return commit(deps, found.value.unshare(deps.clock.now()));
};

/**
 * Turn a token off a share URL into the one dashboard it opens.
 *
 * Two checks, and both are needed. The digest lookup finds *a* dashboard; the
 * aggregate then re-checks that the grant it is holding names itself. A
 * repository that resolved a digest with a query missing its dashboard
 * constraint would otherwise hand back a sibling, and the caller would have no
 * way to notice. A share token is a view of one page, not a guest account.
 */
export const resolveShare = async <A>(
  deps: DashboardDeps<A>,
  token: string,
): Outcome<A> => {
  const digest = await deps.shareTokens.digest(token);
  const found = await deps.dashboards.findByShareDigest(digest);
  if (found === null) return err({ kind: "NotShared" });

  const allowed = found.authorizeShareRead(digest, deps.clock.now());
  if (isErr(allowed)) return allowed;
  return ok(found);
};

export const setDashboardLayout = async <A>(
  deps: DashboardDeps<A>,
  input: { readonly dashboard: DashboardId; readonly placements: readonly import("@counted/dashboarding-domain").TilePlacement[] },
): Outcome<A> => {
  const found = await load(deps, input.dashboard);
  if (isErr(found)) return found;
  return commit(deps, found.value.setLayout(input.placements, deps.clock.now()));
};
