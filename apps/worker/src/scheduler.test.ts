import { describe, expect, test } from "bun:test";

import { Duration, Instant } from "@counted/kernel";

import { recordingLogger } from "./logging";
import { scheduler, type Job } from "./scheduler";
import { movableClock, T0 } from "./testing";

const later = (seconds: number): Instant => Instant.plus(T0, Duration.seconds(seconds));

describe("the schedule", () => {
  test("a job runs on its first tick and not again until its interval has passed", async () => {
    const clock = movableClock();
    let runs = 0;
    const job: Job = {
      name: "counter",
      every: Duration.seconds(60),
      run: async () => {
        runs += 1;
        return {};
      },
    };
    const sched = scheduler({ jobs: [job], clock, logger: recordingLogger() });

    await sched.tick(T0);
    expect(runs).toBe(1);

    clock.set(later(30));
    await sched.tick(later(30));
    expect(runs).toBe(1);

    clock.set(later(60));
    await sched.tick(later(60));
    expect(runs).toBe(2);
  });

  /**
   * The property that makes this file worth having. Two monitor sweeps running
   * at once evaluate the same monitors against the same window and send the
   * notification twice — and the cooldown does not save it, because both read
   * the pre-update state. `setInterval` gives exactly this the first time a
   * sweep outlives its interval, and gives it silently.
   */
  test("a job still running is skipped, not started a second time", async () => {
    const clock = movableClock();
    let started = 0;
    let release: () => void = () => undefined;
    const job: Job = {
      name: "slow",
      every: Duration.seconds(1),
      run: async () => {
        started += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {};
      },
    };
    const logger = recordingLogger();
    const sched = scheduler({ jobs: [job], clock, logger });

    const first = sched.tick(T0);
    await Promise.resolve();

    clock.set(later(10));
    const second = await sched.tick(later(10));

    expect(started).toBe(1);
    expect(second.started).toEqual([]);
    expect(second.skipped).toEqual(["slow"]);
    expect(logger.lines.some((l) => l.event === "job.overrun")).toBe(true);

    release();
    await first;
    expect(started).toBe(1);
  });

  test("a job that throws is reported and the others still run", async () => {
    const clock = movableClock();
    let healthy = 0;
    const logger = recordingLogger();
    const sched = scheduler({
      jobs: [
        {
          name: "broken",
          every: Duration.seconds(1),
          run: async () => {
            throw new Error("the database went away");
          },
        },
        {
          name: "healthy",
          every: Duration.seconds(1),
          run: async () => {
            healthy += 1;
            return {};
          },
        },
      ],
      clock,
      logger,
    });

    await sched.tick(T0);
    expect(healthy).toBe(1);

    const failure = logger.lines.find((l) => l.event === "job.failed");
    expect(failure?.fields["job"]).toBe("broken");
    expect(failure?.fields["detail"]).toBe("the database went away");

    // And the schedule survives it: the next interval runs both again.
    clock.set(later(5));
    await sched.tick(later(5));
    expect(healthy).toBe(2);
  });

  test("the next run is due after the last one finished, so lateness does not queue up", async () => {
    const clock = movableClock();
    let runs = 0;
    const sched = scheduler({
      jobs: [
        {
          name: "slow",
          every: Duration.seconds(10),
          run: async () => {
            runs += 1;
            // Finishes at T0+40 by the clock, so T0+45 is only 5s later.
            clock.set(later(40));
            return {};
          },
        },
      ],
      clock,
      logger: recordingLogger(),
    });

    await sched.tick(T0);
    expect(runs).toBe(1);

    await sched.tick(later(45));
    expect(runs).toBe(1);

    await sched.tick(later(50));
    expect(runs).toBe(2);
  });

  test("stop waits for what is in flight", async () => {
    const clock = movableClock();
    let finished = false;
    let release: () => void = () => undefined;
    const sched = scheduler({
      jobs: [
        {
          name: "slow",
          every: Duration.seconds(1),
          run: async () => {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            finished = true;
            return {};
          },
        },
      ],
      clock,
      logger: recordingLogger(),
    });

    const tick = sched.tick(T0);
    await Promise.resolve();
    const stopping = sched.stop();

    release();
    await Promise.all([tick, stopping]);
    expect(finished).toBe(true);
    expect(sched.running).toBe(false);
  });

  test("runNow ignores the interval and reports what the job returned", async () => {
    const clock = movableClock();
    const sched = scheduler({
      jobs: [{ name: "probe", every: Duration.days(1), run: async () => ({ findings: 3 }) }],
      clock,
      logger: recordingLogger(),
    });

    expect(await sched.runNow("probe", T0)).toEqual({ findings: 3 });
    expect(await sched.runNow("probe", T0)).toEqual({ findings: 3 });
    expect(await sched.runNow("no-such-job", T0)).toBeNull();
  });
});
