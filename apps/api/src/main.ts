/**
 * The process. The only file in the repository that knows a connection string
 * exists.
 *
 * Everything else takes ports. This reads the environment, builds one concrete
 * implementation of each, and starts the server — and it refuses to start when
 * anything it needs is missing, printing every problem at once. A deployment
 * with a hole in it should fail before it takes traffic, not on the first
 * request that reaches the hole: v1 read `process.env.STRIPE_WEBHOOK_SECRET`
 * inside the webhook handler, so a missing secret was discovered by the first
 * customer to pay.
 *
 * **Three schemas are applied here, in order, and the order is not arbitrary.**
 * `applySchema` first, because it creates the `auth` namespace better-auth's
 * migration then writes into. `migrateIdentity` second. The litics migrations
 * last — their step zero creates `public.analytics_org`, the tenancy host
 * table their first generated step attaches a trigger to. All three are safe to run on every boot and on every
 * replica at once: the first is `IF NOT EXISTS` throughout and ledgers any
 * change to an existing table (`DOMAIN_MIGRATIONS`), the second diffs against
 * the live database, and the third keeps a ledger — and all three take the
 * same advisory lock, bounded by a timeout, so a second replica waits rather
 * than racing and one queued behind a wedged holder fails by name.
 */

import { Pool } from "pg";
import { Resend } from "resend";
import { WorkspaceId, isErr, unbrand, type ProjectId } from "@counted/kernel";
import { systemClock, newShareToken, shareTokenDigest, uuidV7Generator } from "@counted/adapter-crypto";
import { notifier, resendEmailSender, signedWebhookSender } from "@counted/adapter-notify";
import { permissionsForRole } from "@counted/authorization";
import { stripeBillingGateway, stripeClient } from "@counted/adapter-stripe";
import {
  DOMAIN_TABLES,
  RowDecodeError,
  applyMigrations,
  applySchema,
  withSchemaLock,
  pooledRepositories,
  projectCreatedAt,
  postgresUnitOfWork,
  type AnalysisCodec,
  type WorkspaceMemberships,
} from "@counted/adapter-postgres";
import {
  INTROSPECTION,
  LiticsAnalyticsEngine,
  LiticsEventSink,
  LiticsSchemaCatalog,
  analyticsMigrations,
  analyticsSchemaDrift,
  orgRemove,
  orgUpsert,
} from "@counted/analytics-adapter-litics";
import { provisionWorkspace } from "@counted/tenancy-app";
import { GroupCommit } from "@counted/ingestion-app";
import { BundledGeoLocator } from "@counted/ingestion-adapter-geoip";
import {
  createIdentity,
  migrateIdentity,
  type IdentityConfig,
} from "@counted/identity-adapter-better-auth";
import type { Analysis } from "@counted/analytics-domain";
import type { EventSink } from "@counted/ingestion-app";
import { fromAnalysis, toAnalysis } from "./analysis/wire";
import { credentialGrants } from "./auth/grants";
import { loadConfig, type ApiConfig } from "./config";
import type { A, ApiDependencies } from "./deps";
import { jsonLogger, type Logger } from "./logging";
import { listen } from "./listen";
import { AUTH_MOUNT } from "./server";

/**
 * What an operator sees next to the holding workspace's row. It has no members
 * a person can sign in as and no customer behind it; the name is the only
 * thing that says so at a glance.
 */
const HOLDING_WORKSPACE_NAME = "Unclaimed projects";
import type { Readiness } from "./health";
import { clientAddress } from "./ingest/client-ip";
import { derivedIngestQuota } from "./ingest/quota";
import { buildApi } from "./index";

/**
 * Where better-auth's tables live.
 *
 * One database, `public` for the domain, `auth` for
 * better-auth, and litics' own schema for the segments. `applySchema` creates the
 * namespace; the identity pool's `search_path` is what puts the tables in it.
 */
const IDENTITY_SCHEMA = "auth";

/**
 * The stored form of an analysis, validated on the way back in.
 *
 * `unvalidatedAnalysisCodec` exists for tests and is wrong here: it hands the
 * domain whatever JSON is in the column, including a shape written by a version
 * that had different fields. This one runs the same conversion the wire does,
 * so a row that no longer parses is a `RowDecodeError` naming the tile rather
 * than a `TypeError` three layers up.
 */
const analysisCodec: AnalysisCodec<A> = {
  encode: (analysis) => fromAnalysis(analysis),
  decode: (raw) => {
    const converted = toAnalysis(raw as Parameters<typeof toAnalysis>[0]);
    if (isErr(converted)) {
      // The codec is handed the column value alone, so the table and row it
      // came from are not knowable here. Naming the column is what makes the
      // error actionable; the alternative is a TypeError three layers up.
      throw new RowDecodeError("dashboard_tiles", "-", "analysis", converted.error);
    }
    return converted.value as Analysis;
  },
};

const start = async (): Promise<void> => {
  const loaded = loadConfig(process.env);
  if (isErr(loaded)) {
    for (const problem of loaded.error) {
      process.stderr.write(`config: ${problem.variable} ${problem.detail}\n`);
    }
    process.exit(1);
  }
  const config: ApiConfig = loaded.value;
  const logger = jsonLogger({ level: config.logLevel, service: config.serviceName });

  /**
   * Two pools onto one database, and the second one exists for a single
   * Postgres setting.
   *
   * better-auth 1.7 has no schema option: it creates its tables unqualified
   * and reads the target back with `SHOW search_path`. So the only way its
   * tables land in `auth`, where `memberships` below looks for
   * them, is a connection whose
   * `search_path` starts with `auth`. That setting cannot go on the domain's
   * pool: `applySchema` creates `workspaces`, `projects` and the rest
   * unqualified too, and they would follow it into `auth`.
   *
   * `public` stays second on the identity pool so extension functions and the
   * tenancy host table still resolve from it.
   *
   * What the split does NOT cost: both pools are the same database, which is
   * the precondition `provisioning.ts` actually rests on. A transaction lives
   * on one connection either way — `adapter.transaction` takes its own out of
   * whichever pool it was given, and always did.
   */
  const pool = new Pool({ connectionString: config.databaseUrl });
  /**
   * Analytics reads get their own small pool on the direct host. Small on
   * purpose: a segment read holds a REPEATABLE READ snapshot for the whole
   * cursor walk, and four of those per replica is plenty; more would only
   * queue behind each other on the same disk. Kept separate from `pool` so a
   * slow analytics read can never starve a sign-in or an ingest. Decoded
   * segments are cached in this process up to `segmentCacheBytes`.
   */
  const analyticsPool = new Pool({ connectionString: config.databaseDirectUrl, max: 4 });
  const identityPool = new Pool({
    connectionString: config.databaseUrl,
    options: `-c search_path=${IDENTITY_SCHEMA},public`,
  });

  /**
   * First, and on the domain's pool. It creates the `auth` namespace the
   * identity migration writes into and the `analytics_org` table litics'
   * first migration attaches a trigger to, so both of those are ordered
   * behind it.
   */
  const domain = await applySchema(pool);
  logger.info("domain schema applied", {
    applied: domain.applied.length,
    skipped: domain.skipped.length,
  });

  const clock = systemClock;
  const ids = uuidV7Generator(clock);

  /**
   * `listForAccount` needs each workspace's role, and roles live in
   * better-auth's `member` table. One query, in the same database, rather than
   * a port that would make identity a dependency of the workspace repository.
   */
  const memberships: WorkspaceMemberships = {
    forAccount: async (account) => {
      const rows = await pool.query<{ organization_id: string; role: string }>(
        `SELECT "organizationId" AS organization_id, role FROM auth.member WHERE "userId" = $1`,
        [unbrand(account)],
      );
      return rows.rows.flatMap((row) =>
        row.role === "owner" || row.role === "admin" || row.role === "member"
          ? [{ workspace: WorkspaceId(row.organization_id), role: row.role }]
          : [],
      );
    },
  };

  /**
   * The analytics engine's tenancy tree, written by the same repositories that
   * write the workspace and project rows.
   *
   * `orgUpsert` and `orgRemove` are `@counted/analytics-adapter-litics`'s —
   * the only package allowed to know litics exists — and the composition root
   * is where they meet `@counted/adapter-postgres`. Without this every query
   * about a project answers zero and reports no error, because litics resolves
   * even a project scope through `analytics.org_tree`.
   */
  const tenancy = { place: orgUpsert, remove: orgRemove };
  const options = { analysis: analysisCodec, memberships, tenancy };
  const uow = postgresUnitOfWork<A>(pool, options);
  const reads = pooledRepositories<A>(pool, options);

  /**
   * Built once and used twice: `migrateIdentity` diffs the database against
   * the schema *this* configuration implies, so a plugin that is enabled here
   * and not there would migrate a schema the running instance does not use.
   */
  const identityConfig: IdentityConfig = {
    baseURL: `${config.baseUrl}${AUTH_MOUNT}`,
    // The console forwards sign-in with the browser's Origin, which is its
    // own; better-auth must be told to accept it.
    trustedOrigins: [config.consoleUrl],
    // And every link we email is clicked on the console, not here — the
    // cookie has to land on the origin the reader is looking at.
    browserOrigin: config.consoleUrl,
    secret: config.authSecret,
    database: { kind: "postgres", pool: identityPool },
    grants: credentialGrants,
    rolePermissions: permissionsForRole,
    /**
     * Three answers, not two. `null` is "no such project"; an unclaimed
     * project reports its own state rather than borrowing that null, which is
     * what lets `issue` mint the ingest key the no-signup path returns. The
     * previous shape collapsed the two and refused every anonymous provision.
     */
    projects: {
      placementOf: async (project) => {
        const found = await reads.projects.find(project);
        if (found === null) return null;
        return found.workspace === null
          ? { kind: "unclaimed" }
          : { kind: "claimed", workspace: found.workspace };
      },
    },
    holding: {
      workspace: config.unclaimedWorkspace,
      owner: config.unclaimedWorkspaceOwner,
    },
    notifier: mailer(config, logger),
    emailDelivery: config.email !== null,
    ids,
    socialSignIn: [
      ...(config.social.github === null ? [] : [{ provider: "github" as const, ...config.social.github }]),
      ...(config.social.google === null ? [] : [{ provider: "google" as const, ...config.social.google }]),
    ],
    /**
     * What the sign-in limiter keys on. The same trusted-hop rule the ingest
     * route uses for geography, so a caller who cannot choose a country by
     * forging `X-Forwarded-For` cannot choose a rate-limit bucket either.
     */
    clientAddress: (headers) => clientAddress(headers, config.trustedProxyHops),
    mcpResource: config.mcpResource,
    loginPage: `${config.consoleUrl}/sign-in`,
    consentPage: `${config.consoleUrl}/consent`,
    log: (level, message, details) =>
      logger[level === "error" ? "error" : level === "warn" ? "warn" : "info"](
        `identity: ${message}`,
        { details: details.map(String).join(" ") },
      ),
  };

  /**
   * Under the schema lock, because better-auth's migration has none of its
   * own: it introspects, decides what is missing, and creates it, so two
   * replicas booting onto a cold database both decide sixteen tables are
   * missing and the loser dies with `relation "session" already exists`.
   */
  const identitySchema = await withSchemaLock(pool, () => migrateIdentity(identityConfig));
  /**
   * Refuse rather than run in the wrong schema.
   *
   * If `search_path` did not take, better-auth creates its tables in `public`,
   * finds them there on every subsequent call, and works — while the one query
   * that reads `auth.member` by its qualified name returns no rows. The
   * symptom is "every workspace list is empty for everybody", weeks later, and
   * nothing in the log ever said why.
   */
  if (identitySchema.schema !== IDENTITY_SCHEMA) {
    process.stderr.write(
      `prerequisite: identity tables were migrated into "${identitySchema.schema}", ` +
        `not "${IDENTITY_SCHEMA}". The identity pool's search_path did not take.\n`,
    );
    process.exit(1);
  }
  logger.info("identity schema applied", {
    schema: identitySchema.schema,
    created: identitySchema.created.length,
    altered: identitySchema.altered.length,
  });

  const analytics = await applyMigrations(pool, analyticsMigrations());
  logger.info("analytics schema applied", {
    applied: analytics.applied.length,
    skipped: analytics.skipped.length,
  });

  const identity = createIdentity(identityConfig, AUTH_MOUNT);

  /**
   * The holding workspace, created here rather than by hand.
   *
   * `COUNTED_UNCLAIMED_WORKSPACE_ID` and `COUNTED_UNCLAIMED_WORKSPACE_OWNER_ID`
   * used to name rows nothing ever wrote, so `POST /v1/projects/provision`
   * failed on every database that had not been seeded by an operator — and
   * failed as `NoSuchProject`, which named the wrong thing. Under the schema
   * lock for the same reason better-auth's migration is: two replicas booting
   * onto a cold database would otherwise race the same primary key.
   */
  const holding = await withSchemaLock(pool, () => identity.holding.ensure(clock.now()));

  /**
   * The domain half of the holding workspace.
   *
   * A workspace is two rows that mean different things and both have to exist:
   * better-auth's `organization` answers who belongs here, ours answers what
   * plan and what limits. The holding workspace is no exception, and skipping
   * its domain row would leave the one organization in the database that the
   * reconciler is right to call an orphan — `apps/worker`'s `reconcile` job
   * would find it every fifteen minutes and, with repair on, create this row
   * anyway. Better to create it here, deliberately, than to have a repair path
   * discover it.
   *
   * It costs a free-plan workspace with no human members. Nothing meters
   * against it: an unclaimed project has no `workspace_id`, so it consumes no
   * slot, and its events are counted against the unclaimed allowance rather
   * than a plan.
   */
  const holdingRow = await uow.transact(async (repositories) => {
    // Inside the transaction, so two replicas that both find it missing do not
    // both create it — the same argument the workspace reconciler makes.
    if ((await repositories.workspaces.find(holding.workspace)) !== null) return "present";
    const provisioned = await provisionWorkspace(
      repositories,
      { workspace: holding.workspace, name: HOLDING_WORKSPACE_NAME, founder: holding.owner },
      clock.now(),
    );
    return isErr(provisioned) ? `refused: ${provisioned.error.kind}` : "created";
  });

  logger.info("holding workspace ready", {
    workspace: unbrand(holding.workspace),
    created: holding.created.join(",") || "nothing",
    domainRow: holdingRow,
  });
  if (holding.problem !== null) {
    // A warning and not an exit: anonymous provisioning is one route of
    // forty-two, and refusing to boot would take the other forty-one with it.
    logger.warn("holding workspace cannot issue", { detail: holding.problem });
  }

  const engine = new LiticsAnalyticsEngine({
    pool: analyticsPool,
    clock,
    cacheBytes: config.segmentCacheBytes,
    // What each read touched: how many segments, how many from cache, which
    // path. The number to watch is `segments` on a hybrid read — it should be
    // a handful, never the window's worth.
    onRead: (stats) => logger.debug("analytics.read", { ...stats }),
  });
  const catalog = new LiticsSchemaCatalog({ pool, clock });

  const projectWorkspace = async (project: ProjectId) => {
    const found = await reads.projects.find(project);
    return found === null ? undefined : found.workspace;
  };

  const quota = derivedIngestQuota({
    engine,
    projectWorkspace,
    projectCreatedAt: (project) => projectCreatedAt(pool, project),
    workspaceEntitlement: async (workspace) =>
      (await reads.workspaces.find(workspace))?.entitlement ?? null,
    logger,
    deadline: config.queryDeadline,
  });

  const sink: EventSink = new LiticsEventSink({ pool });

  /**
   * Country from the request address. Read off disk once, ~950 KiB, then a
   * binary search per event with no network call and no cache to go stale
   * within a run.
   *
   * The build date is logged because the table is a snapshot of registry data
   * that is republished daily and this copy is not. An old table still places
   * the overwhelming majority of addresses — delegations move rarely — but
   * blocks delegated since the build read as no country at all, and that is a
   * thing an operator should be able to see rather than infer from a chart.
   */
  const geo = BundledGeoLocator.bundled();
  logger.info("geoip table loaded", {
    generatedAt: geo.generatedAt.toISOString(),
    ageDays: Math.floor((Date.now() - geo.generatedAt.getTime()) / 86_400_000),
    trustedProxyHops: config.trustedProxyHops,
  });
  if (config.trustedProxyHops === 0) {
    // Not a warning about a mistake — it is a configuration somebody chose —
    // but it must be visible, because the symptom is an empty country
    // breakdown and nothing else.
    logger.info("no country will be derived: COUNTED_TRUSTED_PROXY_HOPS is 0", {});
  }

  const deps: ApiDependencies = {
    config,
    logger,
    clock,
    ids,
    geo,
    identity,
    uow,
    reads,
    engine,
    catalog,
    shareTokens: {
      mint: async () => {
        const token = newShareToken();
        return { token, digest: shareTokenDigest(token) };
      },
      digest: async (token) => shareTokenDigest(token),
    },
    billing:
      config.stripe === null
        ? null
        : stripeBillingGateway({
            api: stripeClient({
              secretKey: config.stripe.secretKey,
              ...(config.stripe.apiBase === null ? {} : { apiBase: config.stripe.apiBase }),
            }),
            webhookSecret: config.stripe.webhookSecret,
            prices: { pro: config.stripe.prices.pro },
          }),
    sink,
    quota,
    notifier: mailer(config, logger),
  };

  const commit = new GroupCommit({
    sink,
    quota,
    clock,
    onProblem: (problem) =>
      logger.error("group commit problem", {
        kind: problem.kind,
        project: unbrand(problem.project),
        events: problem.events,
        detail: problem.detail,
      }),
  });

  /**
   * Readiness: can this replica reach its database, and is the analytics schema
   * the one this build's query builders were written against?
   *
   * The drift check is the one that earns its keep. Migrations do not re-run
   * once executed, so editing the dimension list leaves the engine reading
   * columns that were never created — and the symptom is a query error on one
   * chart, weeks later, rather than a replica that refuses traffic now.
   */
  const readiness = async (): Promise<Readiness> => {
    for (const table of DOMAIN_TABLES) {
      const present = await pool.query<{ ok: boolean }>(
        "SELECT to_regclass($1) IS NOT NULL AS ok",
        [`public.${table}`],
      );
      if (present.rows[0]?.ok !== true) {
        return { ready: false, detail: `the ${table} table is missing` };
      }
    }

    // The row shape `INTROSPECTION` selects. Declared here rather than
    // imported: `ColumnSpec` is `@litics/core`'s, and only
    // `@counted/analytics-adapter-litics` may import that package — so the
    // structural type is restated at the one call site that needs it.
    const columns = await pool.query<{ table: string; column: string; udt: string }>(
      INTROSPECTION.sql,
      [...INTROSPECTION.parameters],
    );
    const drift = analyticsSchemaDrift(columns.rows);
    return drift.length === 0
      ? { ready: true, detail: "schema is current" }
      : { ready: false, detail: `analytics schema drift: ${drift.join("; ")}` };
  };

  const api = buildApi(deps, commit, ids, readiness);

  /**
   * One timer for the process, re-armed after every commit.
   *
   * `GroupCommit` owns the policy and the promises and deliberately owns no
   * timer — which is what makes the whole hot path testable in a millisecond.
   * This is the other half: read `nextDeadlineAt()`, sleep until it, tick.
   */
  let armed: ReturnType<typeof setTimeout> | null = null;
  const rearm = (): void => {
    if (armed !== null) clearTimeout(armed);
    const deadline = commit.nextDeadlineAt();
    if (deadline === null) return;
    const delay = Math.max(0, Number(deadline) - Number(clock.now()));
    armed = setTimeout(() => {
      commit.tick();
      rearm();
    }, delay);
  };
  const pump = setInterval(rearm, 25);

  const server = listen(api, config.port);
  logger.info("listening", { port: config.port, baseUrl: config.baseUrl, release: config.release });

  /**
   * Drain before exit. A process that stops with waiters outstanding has
   * accepted events and answered nobody, which is the worst of both answers.
   */
  const stop = async (): Promise<void> => {
    clearInterval(pump);
    if (armed !== null) clearTimeout(armed);
    await server.stop();
    await commit.drain();
    await pool.end();
    await identityPool.end();
    await analyticsPool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
};

/**
 * With no mail provider configured the message goes to the log instead of
 * nowhere: a local sign-in is then a copy-paste from the terminal, which is
 * what `.env.example` promises. Only the link is logged, not the prose, so
 * the line is short and the thing to click is the last field on it.
 */
const mailer = (config: ApiConfig, logger: Logger) =>
  notifier({
    email:
      config.email === null
        ? {
            send: async (message) => {
              logger.info("email not sent: no mail provider configured, the link is here", {
                to: message.to,
                subject: message.subject,
                link: /https?:\/\/\S+/.exec(message.body)?.[0] ?? null,
              });
            },
          }
        : resendEmailSender({
            client: new Resend(config.email.apiKey),
            from: config.email.from,
          }),
    webhook: signedWebhookSender({
      secret: config.outboundWebhookSecret ?? "",
      clock: systemClock,
    }),
  });

await start();
