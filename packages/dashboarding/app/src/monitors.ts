/**
 * Monitor use cases.
 *
 * v2 could enable and disable an existing monitor and nothing else — no create,
 * no update, no delete reached the wire, so a monitor could only exist if
 * somebody wrote the row by hand. All four are here.
 *
 * This is also where "the analysis must produce a single number" is enforced.
 * The rule belongs to analytics, not to dashboarding: answering it means
 * reading the Analysis IR, which this context holds as an opaque `A`. It
 * arrives as `deps.isScalar` and returns the `AnalysisMustBeScalar` /
 * `InvalidAnalysis` kinds `@counted/dashboarding-domain` declares for it.
 */

import { err, isErr, MonitorId, ok } from "@counted/kernel";
import type { Duration, Instant, ProjectId, Result, WorkspaceId } from "@counted/kernel";
import { Monitor } from "@counted/dashboarding-domain";
import type { Channel, MonitorDecision, MonitorError, MonitorEvent, Threshold } from "@counted/dashboarding-domain";
import type { MonitorDeps } from "./ports";

type Outcome<A> = Promise<Result<Monitor<A>, MonitorError>>;

const load = async <A>(
  deps: MonitorDeps<A>,
  id: MonitorId,
): Promise<Result<Monitor<A>, MonitorError>> => {
  const found = await deps.monitors.find(id);
  return found === null ? err({ kind: "NoSuchMonitor", monitor: id }) : ok(found);
};

const commit = async <A>(
  deps: MonitorDeps<A>,
  applied: Result<{ monitor: Monitor<A>; events: readonly MonitorEvent[] }, MonitorError>,
): Promise<Result<Monitor<A>, MonitorError>> => {
  if (isErr(applied)) return applied;
  await deps.monitors.save(applied.value.monitor, applied.value.events);
  return ok(applied.value.monitor);
};

export type CreateMonitorInput<A> = {
  readonly workspace: WorkspaceId;
  readonly project: ProjectId;
  readonly name: string;
  readonly analysis: A;
  readonly threshold: Threshold;
  readonly cooldown?: Duration;
  readonly channels?: readonly Channel[];
};

export const createMonitor = async <A>(
  deps: MonitorDeps<A>,
  input: CreateMonitorInput<A>,
): Outcome<A> => {
  const shaped = deps.isScalar(input.analysis);
  if (isErr(shaped)) return shaped;

  const created = Monitor.create<A>(
    MonitorId(deps.ids.next()),
    input.workspace,
    input.project,
    input.name,
    input.analysis,
    input.threshold,
    deps.clock.now(),
    {
      ...(input.cooldown === undefined ? {} : { cooldown: input.cooldown }),
      ...(input.channels === undefined ? {} : { channels: input.channels }),
    },
  );
  return commit(deps, created);
};

export const getMonitor = <A>(deps: MonitorDeps<A>, monitor: MonitorId): Outcome<A> =>
  load(deps, monitor);

export const listMonitorsForProject = <A>(
  deps: MonitorDeps<A>,
  project: ProjectId,
): Promise<readonly Monitor<A>[]> => deps.monitors.listForProject(project);

export const listMonitorsForWorkspace = <A>(
  deps: MonitorDeps<A>,
  workspace: WorkspaceId,
): Promise<readonly Monitor<A>[]> => deps.monitors.listForWorkspace(workspace);

/**
 * One update surface, three domain commands.
 *
 * They are separate in the domain because they mean different things to breach
 * state: changing what is measured resets it, changing how it is announced does
 * not. Collapsing them into one `UPDATE … SET` — which is what v1 did to alerts
 * — is how muting a channel makes a monitor re-announce a breach it already
 * reported.
 *
 * Renaming to the same name is refused rather than committed as a no-op: an
 * event nobody caused is worse than an error somebody can read. An update that
 * names no field at all writes nothing and reports the monitor unchanged —
 * there is no state to disagree about, so there is nothing to refuse.
 */
export type UpdateMonitorInput<A> = {
  readonly monitor: MonitorId;
  readonly name?: string;
  readonly analysis?: A;
  readonly threshold?: Threshold;
  readonly cooldown?: Duration;
  readonly channels?: readonly Channel[];
};

export const updateMonitor = async <A>(
  deps: MonitorDeps<A>,
  input: UpdateMonitorInput<A>,
): Outcome<A> => {
  const found = await load(deps, input.monitor);
  if (isErr(found)) return found;

  const at = deps.clock.now();
  let current = found.value;
  const events: MonitorEvent[] = [];

  if (input.name !== undefined) {
    const renamed = current.rename(input.name, at);
    if (isErr(renamed)) return renamed;
    current = renamed.value.monitor;
    events.push(...renamed.value.events);
  }

  if (input.analysis !== undefined || input.threshold !== undefined) {
    const analysis = input.analysis ?? current.analysis;
    const shaped = deps.isScalar(analysis);
    if (isErr(shaped)) return shaped;

    const retargeted = current.retarget(analysis, input.threshold ?? current.threshold, at);
    if (isErr(retargeted)) return retargeted;
    current = retargeted.value.monitor;
    events.push(...retargeted.value.events);
  }

  if (input.cooldown !== undefined || input.channels !== undefined) {
    const reconfigured = current.reconfigure(
      {
        ...(input.cooldown === undefined ? {} : { cooldown: input.cooldown }),
        ...(input.channels === undefined ? {} : { channels: input.channels }),
      },
      at,
    );
    if (isErr(reconfigured)) return reconfigured;
    current = reconfigured.value.monitor;
    events.push(...reconfigured.value.events);
  }

  if (events.length === 0) return ok(current);

  await deps.monitors.save(current, events);
  return ok(current);
};

export const enableMonitor = async <A>(deps: MonitorDeps<A>, monitor: MonitorId): Outcome<A> => {
  const found = await load(deps, monitor);
  if (isErr(found)) return found;
  return commit(deps, found.value.enable(deps.clock.now()));
};

export const disableMonitor = async <A>(deps: MonitorDeps<A>, monitor: MonitorId): Outcome<A> => {
  const found = await load(deps, monitor);
  if (isErr(found)) return found;
  return commit(deps, found.value.disable(deps.clock.now()));
};

export const deleteMonitor = async <A>(
  deps: MonitorDeps<A>,
  monitor: MonitorId,
): Promise<Result<void, MonitorError>> => {
  const found = await load(deps, monitor);
  if (isErr(found)) return found;
  await deps.monitors.delete(monitor);
  return ok(undefined);
};

export type Evaluation<A> = {
  readonly monitor: Monitor<A>;
  readonly decision: MonitorDecision;
  readonly events: readonly MonitorEvent[];
};

/**
 * One evaluation tick: decide, record, persist. `apps/worker` runs the query
 * that produced `observed` and delivers whatever the emitted events say to
 * deliver.
 *
 * Deciding and applying are two calls because the worker must be able to ask
 * "what would happen?" without it happening — and because the notification is
 * sent from the event, after the transaction, so a delivery can never describe
 * a write that rolled back.
 */
export const evaluateMonitor = async <A>(
  deps: MonitorDeps<A>,
  input: { readonly monitor: Monitor<A>; readonly observed: number; readonly at?: Instant },
): Promise<Evaluation<A>> => {
  const now = input.at ?? deps.clock.now();
  const decision = input.monitor.decide(input.observed, now);
  const applied = input.monitor.apply(decision, now);
  await deps.monitors.save(applied.monitor, applied.events);
  return { monitor: applied.monitor, decision, events: applied.events };
};

/** The worker's batch: everything enabled, in slices it can finish. */
export const dueMonitors = <A>(
  deps: MonitorDeps<A>,
  limit: number,
): Promise<readonly Monitor<A>[]> => deps.monitors.listEnabled(limit);
