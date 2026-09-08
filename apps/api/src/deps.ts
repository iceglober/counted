/**
 * Every port the server needs, as one value.
 *
 * This is the composition root's inventory. Each field is an interface some
 * other package declared; not one of them is a concrete class, which is what
 * lets `server.test.ts` build the whole API over in-memory doubles and lets
 * `main.ts` be the only file in the repository that knows a connection string
 * exists.
 *
 * **`A` is closed here, once, to `@counted/analytics-domain`'s `Analysis`.**
 * Dashboards, tiles and monitors are generic in the analysis they hold because
 * `no-cross-context-domain` forbids dashboarding naming analytics (V3-SPEC §7).
 * `apps/*` is the one layer allowed to know both, so this is the layer that
 * says which type it is — and it says it in a single alias so no two modules
 * can close it differently.
 */

import type { Clock, IdGenerator, Notifier } from "@counted/kernel/ports";
import type { Analysis } from "@counted/analytics-domain";
import type { AnalyticsEngine, SchemaCatalog } from "@counted/analytics-ports";
import type { ShareTokens } from "@counted/dashboarding-ports";
import type { Identity } from "@counted/identity-adapter-better-auth";
import type { EventSink, IngestQuota } from "@counted/ingestion-app";
import type { GeoLocator } from "@counted/ingestion-ports";
import type { UnitOfWork } from "@counted/persistence-ports";
import type { CountedRepositories } from "@counted/adapter-postgres";
import type { BillingGateway } from "@counted/tenancy-app";
import type { ApiConfig } from "./config";
import type { Logger } from "./logging";

/** The analysis type, closed. Every generic in this app is instantiated with it. */
export type A = Analysis;

export type Repositories = CountedRepositories<A>;

export type ApiDependencies = {
  readonly config: ApiConfig;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly ids: IdGenerator;

  /** better-auth behind the identity ports, plus its own HTTP surface. */
  readonly identity: Identity;

  /** Writes. A command opens one of these and nothing else. */
  readonly uow: UnitOfWork<Repositories>;
  /**
   * Reads that are not part of a command, on the pool.
   *
   * They write perfectly well; what they do not have is a transaction, so two
   * writes through them are two transactions. Used for `find`/`list` only.
   */
  readonly reads: Repositories;

  readonly engine: AnalyticsEngine;
  readonly catalog: SchemaCatalog;
  readonly shareTokens: ShareTokens;

  /**
   * `null` when the deployment has no payment provider configured — a
   * self-hosted install, or a local run. Billing routes are not in the contract
   * tree today (see the hand-off), so the only consumer is the Stripe webhook,
   * which simply is not mounted when this is null. That is better than mounting
   * an endpoint that 500s on every delivery and makes Stripe retry for days.
   */
  readonly billing: BillingGateway | null;

  /**
   * Where admitted events are made durable.
   *
   * Injected with no default because no package in the repository implements
   * it: `@litics/core` has `trackBatch`, and only
   * `@counted/analytics-adapter-litics` may import it. Writing one here would
   * break `only-the-analytics-adapter-knows-litics`, and writing raw INSERTs
   * against litics' partitioned tables would be a second write path for the
   * same rows. Flagged rather than faked.
   */
  readonly sink: EventSink;
  readonly quota: IngestQuota;
  /**
   * Country from the request address, resolved in-process.
   *
   * A port rather than a function so the implementation cannot quietly become a
   * network call: `@counted/ingestion-adapter-geoip` binary-searches a bundled
   * registry table, and a geolocation *service* would put a round trip on the
   * ingest hot path and hand a third party every caller's address.
   */
  readonly geo: GeoLocator;

  readonly notifier: Notifier;
};
