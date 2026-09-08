/**
 * What a MonitorRepository over Postgres has to get right.
 *
 * Every assertion here about a column's *type* is a v1 defect: the threshold was
 * text recovered with `parseFloat` (so an unparseable value compared as NaN and
 * the monitor silently never fired), the window was a string matched by
 * `/^(\d+)(h|d)$/` (so `"1w"` fell through to one hour), and the metric was free
 * text with a three-shape compiler of its own.
 */

import { afterAll, beforeEach, expect, test } from "bun:test";
import { Duration, MonitorId, ProjectId, WorkspaceId } from "@counted/kernel";
import { Monitor, Threshold, type Channel } from "@counted/dashboarding-domain";
import {
  T0,
  at,
  givenProject,
  givenWorkspace,
  liveHarness,
  must,
  type Harness,
  type TestAnalysis,
} from "./fixtures";
import { closeDatabase, describeLive } from "./testing";

const CHANNELS: readonly Channel[] = [
  { kind: "email", address: "ops@example.com" },
  { kind: "webhook", url: "https://example.com/hook" },
];

describeLive("PostgresMonitorRepository", () => {
  let h: Harness;
  let workspace: WorkspaceId;
  let project: ProjectId;

  beforeEach(async () => {
    h = await liveHarness();
    await h.reset();
    workspace = await givenWorkspace(h.repositories);
    project = await givenProject(h.repositories, workspace);
  });
  afterAll(closeDatabase);

  const monitor = async (
    id: string,
    name: string,
    threshold = Threshold.above(100),
  ): Promise<Monitor<TestAnalysis>> => {
    const created = must(
      Monitor.create<TestAnalysis>(
        MonitorId(id),
        workspace,
        project,
        name,
        { metric: "errors", window: 24 },
        threshold,
        T0,
        { cooldown: Duration.minutes(15), channels: CHANNELS },
      ),
    );
    await h.repositories.monitors.save(created.monitor, created.events);
    return created.monitor;
  };

  test("a monitor round-trips as numbers, not as strings to be reparsed", async () => {
    await monitor("mon_1", "Error rate", Threshold.below(0.5));
    const loaded = await h.repositories.monitors.find(MonitorId("mon_1"));
    const s = loaded!.snapshot();

    expect(s.threshold).toEqual(Threshold.below(0.5));
    expect(Duration.toMillis(s.cooldown)).toBe(Duration.toMillis(Duration.minutes(15)));
    expect(s.channels).toEqual(CHANNELS);
    expect(s.analysis).toEqual({ metric: "errors", window: 24 });
    expect(s.enabled).toBe(true);
    expect(s.state).toBe("ok");
    expect(s.lastNotifiedAt).toBeNull();
  });

  test("firing state survives the round trip, so a restart does not re-alert", async () => {
    // The cooldown is meaningless if `state` and `lastNotifiedAt` are not
    // durable: every worker restart would re-enter breach and notify again.
    const created = await monitor("mon_1", "Error rate");
    const fired = created.apply(created.decide(500, at(1)), at(1));
    await h.repositories.monitors.save(fired.monitor, fired.events);

    const loaded = await h.repositories.monitors.find(MonitorId("mon_1"));
    expect(loaded?.snapshot().state).toBe("breaching");
    expect(loaded?.snapshot().lastNotifiedAt).toEqual(at(1));
    expect(loaded?.snapshot().lastValue).toBe(500);
    expect(loaded?.decide(500, at(2))).toEqual({
      kind: "silent",
      reason: "cooling-down",
      observed: 500,
    });
  });

  test("listEnabled skips disabled monitors and takes the longest-waiting first", async () => {
    // With `limit` below the number of enabled monitors, a fixed order starves
    // whatever is at the back. Never-notified sorts ahead of notified-an-hour-ago.
    const recent = await monitor("mon_recent", "Recent");
    await monitor("mon_never", "Never");
    const off = await monitor("mon_off", "Off");

    const fired = recent.apply(recent.decide(500, at(10)), at(10));
    await h.repositories.monitors.save(fired.monitor, fired.events);
    const disabled = must(off.disable(T0));
    await h.repositories.monitors.save(disabled.monitor, disabled.events);

    const due = await h.repositories.monitors.listEnabled(10);
    expect(due.map((m) => m.snapshot().id)).toEqual([MonitorId("mon_never"), MonitorId("mon_recent")]);
    expect((await h.repositories.monitors.listEnabled(1)).map((m) => m.snapshot().id)).toEqual([
      MonitorId("mon_never"),
    ]);
  });

  test("listing is scoped by project and by workspace", async () => {
    const other = await givenProject(h.repositories, workspace, "prj_other", "Other");
    await monitor("mon_1", "One");
    const second = must(
      Monitor.create<TestAnalysis>(
        MonitorId("mon_2"),
        workspace,
        other,
        "Two",
        { metric: "errors" },
        Threshold.above(1),
        T0,
      ),
    );
    await h.repositories.monitors.save(second.monitor, second.events);

    expect((await h.repositories.monitors.listForProject(project)).map((m) => m.snapshot().id)).toEqual([
      MonitorId("mon_1"),
    ]);
    expect(
      (await h.repositories.monitors.listForWorkspace(workspace)).map((m) => m.snapshot().id),
    ).toEqual([MonitorId("mon_1"), MonitorId("mon_2")]);
  });

  test("healthy and failed monitors both yield to monitors beyond one batch", async () => {
    await monitor("mon_a", "A");
    await monitor("mon_b", "B");
    await monitor("mon_c", "C");
    const seen: string[] = [];
    for (let tick = 0; tick < 3; tick += 1) {
      const due = await h.repositories.monitors.claimEnabled(1, at(tick));
      const one = due[0]!;
      seen.push(String(one.id));
      if (tick === 0) await h.repositories.monitors.save(one.measurementUnavailable("query unavailable", at(tick)), []);
      else {
        const checked = one.apply(one.decide(1, at(tick)), at(tick));
        await h.repositories.monitors.save(checked.monitor, checked.events);
      }
    }
    expect(seen).toEqual(["mon_a", "mon_b", "mon_c"]);
    const failed = await h.repositories.monitors.find(MonitorId("mon_a"));
    expect(failed?.lastAttemptAt).toEqual(T0);
    expect(failed?.lastMeasuredAt).toBeNull();
    expect(failed?.evaluationError).toBe("query unavailable");
  });

  test("concurrent workers claim different monitors and an abandoned lease expires", async () => {
    await monitor("mon_a", "A");
    await monitor("mon_b", "B");
    const claimed = await Promise.all([
      h.repositories.monitors.claimEnabled(1, T0), h.repositories.monitors.claimEnabled(1, T0),
    ]);
    expect(new Set(claimed.flat().map((one) => one.id)).size).toBe(2);
    expect(await h.repositories.monitors.claimEnabled(1, at(1))).toEqual([]);
    expect(await h.repositories.monitors.claimEnabled(1, at(11))).toHaveLength(1);
  });

  test("state and recipient jobs roll back together, then survive a new repository instance", async () => {
    const created = await monitor("mon_1", "Error rate");
    const fired = created.apply(created.decide(500, at(1)), at(1));
    await expect(h.unitOfWork.transact(async (repos) => {
      await repos.monitors.save(fired.monitor, fired.events);
      throw new Error("transaction aborted");
    })).rejects.toThrow("transaction aborted");
    expect((await h.repositories.monitors.find(created.id))?.state).toBe("ok");
    expect(await h.repositories.monitors.claimDeliveries(10, at(2))).toEqual([]);
    await h.repositories.monitors.save(fired.monitor, fired.events);
    const restarted = await liveHarness();
    const jobs = await restarted.repositories.monitors.claimDeliveries(10, at(2));
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((job) => job.alert.id)).size).toBe(2);
    expect((await restarted.repositories.monitors.find(created.id))?.pendingDeliveries).toBe(2);
  });

  test("a successful channel stays delivered while a failed channel retries the same id", async () => {
    const created = await monitor("mon_1", "Error rate");
    const fired = created.apply(created.decide(500, at(1)), at(1));
    await h.repositories.monitors.save(fired.monitor, fired.events);
    const jobs = await h.repositories.monitors.claimDeliveries(10, at(2));
    const email = jobs.find((job) => job.alert.channel.kind === "email")!;
    const hook = jobs.find((job) => job.alert.channel.kind === "webhook")!;
    await h.repositories.monitors.completeDelivery(email, at(2));
    await h.repositories.monitors.failDelivery(hook, "Webhook transport unavailable", at(2));
    const health = await h.repositories.monitors.find(created.id);
    expect(health?.pendingDeliveries).toBe(1);
    expect(health?.failedDeliveries).toBe(1);
    expect(health?.lastDeliveredAt).toEqual(at(2));
    expect(health?.deliveryError).toBe("Webhook transport unavailable");
    expect(await h.repositories.monitors.claimDeliveries(10, at(2))).toEqual([]);
    const retry = await h.repositories.monitors.claimDeliveries(10, at(3));
    expect(retry).toHaveLength(1);
    expect(retry[0]?.alert.id).toBe(hook.alert.id);
    expect(retry[0]?.attempts).toBe(2);
    await h.repositories.monitors.completeDelivery(retry[0]!, at(3));
    expect((await h.repositories.monitors.find(created.id))?.pendingDeliveries).toBe(0);
  });

  test("recovery waits behind its recipient's failed breach and survives a delivery crash", async () => {
    const created = await monitor("mon_1", "Error rate");
    const fired = created.apply(created.decide(500, at(1)), at(1));
    await h.repositories.monitors.save(fired.monitor, fired.events);
    const recovered = fired.monitor.apply(fired.monitor.decide(0, at(2)), at(2));
    await h.repositories.monitors.save(recovered.monitor, recovered.events);
    const first = await h.repositories.monitors.claimDeliveries(10, at(3));
    expect(first).toHaveLength(2);
    expect(first.every((job) => job.alert.state === "breaching")).toBe(true);
    expect(await h.repositories.monitors.claimDeliveries(10, at(4))).toEqual([]);
    // A process died after claiming; leases make the same jobs available again.
    const restarted = await h.repositories.monitors.claimDeliveries(10, at(9));
    expect(restarted.map((job) => job.alert.id).sort()).toEqual(first.map((job) => job.alert.id).sort());
    for (const job of restarted) await h.repositories.monitors.completeDelivery(job, at(9));
    const recovery = await h.repositories.monitors.claimDeliveries(10, at(10));
    expect(recovery).toHaveLength(2);
    expect(recovery.every((job) => job.alert.state === "ok")).toBe(true);
    for (const job of recovery) await h.repositories.monitors.failDelivery(job, "provider refused", at(10));
    const retried = await h.repositories.monitors.claimDeliveries(10, at(11));
    expect(retried.map((job) => job.alert.id).sort()).toEqual(recovery.map((job) => job.alert.id).sort());
  });

  test("editing or deleting a claimed monitor fences a stale evaluation", async () => {
    const created = await monitor("mon_1", "Error rate");
    const claimed = (await h.repositories.monitors.claimEnabled(1, at(1)))[0]!;
    const edit = must(created.retarget({ metric: "page_view" }, Threshold.above(900), at(2)));
    await h.repositories.monitors.save(edit.monitor, edit.events);
    const stale = claimed.apply(claimed.decide(500, at(3)), at(3));
    await h.repositories.monitors.save(stale.monitor, stale.events);
    expect((await h.repositories.monitors.find(created.id))?.analysis).toEqual({ metric: "page_view" });
    expect(await h.repositories.monitors.claimDeliveries(10, at(4))).toEqual([]);
    const again = (await h.repositories.monitors.claimEnabled(1, at(5)))[0]!;
    await h.repositories.monitors.delete(created.id);
    const afterDelete = again.apply(again.decide(1000, at(6)), at(6));
    await h.repositories.monitors.save(afterDelete.monitor, afterDelete.events);
    expect(await h.repositories.monitors.find(created.id)).toBeNull();
  });

  test("muting a monitor cancels queued retries", async () => {
    const created = await monitor("mon_1", "Error rate");
    const fired = created.apply(created.decide(500, at(1)), at(1));
    await h.repositories.monitors.save(fired.monitor, fired.events);
    const muted = must(fired.monitor.reconfigure({ channels: [] }, at(2)));
    await h.repositories.monitors.save(muted.monitor, muted.events);
    expect(await h.repositories.monitors.claimDeliveries(10, at(3))).toEqual([]);
    expect((await h.repositories.monitors.find(created.id))?.pendingDeliveries).toBe(0);
  });

  test("changing cooldown retains pending alerts and removing one channel cancels only that recipient", async () => {
    const created = await monitor("mon_1", "Error rate");
    const fired = created.apply(created.decide(500, at(1)), at(1));
    await h.repositories.monitors.save(fired.monitor, fired.events);
    const quiet = must(fired.monitor.reconfigure({ cooldown: Duration.hours(2) }, at(2)));
    await h.repositories.monitors.save(quiet.monitor, quiet.events);
    expect((await h.repositories.monitors.find(created.id))?.pendingDeliveries).toBe(2);
    const oneChannel = must(quiet.monitor.reconfigure({ channels: [CHANNELS[0]!] }, at(3)));
    await h.repositories.monitors.save(oneChannel.monitor, oneChannel.events);
    const remaining = await h.repositories.monitors.claimDeliveries(10, at(4));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.alert.channel.kind).toBe("email");
  });

  test("deleting the project deletes its monitors", async () => {
    await monitor("mon_1", "One");
    await h.repositories.projects.delete(project);
    expect(await h.repositories.monitors.find(MonitorId("mon_1"))).toBeNull();
  });

  test("a channel that lost its address is refused rather than silently dropped", async () => {
    // A monitor whose webhook url decoded to undefined would fire, fail to
    // deliver, and record itself as having fired.
    await monitor("mon_1", "One");
    await h.pool.query(
      `UPDATE monitors SET channels = '[{"kind":"webhook"}]'::jsonb WHERE id = 'mon_1'`,
    );
    expect(h.repositories.monitors.find(MonitorId("mon_1"))).rejects.toThrow(/monitors\.channels/);
  });

  test("a negative cooldown cannot be stored, whatever writes the row", async () => {
    await monitor("mon_1", "One");
    expect(h.pool.query(`UPDATE monitors SET cooldown_ms = -1 WHERE id = 'mon_1'`)).rejects.toThrow(
      /monitors_cooldown_is_not_negative/,
    );
  });
});
