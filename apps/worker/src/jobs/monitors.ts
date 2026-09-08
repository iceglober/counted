/**
 * The monitor sweep: ask each enabled monitor's question, decide, record,
 * enqueue, then deliver durable recipient jobs.
 *
 * Four properties this is responsible for, each of which is a way v1 got it
 * wrong.
 *
 * **A monitor that cannot be measured is not evaluated.** `Observation` has one
 * case that carries a number and two that do not, and only the first reaches
 * `evaluateMonitor`. Reading a failed query as zero fires every `below`
 * threshold in the account at once.
 *
 * **The write happens before the announcement.** `evaluateMonitor` saves the
 * new breach state and returns the events; the notification is built from those
 * events afterwards. A delivery that went first could describe a state change
 * that then failed to persist, and the next sweep would announce it again.
 *
 * **One monitor's failure does not end the sweep.** Every per-monitor step is
 * caught: an unreadable analysis row, a repository error, a mail provider
 * refusing. The sweep reports the counts and moves on, because two hundred
 * healthy monitors should not go unevaluated because of one bad row.
 *
 * **A delivery failure stays queued.** Every recipient has an independent
 * durable job and lease. A restart retries the same id; recovery notices wait
 * behind earlier notices to that recipient so they cannot arrive out of order.
 */

import { evaluateMonitor, type MonitorDeps } from "@counted/dashboarding-app";
import { Threshold, alertsFor, type MonitorAlert, type Monitor, type MonitorEvent } from "@counted/dashboarding-domain";
import { assertNever, Instant, unbrand, type MonitorId } from "@counted/kernel";
import type { Notification, Notifier } from "@counted/kernel/ports";

import { describeError } from "../logging";
import type { Logger } from "../ports";
import type { Observation, ScalarObserver } from "../observe";

export type MonitorSweepDeps<A> = {
  readonly monitors: MonitorDeps<A>;
  readonly observe: ScalarObserver<A>;
  readonly notifier: Notifier;
  readonly logger: Logger;
  /** How many monitors one sweep will take on. The rest wait for the next tick. */
  readonly batch: number;
};

export type MonitorSweepReport = {
  readonly considered: number;
  readonly evaluated: number;
  readonly fired: number;
  readonly recovered: number;
  readonly silent: number;
  /** Asked, and the engine could not answer. Distinct from a monitor that failed to run at all. */
  readonly unobservable: number;
  readonly notified: number;
  readonly notifyFailures: number;
  readonly errors: number;
};

/**
 * What a firing monitor says, per channel.
 *
 * Built from the aggregate *and* the event rather than from either alone: the
 * event carries what happened (the observed value, the threshold it crossed,
 * whether this is a fresh breach or a repeat past the cooldown) and the
 * aggregate carries who to tell and what it is called. Neither is derivable
 * from the other.
 *
 * The webhook `id` is deterministic — monitor, kind, and the instant the state
 * changed — because delivery is at least once and the receiver's only defence
 * is deduplication. A random id per attempt would make every redelivery look
 * like a new breach.
 */
export const notificationForAlert = (alert: MonitorAlert): Notification => {
  const firing = alert.state === "breaching";
  const subject = firing ? `${alert.name} is ${Threshold.describe(alert.threshold)}` : `${alert.name} has recovered`;
  const body = firing
    ? `${alert.name} observed ${alert.observed}, which is ${Threshold.describe(alert.threshold)}.\n\n${alert.entering ? "This is a new breach." : "It is still out of range; this is a repeat notice after the cooldown."}`
    : `${alert.name} observed ${alert.observed}, which is back within ${Threshold.describe(alert.threshold)}.`;
  if (alert.channel.kind === "email") return { channel: "email", to: alert.channel.address, subject, body, id: alert.id };
  const { channel, ...payload } = alert;
  return { channel: "webhook", url: channel.url, id: alert.id, payload };
};

export const notificationsFor = <A>(monitor: Monitor<A>, event: MonitorEvent): readonly Notification[] =>
  alertsFor(monitor, event).map(notificationForAlert);

/** Durable, ordered per-recipient delivery. A failed channel never re-sends a successful sibling. */
export const deliverMonitorAlerts = async <A>(deps: MonitorSweepDeps<A>, now: Instant): Promise<{ notified: number; notifyFailures: number }> => {

  let notified = 0;
  let notifyFailures = 0;
  for (let index = 0; index < deps.batch; index += 1) {
    const attemptAt = Instant.max(now, deps.monitors.clock.now());
    const delivery = (await deps.monitors.monitors.claimDeliveries(1, attemptAt))[0];
    if (delivery === undefined) break;
    try {
      await deps.notifier.deliver(notificationForAlert(delivery.alert));
      await deps.monitors.monitors.completeDelivery(delivery, Instant.max(attemptAt, deps.monitors.clock.now()));
      notified += 1;
    } catch (cause) {
      notifyFailures += 1;
      const detail = describeError(cause);
      await deps.monitors.monitors.failDelivery(delivery, detail, Instant.max(attemptAt, deps.monitors.clock.now()));
      deps.logger.error("monitor.notify-failed", { monitor: delivery.alert.monitor,
        delivery: delivery.alert.id, channel: delivery.alert.channel.kind, attempts: delivery.attempts, detail });
    }
  }
  return { notified, notifyFailures };
};

const empty: MonitorSweepReport = {
  considered: 0,
  evaluated: 0,
  fired: 0,
  recovered: 0,
  silent: 0,
  unobservable: 0,
  notified: 0,
  notifyFailures: 0,
  errors: 0,
};

/** Log the reason once, at the level its retriability deserves. */
const reportUnobservable = <A>(
  deps: MonitorSweepDeps<A>,
  monitor: Monitor<A>,
  observation: Extract<Observation, { kind: "unobservable" }>,
): void => {
  const fields = {
    monitor: unbrand(monitor.id),
    project: unbrand(monitor.project),
    detail: observation.detail,
    retriable: observation.retriable,
  };
  // A retriable failure is noise at error level — the engine was busy and the
  // next tick will ask again. A permanent one needs somebody to edit the
  // monitor, and will otherwise never fire again without saying why.
  if (observation.retriable) deps.logger.warn("monitor.unobservable", fields);
  else deps.logger.error("monitor.unobservable", fields);
};

export const sweepMonitors = async <A>(
  deps: MonitorSweepDeps<A>,
  now: Instant,
): Promise<MonitorSweepReport> => {
  let report: MonitorSweepReport = { ...empty };
  const attempted: MonitorId[] = [];
  for (let index = 0; index < deps.batch; index += 1) {
    const attemptAt = Instant.max(now, deps.monitors.clock.now());
    const monitor = (await deps.monitors.monitors.claimEnabled(1, attemptAt, attempted))[0];
    if (monitor === undefined) break;
    attempted.push(monitor.id);
    report = { ...report, considered: report.considered + 1 };
    try {
      const observation = await deps.observe(monitor, attemptAt);

      if (observation.kind === "unobservable") {
        await deps.monitors.monitors.save(monitor.measurementUnavailable(observation.detail, attemptAt), []);
        reportUnobservable(deps, monitor, observation);
        report = { ...report, unobservable: report.unobservable + 1 };
        continue;
      }
      if (observation.kind === "no-data") {
        await deps.monitors.monitors.save(monitor.measurementUnavailable("No data in the observation window.", attemptAt), []);
        deps.logger.info("monitor.no-data", { monitor: unbrand(monitor.id) });
        continue;
      }

      const evaluation = await evaluateMonitor(deps.monitors, {
        monitor,
        observed: observation.value,
        at: attemptAt,
      });
      report = { ...report, evaluated: report.evaluated + 1 };

      switch (evaluation.decision.kind) {
        case "fire":
          report = { ...report, fired: report.fired + 1 };
          break;
        case "recover":
          report = { ...report, recovered: report.recovered + 1 };
          break;
        case "silent":
          report = { ...report, silent: report.silent + 1 };
          break;
        default:
          assertNever(evaluation.decision);
      }


    } catch (cause) {
      try {
        await deps.monitors.monitors.save(monitor.measurementUnavailable(describeError(cause), attemptAt), []);
      } catch (saveCause) {
        deps.logger.error("monitor.health-save-failed", { monitor: unbrand(monitor.id), detail: describeError(saveCause) });
      }
      report = { ...report, errors: report.errors + 1 };
      deps.logger.error("monitor.evaluation-failed", {
        monitor: unbrand(monitor.id),
        detail: describeError(cause),
      });
    }
  }

  return { ...report, ...await deliverMonitorAlerts(deps, now) };
};
