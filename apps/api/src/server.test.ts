/**
 * The API over stub ports.
 *
 * No server is started and no database is touched. That this is possible is
 * the payoff for taking dependencies as an argument rather than importing them
 * — and it is why these run in milliseconds while still exercising the real
 * routing, the real middleware and the real handlers.
 */

import { describe, expect, test } from "bun:test";
import { Entitlement, Instant, Principal, Quota, type Placement, type Resource, type Role } from "@counted/domain";
import type { AccessResolver, AnalyticalStore, EventWriter, SecretGenerator } from "@counted/ports";
import { createApp, REQUEST_ID_HEADER } from "./server";
import { createLogger } from "./http/log";
import { Coalescer } from "./ingest/coalescer";
import { configFromEnv, type Config, type Dependencies } from "./composition";

const config: Config = { databaseUrl: "postgres://stub", port: 8080, release: "test-release" };

const stubStore = (overrides: Partial<AnalyticalStore> = {}): AnalyticalStore => ({
  executeBatch: async () => ({
    results: new Map(),
    stats: { statements: 0, totalMs: 0, coalesced: 0 },
  }),
  capabilities: () => ({ engine: "postgres 17.10", approximateDistinct: false, partitioning: "declarative" }),
  ...overrides,
});

const stubWriter: EventWriter = {
  append: async () => ({ accepted: 0, deduplicated: 0, written: [], committedAt: Instant.fromEpochMillis(0) }),
};

/**
 * An access resolver that answers from maps rather than from SQL.
 *
 * Every authorization rule is therefore exercised here with no database, which
 * is the point of the port — and the reason the guard's behaviour is asserted
 * in milliseconds rather than against a container.
 */
export const stubAccess = (
  over: {
    principals?: Record<string, Principal>;
    placements?: Record<string, Placement>;
    roles?: Record<string, Role>;
  } = {},
): AccessResolver => ({
  principalFor: async (presented) => over.principals?.[presented.digest] ?? Principal.ANONYMOUS,
  placementOf: async (resource: Resource) => over.placements?.[resource.id] ?? null,
  roleOf: async (account, workspace) => over.roles?.[`${workspace}:${account}`] ?? null,
});

/** Digest that is just the secret, so a test can name a principal readably. */
const stubSecrets: SecretGenerator = {
  issue: (kind) => ({ secret: `${kind}_x`, digest: `${kind}_x` as never, prefix: `${kind}_x` as never }),
  digest: (secret) => secret as never,
};

/** A logger that discards. Tests that care about output supply their own sink. */
export const silentLogger = () => createLogger({ service: "api", sink: () => {} });

const deps = (overrides: Partial<Dependencies> = {}): Dependencies => ({
  access: stubAccess(),
  log: silentLogger(),
  ids: { next: () => "00000000-0000-7000-8000-000000000000" },
  quota: { decide: async () => Quota.decide(Entitlement.none(), { used: 0 }) },
  ingest: new Coalescer(stubWriter, { windowMs: 0 }),
  secrets: stubSecrets,
  store: stubStore(),
  writer: stubWriter,
  unitOfWork: { transact: async (work: never) => work } as unknown as Dependencies["unitOfWork"],
  clock: { now: () => Instant.fromEpochMillis(1_700_000_000_000) },
  boot: {
    capabilities: {
      engine: "postgres 17.10",
      approximateDistinct: false,
      partitioning: "declarative",
      serverVersion: "17.10",
      timescale: false,
      timeZone: "UTC",
    },
    bucketContract: { ok: true, checked: 48 },
  },
  config,
  shutdown: async () => undefined,
  ...overrides,
});

describe("configuration", () => {
  test("a missing DATABASE_URL fails at boot, not at the first query", () => {
    // A deployment mistake should look like one.
    expect(() => configFromEnv({})).toThrow("DATABASE_URL is required");
    expect(() => configFromEnv({ DATABASE_URL: "" })).toThrow("DATABASE_URL is required");
  });

  test("port and release have defaults", () => {
    const c = configFromEnv({ DATABASE_URL: "postgres://x" });
    expect(c.port).toBe(8080);
    expect(c.release).toBe("dev");
  });

  test("the release falls back to the deploy commit", () => {
    expect(configFromEnv({ DATABASE_URL: "postgres://x", RAILWAY_GIT_COMMIT_SHA: "abc123" }).release).toBe("abc123");
  });
});

describe("liveness", () => {
  test("it answers without touching the store", async () => {
    let touched = false;
    const app = createApp(
      deps({
        store: stubStore({
          executeBatch: async () => {
            touched = true;
            return { results: new Map(), stats: { statements: 0, totalMs: 0, coalesced: 0 } };
          },
        }),
      }),
    );

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    // v1 checked the database here, so a slow database looked like a dead
    // process and orchestrators restarted healthy containers.
    expect(touched).toBe(false);

    const body = (await res.json()) as { status: string; release: string };
    expect(body.status).toBe("ok");
    expect(body.release).toBe("test-release");
  });
});

describe("readiness", () => {
  test("it reports what the store actually is", async () => {
    const res = await createApp(deps()).request("/health/ready");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      store: { engine: string; partitioning: string; timescale: boolean };
      bucketContract: { verified: boolean; samples: number };
    };
    expect(body.status).toBe("ready");
    expect(body.store.engine).toContain("postgres");
    expect(body.store.partitioning).toBe("declarative");
    expect(body.store.timescale).toBe(false);
    // "Why does this chart look odd?" is far easier to answer six months on
    // when the deployment can say what it verified at boot.
    expect(body.bucketContract).toEqual({ verified: true, samples: 48 });
  });

  test("it leaks no connection string and no secret", async () => {
    const res = await createApp(deps()).request("/health/ready");
    const text = await res.text();
    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("stub");
    expect(text.toLowerCase()).not.toContain("password");
  });

  test("an unavailable store is 503, not 200 with a sad message", async () => {
    const app = createApp(
      deps({
        store: stubStore({
          executeBatch: async () => {
            throw new Error("pool exhausted");
          },
        }),
      }),
    );
    const res = await app.request("/health/ready");
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe("unavailable");
  });
});

describe("request ids", () => {
  const idOf = (res: Response) => res.headers.get(REQUEST_ID_HEADER);

  test("every response carries one", async () => {
    const res = await createApp(deps()).request("/health");
    expect(idOf(res)).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test("the header is exposed, or a browser client cannot read it", async () => {
    // A support tool the SDK cannot see is not a support tool.
    const res = await createApp(deps()).request("/health");
    expect(res.headers.get("access-control-expose-headers")).toContain(REQUEST_ID_HEADER);
  });

  test("an inbound id is preserved, so a trace survives the hop", async () => {
    const supplied = "req_01J8ZQ5S0000000000000000AB";
    const res = await createApp(deps()).request("/health", { headers: { [REQUEST_ID_HEADER]: supplied } });
    expect(idOf(res)).toBe(supplied);
  });

  test("an inbound id that is not one of ours is replaced, not trusted", async () => {
    // Otherwise a client sets it to a fixed string and every request in the
    // logs collides onto one id. (A newline — writing your own log lines — is
    // refused by the HTTP layer before it reaches us: `Headers` rejects the
    // value outright, so there is nothing here to test.)
    for (const junk of ["trace-abc", "req_short", "../../etc", "req_lowercaseabcdefghijklmn"]) {
      const res = await createApp(deps()).request("/health", { headers: { [REQUEST_ID_HEADER]: junk } });
      expect(idOf(res)).not.toBe(junk);
      expect(idOf(res)).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  test("two requests get different ids", async () => {
    const app = createApp(deps());
    const a = idOf(await app.request("/health"));
    const b = idOf(await app.request("/health"));
    expect(a).not.toBe(b);
  });

  test("ids sort by arrival, because the timestamp leads", async () => {
    const app = createApp(deps());
    const first = idOf(await app.request("/health"))!;
    await Bun.sleep(2);
    const second = idOf(await app.request("/health"))!;
    expect(second > first).toBe(true);
  });
});

describe("trace context", () => {
  test("a valid traceparent is joined rather than replaced", async () => {
    const app = createApp(deps());
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const lines: string[] = [];
    const withLog = deps({ log: createLogger({ service: "api", sink: (l) => lines.push(l) }) });
    await createApp(withLog).request("/health", {
      headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
    });
    expect(lines.some((l) => (JSON.parse(l) as { traceId?: string }).traceId === traceId)).toBe(true);
    expect(app).toBeDefined();
  });

  test("a malformed traceparent starts a new trace instead of failing the request", async () => {
    // A broken header from some intermediary must never be able to take an
    // endpoint down.
    for (const header of ["garbage", "00-000-0-01", "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"]) {
      const res = await createApp(deps()).request("/health", { headers: { traceparent: header } });
      expect(res.status).toBe(200);
    }
  });
});

describe("unknown routes", () => {
  test("404 comes back as problem+json-shaped JSON, not HTML", async () => {
    const res = await createApp(deps()).request("/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { title: string; status: number; detail: string };
    expect(body.title).toBe("Not Found");
    expect(body.status).toBe(404);
    expect(body.detail).toContain("/nope");
  });
});
