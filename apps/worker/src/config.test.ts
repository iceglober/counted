import { describe, expect, test } from "bun:test";

import { Duration } from "@counted/kernel";

import { readConfig, type Env } from "./config";

const base: Env = { DATABASE_URL: "postgres://localhost/counted" };

const configOf = (env: Env) => {
  const read = readConfig({ ...base, ...env });
  if (!read.ok) throw new Error(`expected a config: ${JSON.stringify(read.error)}`);
  return read.value;
};

const problemsOf = (env: Env) => {
  const read = readConfig(env);
  if (read.ok) throw new Error("expected problems");
  return read.error;
};

describe("reading the environment", () => {
  test("defaults are complete: a database url is the only thing an operator must supply", () => {
    const config = configOf({});
    expect(Duration.toSeconds(config.monitors.every)).toBeGreaterThan(0);
    expect(config.reconcile.repair).toBe(false);
    expect(config.notifications.outboxSink).toBeNull();
  });

  test("a missing database url stops the process before any job runs", () => {
    expect(problemsOf({}).map((p) => p.variable)).toContain("DATABASE_URL");
  });

  /** Every problem at once, so a misconfigured deployment is fixed in one pass. */
  test("all the problems are reported, not the first one", () => {
    const problems = problemsOf({ COUNTED_MONITOR_BATCH: "0", COUNTED_OUTBOX_BATCH: "-3" });
    expect(problems.map((p) => p.variable).sort()).toEqual([
      "COUNTED_MONITOR_BATCH",
      "COUNTED_OUTBOX_BATCH",
      "DATABASE_URL",
    ]);
  });

  test("a non-integer interval is refused rather than silently floored", () => {
    expect(problemsOf({ ...base, COUNTED_MONITOR_INTERVAL_SECONDS: "1.5" })[0]?.variable).toBe(
      "COUNTED_MONITOR_INTERVAL_SECONDS",
    );
  });

  /**
   * A cadence coarser than a job's interval turns "every 60 seconds" into
   * "every 300" and the job still looks healthy — it just runs five times too
   * rarely, forever.
   */
  test("a cadence coarser than the shortest interval is refused", () => {
    const problems = problemsOf({
      ...base,
      COUNTED_WORKER_CADENCE_SECONDS: "120",
      COUNTED_OUTBOX_INTERVAL_SECONDS: "10",
    });
    expect(problems[0]?.variable).toBe("COUNTED_WORKER_CADENCE_SECONDS");
  });

  test("an api key with no sender address is refused before the first monitor fires", () => {
    expect(problemsOf({ ...base, RESEND_API_KEY: "re_x" })[0]?.variable).toBe("COUNTED_MAIL_FROM");
  });

  test("an outbox sink with no signing secret is refused", () => {
    expect(problemsOf({ ...base, COUNTED_OUTBOX_SINK_URL: "https://x.test/h" })[0]?.variable).toBe(
      "COUNTED_WEBHOOK_SIGNING_SECRET",
    );
  });

  /**
   * The flag decides whether a background process creates workspaces. Anything
   * but an explicit `true` is off — a truthy-string convention where "false"
   * enables it is not a risk worth the convenience.
   */
  test("repair is on only for an explicit true", () => {
    expect(configOf({ COUNTED_RECONCILE_REPAIR: "true" }).reconcile.repair).toBe(true);
    expect(configOf({ COUNTED_RECONCILE_REPAIR: "TRUE" }).reconcile.repair).toBe(true);
    for (const value of ["false", "1", "yes", "", "  "]) {
      expect(configOf({ COUNTED_RECONCILE_REPAIR: value }).reconcile.repair).toBe(false);
    }
  });

  /** Logged at boot, because a worker has no health endpoint to ask which build it is. */
  test("the release is RELEASE, else Railway's commit sha, else empty", () => {
    expect(configOf({}).release).toBe("");
    expect(configOf({ RAILWAY_GIT_COMMIT_SHA: "abc123" }).release).toBe("abc123");
    expect(configOf({ RELEASE: "def456", RAILWAY_GIT_COMMIT_SHA: "abc123" }).release).toBe("def456");
    expect(configOf({ RELEASE: " ", RAILWAY_GIT_COMMIT_SHA: "abc123" }).release).toBe("abc123");
  });

  test("an empty string is the same as unset, so a blank Railway variable does not break boot", () => {
    expect(configOf({ COUNTED_MONITOR_BATCH: "" }).monitors.batch).toBe(
      configOf({}).monitors.batch,
    );
    expect(configOf({ RESEND_API_KEY: "  " }).notifications.resendApiKey).toBeNull();
  });
});
