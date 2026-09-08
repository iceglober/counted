/**
 * Two paths, two different questions.
 *
 * **`/health` is liveness.** Shallow on purpose: it answers from memory and
 * touches nothing. A liveness check that queries the database turns a slow
 * query into a rolling restart — the platform kills the instance, the
 * replacement queues behind the same query, and one slow endpoint becomes the
 * whole service.
 *
 * **`/health/ready` is readiness.** It does touch the database, because the
 * question is "should this replica take traffic", and a replica that cannot
 * reach its database should not. This is the path `deploy/api.railway.json`
 * names, and the two agreeing is the whole point of this file: the deployed v2
 * answered `/health` while its Railway check pointed at `/v1/health`, which
 * 404'd — so every deploy waited out the check's timeout before being marked
 * healthy anyway, and a genuinely broken instance looked exactly like a working
 * one. Both paths exist here and `server.test.ts` asserts both answer.
 *
 * Readiness arrives as a function rather than being written here, so the
 * transport does not learn what a schema is and a test can make a replica
 * unready without a database.
 */

import { Instant } from "@counted/kernel";

export const HEALTH_PATH = "/health";
export const READY_PATH = "/health/ready";

/**
 * Who is answering. `release` is the commit the deploy set (`RELEASE`), so
 * "which build is serving" is a `curl` — and a rollback is confirmed from
 * outside rather than inferred from the platform's dashboard. Empty for a
 * local run.
 */
export type ServiceIdentity = { readonly service: string; readonly release: string };

export type Health = {
  readonly status: "ok";
  readonly service: string;
  readonly release: string;
  readonly startedAt: string;
  readonly uptimeMs: number;
};

export const health = (identity: ServiceIdentity, startedAt: Instant, at: Instant): Health => ({
  status: "ok",
  service: identity.service,
  release: identity.release,
  startedAt: Instant.toISO(startedAt),
  uptimeMs: Instant.toEpochMillis(at) - Instant.toEpochMillis(startedAt),
});

/**
 * Whether this replica should take traffic.
 *
 * `detail` is in the body on purpose: `curl` on a replica during a deploy
 * should say *why* it is not ready, not just that it is not. A readiness check
 * that answers a bare 503 is one an operator has to guess about.
 */
export type Readiness = { readonly ready: boolean; readonly detail: string };

export type ReadinessProbe = () => Promise<Readiness>;

/** For a deployment with nothing to check. Always ready, and says so. */
export const alwaysReady: ReadinessProbe = async () => ({
  ready: true,
  detail: "no dependencies are checked",
});

export type ReadyBody = {
  readonly status: "ready" | "not_ready";
  readonly service: string;
  readonly release: string;
  readonly detail: string;
};

export const readyBody = (identity: ServiceIdentity, readiness: Readiness): ReadyBody => ({
  status: readiness.ready ? "ready" : "not_ready",
  service: identity.service,
  release: identity.release,
  detail: readiness.detail,
});
