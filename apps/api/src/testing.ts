/**
 * Test doubles for the composition root.
 *
 * Deliberately minimal and deliberately loud: anything a test did not set up
 * throws when it is touched, naming the port and the method. A double that
 * returns a plausible empty value instead makes a test pass for the wrong
 * reason, and the tests here are about behaviour that only shows up when a
 * dependency actually answers.
 */

import { Duration, Instant, type AccountId, type CredentialId, type ProjectId, type WorkspaceId } from "@counted/kernel";
import type { Clock, IdGenerator } from "@counted/kernel/ports";
import type { CredentialStore, MembershipDirectory, VerifiedCredential } from "@counted/identity-ports";
import type { AnalyticsEngine, SchemaCatalog } from "@counted/analytics-ports";
import { admitCountry } from "@counted/ingestion-domain";
import type { GeoLocator } from "@counted/ingestion-ports";
import type { ApiConfig } from "./config";
import type { ApiDependencies } from "./deps";
import { silentLogger } from "./logging";

/** A port method nobody wired up. Says which one, so the fix is obvious. */
export const absent = (port: string, method: string): never => {
  throw new Error(`${port}.${method} was called and this test did not provide it`);
};

export const testConfig = (overrides: Partial<ApiConfig> = {}): ApiConfig => ({
  port: 0,
  baseUrl: "https://api.test",
  mcpResource: "https://api.test/mcp",
  consoleUrl: "https://console.test",
  databaseUrl: "postgres://unused",
  segmentCacheBytes: 16 * 1024 * 1024,
  databaseDirectUrl: "postgres://unused",
  authSecret: "test-secret",
  stripe: null,
  email: null,
  social: { github: null, google: null },
  outboundWebhookSecret: null,
  unclaimedWorkspace: "ws_holding" as WorkspaceId,
  unclaimedWorkspaceOwner: "acct_operator" as AccountId,
  claimGrantTtl: Duration.hours(72),
  shareLinkTtl: Duration.days(30),
  queryDeadline: Duration.seconds(10),
  trustedProxyHops: 1,
  logLevel: "error",
  serviceName: "counted-api-test",
  release: "test-release",
  ...overrides,
});

/** A clock that does not move unless a test moves it. */
export const frozenClock = (at: Instant): Clock & { set(next: Instant): void } => {
  let now = at;
  return { now: () => now, set: (next) => { now = next; } };
};

export const countingIds = (prefix = "id"): IdGenerator => {
  let n = 0;
  return { next: () => `${prefix}-${(n += 1)}` };
};

/**
 * A credential store that knows about a fixed set of secrets.
 *
 * `verify` is the only method most tests need; the rest report their absence
 * rather than pretending to succeed, because an issue path that silently
 * "worked" is how a test proves nothing.
 */
export const fixedCredentials = (
  known: Readonly<Record<string, VerifiedCredential>>,
): CredentialStore => ({
  verify: async (secret) => {
    const found = known[secret];
    return found === undefined
      ? { ok: false, error: { kind: "Unknown" } }
      : { ok: true, value: found };
  },
  issue: async () => absent("CredentialStore", "issue"),
  rotate: async () => absent("CredentialStore", "rotate"),
  revoke: async () => absent("CredentialStore", "revoke"),
  list: async () => absent("CredentialStore", "list"),
  reassignProject: async () => absent("CredentialStore", "reassignProject"),
});

export const fixedMemberships = (
  roles: Readonly<Record<string, import("@counted/kernel").Role>>,
): MembershipDirectory => ({
  roleOf: async (account, workspace) => roles[`${account}@${workspace}`] ?? null,
  membersOf: async () => [],
});

/** An engine every query fails against, unless a test replaces a method. */
export const unavailableEngine = (
  overrides: Partial<AnalyticsEngine> = {},
): AnalyticsEngine => ({
  counts: async () => ({ ok: false, error: { kind: "Unavailable", detail: "no engine" } }),
  uniques: async () => ({ ok: false, error: { kind: "Unavailable", detail: "no engine" } }),
  sums: async () => ({ ok: false, error: { kind: "Unavailable", detail: "no engine" } }),
  countsBy: async () => ({ ok: false, error: { kind: "Unavailable", detail: "no engine" } }),
  uniquesBy: async () => ({ ok: false, error: { kind: "Unavailable", detail: "no engine" } }),
  sumsBy: async () => ({ ok: false, error: { kind: "Unavailable", detail: "no engine" } }),
  funnel: async () => ({ ok: false, error: { kind: "Unavailable", detail: "no engine" } }),
  retention: async () => ({ ok: false, error: { kind: "NotImplemented", feature: "retention" } }),
  ...overrides,
});

export const fixedCatalog = (
  overrides: Partial<SchemaCatalog> = {},
): SchemaCatalog => ({
  eventNames: async () => [],
  dimensions: async () => ["event_type", "os_name", "locale"],
  dimensionValues: async () => [],
  measures: async () => [],
  ...overrides,
});

/**
 * A dependency bundle where everything not supplied throws.
 *
 * `Proxy` rather than a hand-written stub per port, so a test that reaches a
 * port it did not set up fails with the port's name instead of a
 * `Cannot read properties of undefined`.
 */
const throwingPort = <T extends object>(name: string): T =>
  new Proxy({} as T, {
    get: (_target, property) => () => absent(name, String(property)),
  });

/**
 * A locator that knows exactly the addresses a test names, and nothing else.
 *
 * A value rather than a throwing port — unlike the repositories above — because
 * a geo lookup is not the subject of any test that does not say so, and an
 * address it has never heard of has a correct answer: `null`, "we could not
 * place this". A throw here would make every ingest test declare a geography it
 * does not care about.
 */
export const fixedGeo = (known: Readonly<Record<string, string>> = {}): GeoLocator => ({
  countryOf: (address) => admitCountry(known[address]),
});

export type DependencyOverrides = Partial<ApiDependencies>;

export const testDependencies = (overrides: DependencyOverrides = {}): ApiDependencies => {
  const clock = overrides.clock ?? frozenClock(Instant.fromEpochMillis(1_700_000_000_000));
  return {
    config: testConfig(),
    logger: silentLogger,
    clock,
    ids: countingIds(),
    identity: {
      accounts: throwingPort("AccountDirectory"),
      memberships: throwingPort("MembershipDirectory"),
      credentials: throwingPort("CredentialStore"),
      workspaces: throwingPort("WorkspaceProvisioner"),
      http: throwingPort("IdentityHttp"),
    } as ApiDependencies["identity"],
    uow: { transact: async () => absent("UnitOfWork", "transact") },
    reads: {
      workspaces: throwingPort("WorkspaceRepository"),
      subscriptions: throwingPort("SubscriptionRepository"),
      webhooks: throwingPort("WebhookLedger"),
      projects: throwingPort("ProjectRepository"),
      dashboards: throwingPort("DashboardRepository"),
      monitors: throwingPort("MonitorRepository"),
      outbox: throwingPort("Outbox"),
    },
    engine: unavailableEngine(),
    catalog: fixedCatalog(),
    shareTokens: {
      mint: async () => ({ token: "share-token", digest: "share-digest" }),
      digest: async (token) => `${token}-digest`,
    },
    billing: null,
    sink: { writeBatch: async () => absent("EventSink", "writeBatch") },
    quota: {
      check: async () => ({ kind: "Allowed", remaining: null }),
      record: async () => {},
    },
    geo: fixedGeo(),
    notifier: { deliver: async () => {} },
    ...overrides,
  };
};

export const ingestCredential = (
  project: ProjectId,
  workspace: WorkspaceId,
): VerifiedCredential => ({
  id: "cred_ingest" as CredentialId,
  kind: "ingest",
  workspace,
  project,
  permissions: ["events:write"],
  issuedBy: "acct_owner" as AccountId,
});
