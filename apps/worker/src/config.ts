/**
 * Environment into a value, once, at boot — and a refusal that names every
 * problem rather than the first one.
 *
 * Reading `process.env` at the point of use is how a worker runs for six days
 * with a typo'd interval nobody noticed: the fallback took over, the job ran on
 * the default, and nothing said so. Everything is read here, defaults are
 * stated here, and a bad value stops the process before any job runs.
 *
 * Every duration is spelled in seconds because that is the unit an operator
 * setting it thinks in. `Duration` is the unit everything downstream thinks in,
 * and the conversion happens exactly once.
 */

import { Duration, err, ok, type Result } from "@counted/kernel";

export type WorkerConfig = {
  readonly databaseUrl: string;
  /** Where analytics reads connect; defaults to `DATABASE_URL`. See the API's config for why. */
  readonly databaseDirectUrl: string;
  /** Bytes of decoded analytics segments kept in memory. Monitors read scalars; 64 MiB is plenty. */
  readonly segmentCacheBytes: number;
  /** How often the scheduler looks for due work. Finer than the shortest interval below. */
  readonly cadence: Duration;

  readonly monitors: {
    readonly every: Duration;
    readonly batch: number;
    /** How long one monitor's query may take before the engine abandons it. */
    readonly deadline: Duration;
  };
  readonly outbox: {
    readonly every: Duration;
    readonly batch: number;
    readonly maxAttempts: number;
  };
  readonly retention: {
    readonly every: Duration;
    readonly pageSize: number;
    readonly maxProjects: number;
  };
  readonly maintenance: { readonly every: Duration };
  /** The compactor: how often it packs and maintains, and when lag is worth a warning. */
  readonly pack: {
    readonly every: Duration;
    readonly maintenanceEvery: Duration;
    /** A partial segment is packed once its oldest staged row is this old. */
    readonly maxStagingAge: Duration;
    /** The maintenance check warns when the oldest staged row is older than this. */
    readonly lagWarn: Duration;
  };
  readonly reconcile: {
    readonly every: Duration;
    readonly lookback: Duration;
    readonly batch: number;
    readonly repair: boolean;
  };

  /**
   * What the provisioning reconciler needs to see better-auth's tables, or
   * `null` when this deployment has not been given it.
   *
   * All-or-nothing as a group, like `notifications`: better-auth refuses to
   * build without a secret and an origin, and the holding workspace is what
   * an unclaimed project's key is placed in. Absent, the job reports
   * `unavailable` and names what is missing — it does not scan nothing and
   * call every project healthy.
   *
   * The secret must be the *same* one `apps/api` uses. A different one is not
   * a second installation: better-auth's `jwks` private key is encrypted with
   * whichever secret wrote it, and a process holding another one throws
   * "Failed to decrypt private key" the first time it touches that table.
   */
  readonly identity: {
    readonly authSecret: string;
    readonly baseUrl: string;
    readonly holdingWorkspace: string;
    readonly holdingOwner: string;
  } | null;

  /**
   * Where notifications go. Every field is nullable and a missing one disables
   * exactly one thing, loudly at boot — a worker that cannot send mail should
   * still evaluate monitors, purge data and reconcile workspaces.
   */
  readonly notifications: {
    readonly resendApiKey: string | null;
    /** `"Counted <alerts@counted.dev>"`. Required if `resendApiKey` is set. */
    readonly emailFrom: string | null;
    readonly webhookSecret: string | null;
    /** Where dispatched outbox envelopes are POSTed. No sink, no dispatch job. */
    readonly outboxSink: string | null;
  };

  /**
   * The build this process is: `RELEASE` as the deploy workflow set it, or
   * `RAILWAY_GIT_COMMIT_SHA` where Railway built it from GitHub, or empty for
   * a local run. Logged in the boot line, since a worker has no health
   * endpoint to ask.
   */
  readonly release: string;
};

export type ConfigProblem = { readonly variable: string; readonly detail: string };

export type Env = Readonly<Record<string, string | undefined>>;

const DEFAULTS = {
  COUNTED_WORKER_CADENCE_SECONDS: 5,
  // Decoded analytics segments kept in memory, in MiB. Monitors read scalars
  // one at a time; a small cache is plenty.
  COUNTED_SEGMENT_CACHE_MB: 64,
  COUNTED_MONITOR_INTERVAL_SECONDS: 60,
  COUNTED_MONITOR_BATCH: 200,
  COUNTED_MONITOR_DEADLINE_SECONDS: 15,
  COUNTED_OUTBOX_INTERVAL_SECONDS: 10,
  COUNTED_OUTBOX_BATCH: 100,
  COUNTED_OUTBOX_MAX_ATTEMPTS: 8,
  // Hourly, not nightly. Retention is a promise about the *oldest* data, so a
  // daily sweep means the promise is kept to within a day; hourly costs almost
  // nothing because the second run of an hour finds nothing to do.
  COUNTED_RETENTION_INTERVAL_SECONDS: 3_600,
  COUNTED_RETENTION_PAGE_SIZE: 200,
  COUNTED_RETENTION_MAX_PROJECTS: 5_000,
  COUNTED_MAINTENANCE_INTERVAL_SECONDS: 900,
  // The compactor. Ten seconds is the timer; NOTIFY wakes it sooner. A
  // partial segment after a minute keeps a quiet project's reads on the fast
  // path without producing a segment per event. Lag past five minutes means
  // nothing is packing.
  COUNTED_PACK_INTERVAL_SECONDS: 10,
  COUNTED_SEGMENT_MAINTENANCE_INTERVAL_SECONDS: 3_600,
  COUNTED_PACK_MAX_STAGING_AGE_SECONDS: 60,
  COUNTED_PACK_LAG_WARN_SECONDS: 300,
  COUNTED_RECONCILE_INTERVAL_SECONDS: 900,
  // Generous, because an orphan stays orphaned: a workspace that was never
  // written does not appear later, so a short window would permanently miss
  // anything created while the worker was down.
  COUNTED_RECONCILE_LOOKBACK_SECONDS: 30 * 24 * 3_600,
  COUNTED_RECONCILE_BATCH: 500,
} as const;

type NumericKey = keyof typeof DEFAULTS;

const positiveInt = (
  env: Env,
  key: NumericKey,
  problems: ConfigProblem[],
): number => {
  const raw = env[key];
  if (raw === undefined || raw === "") return DEFAULTS[key];
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    problems.push({ variable: key, detail: `expected a positive whole number, got ${raw}` });
    return DEFAULTS[key];
  }
  return parsed;
};

/**
 * Anything but an explicit `true` is false.
 *
 * The setting that reaches this is `COUNTED_RECONCILE_REPAIR`, which decides
 * whether a background process creates workspaces. A truthy-string convention
 * where `"false"` enables it is not a risk worth the convenience.
 */
const text = (env: Env, key: string): string | null => {
  const raw = env[key]?.trim();
  return raw === undefined || raw === "" ? null : raw;
};

const flag = (env: Env, key: string): boolean => env[key]?.toLowerCase() === "true";

/**
 * The identity group, or null.
 *
 * Four names, all together or none. A partial group is refused rather than
 * half-wired: a worker holding a secret and no holding workspace would build a
 * credential store that cannot answer the one question the reconciler asks,
 * and would look configured while being useless.
 */
const identityFrom = (
  env: Env,
  problems: ConfigProblem[],
): WorkerConfig["identity"] => {
  const names = [
    "COUNTED_AUTH_SECRET",
    "COUNTED_API_URL",
    "COUNTED_UNCLAIMED_WORKSPACE_ID",
    "COUNTED_UNCLAIMED_WORKSPACE_OWNER_ID",
  ] as const;
  const values = names.map((name) => text(env, name));
  if (values.every((value) => value === null)) return null;

  const missing = names.filter((_, index) => values[index] === null);
  if (missing.length > 0) {
    for (const name of missing) {
      problems.push({
        variable: name,
        detail:
          "required once any of the identity group is set; the provisioning " +
          "reconciler needs all four or none of them",
      });
    }
    return null;
  }

  const [authSecret, baseUrl, holdingWorkspace, holdingOwner] = values;
  // Every one of them is non-null here — `missing` was empty — but the tuple
  // destructuring cannot say so, and widening it with a cast would be a cast.
  if (
    authSecret === undefined ||
    authSecret === null ||
    baseUrl === undefined ||
    baseUrl === null ||
    holdingWorkspace === undefined ||
    holdingWorkspace === null ||
    holdingOwner === undefined ||
    holdingOwner === null
  ) {
    return null;
  }
  return { authSecret, baseUrl, holdingWorkspace, holdingOwner };
};

export const readConfig = (env: Env): Result<WorkerConfig, readonly ConfigProblem[]> => {
  const problems: ConfigProblem[] = [];

  const databaseUrl = env["DATABASE_URL"] ?? "";
  if (databaseUrl === "") {
    problems.push({ variable: "DATABASE_URL", detail: "required; the worker has nothing to do without it" });
  }

  const seconds = (key: NumericKey): Duration =>
    Duration.seconds(positiveInt(env, key, problems));

  const config: WorkerConfig = {
    databaseUrl,
    databaseDirectUrl: env["COUNTED_DATABASE_DIRECT_URL"] ?? databaseUrl,
    segmentCacheBytes: positiveInt(env, "COUNTED_SEGMENT_CACHE_MB", problems) * 1024 * 1024,
    cadence: seconds("COUNTED_WORKER_CADENCE_SECONDS"),
    monitors: {
      every: seconds("COUNTED_MONITOR_INTERVAL_SECONDS"),
      batch: positiveInt(env, "COUNTED_MONITOR_BATCH", problems),
      deadline: seconds("COUNTED_MONITOR_DEADLINE_SECONDS"),
    },
    outbox: {
      every: seconds("COUNTED_OUTBOX_INTERVAL_SECONDS"),
      batch: positiveInt(env, "COUNTED_OUTBOX_BATCH", problems),
      maxAttempts: positiveInt(env, "COUNTED_OUTBOX_MAX_ATTEMPTS", problems),
    },
    retention: {
      every: seconds("COUNTED_RETENTION_INTERVAL_SECONDS"),
      pageSize: positiveInt(env, "COUNTED_RETENTION_PAGE_SIZE", problems),
      maxProjects: positiveInt(env, "COUNTED_RETENTION_MAX_PROJECTS", problems),
    },
    maintenance: { every: seconds("COUNTED_MAINTENANCE_INTERVAL_SECONDS") },
    pack: {
      every: seconds("COUNTED_PACK_INTERVAL_SECONDS"),
      maintenanceEvery: seconds("COUNTED_SEGMENT_MAINTENANCE_INTERVAL_SECONDS"),
      maxStagingAge: seconds("COUNTED_PACK_MAX_STAGING_AGE_SECONDS"),
      lagWarn: seconds("COUNTED_PACK_LAG_WARN_SECONDS"),
    },
    reconcile: {
      every: seconds("COUNTED_RECONCILE_INTERVAL_SECONDS"),
      lookback: seconds("COUNTED_RECONCILE_LOOKBACK_SECONDS"),
      batch: positiveInt(env, "COUNTED_RECONCILE_BATCH", problems),
      repair: flag(env, "COUNTED_RECONCILE_REPAIR"),
    },
    identity: identityFrom(env, problems),
    notifications: {
      resendApiKey: text(env, "RESEND_API_KEY"),
      // The same names `apps/api` reads. They were `COUNTED_EMAIL_FROM` and
      // `COUNTED_WEBHOOK_SECRET` here, which meant no single environment could
      // satisfy both processes: an operator who set the API's `COUNTED_MAIL_FROM`
      // alongside `RESEND_API_KEY` got a working API and a worker that refused
      // to start, complaining about a variable the API had never mentioned.
      emailFrom: text(env, "COUNTED_MAIL_FROM"),
      webhookSecret: text(env, "COUNTED_WEBHOOK_SIGNING_SECRET"),
      outboxSink: text(env, "COUNTED_OUTBOX_SINK_URL"),
    },
    release: text(env, "RELEASE") ?? text(env, "RAILWAY_GIT_COMMIT_SHA") ?? "",
  };

  // An API key with no sender address produces a provider rejection on the
  // first monitor that fires, at three in the morning, in a log nobody reads.
  if (config.notifications.resendApiKey !== null && config.notifications.emailFrom === null) {
    problems.push({
      variable: "COUNTED_MAIL_FROM",
      detail: "required when RESEND_API_KEY is set; Resend rejects a send with no verified sender",
    });
  }
  if (config.notifications.outboxSink !== null && config.notifications.webhookSecret === null) {
    problems.push({
      variable: "COUNTED_WEBHOOK_SIGNING_SECRET",
      detail: "required when COUNTED_OUTBOX_SINK_URL is set; an unsigned webhook cannot be trusted by its receiver",
    });
  }

  // Checked rather than assumed: a cadence coarser than an interval silently
  // turns "every 60 seconds" into "every 300", and the job would look healthy
  // while running five times too rarely.
  const shortest = [
    config.monitors.every,
    config.outbox.every,
    config.retention.every,
    config.maintenance.every,
    config.reconcile.every,
  ].reduce((a, b) => (Duration.compare(a, b) <= 0 ? a : b));
  if (Duration.compare(config.cadence, shortest) > 0) {
    problems.push({
      variable: "COUNTED_WORKER_CADENCE_SECONDS",
      detail:
        `must not exceed the shortest job interval (${Duration.toSeconds(shortest)}s), ` +
        `or that job runs late by up to one cadence`,
    });
  }

  return problems.length > 0 ? err(problems) : ok(config);
};

export const describeProblems = (problems: readonly ConfigProblem[]): string =>
  problems.map((p) => `  ${p.variable}: ${p.detail}`).join("\n");
