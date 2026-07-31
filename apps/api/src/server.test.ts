/**
 * The API over stub ports.
 *
 * No server is started and no database is touched. That this is possible is
 * the payoff for taking dependencies as an argument rather than importing them
 * — and it is why these run in milliseconds while still exercising the real
 * routing, the real middleware and the real handlers.
 */

import { describe, expect, test } from "bun:test";
import { Instant } from "@counted/domain";
import type { AnalyticalStore, EventWriter } from "@counted/ports";
import { createApp } from "./server";
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
  append: async () => ({ accepted: 0, deduplicated: 0, committedAt: Instant.fromEpochMillis(0) }),
};

const deps = (overrides: Partial<Dependencies> = {}): Dependencies => ({
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
  test("every response carries one", async () => {
    const res = await createApp(deps()).request("/health");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  test("an inbound id is preserved, so a trace survives the hop", async () => {
    const res = await createApp(deps()).request("/health", { headers: { "x-request-id": "trace-abc" } });
    expect(res.headers.get("x-request-id")).toBe("trace-abc");
  });

  test("two requests get different ids", async () => {
    const app = createApp(deps());
    const a = (await app.request("/health")).headers.get("x-request-id");
    const b = (await app.request("/health")).headers.get("x-request-id");
    expect(a).not.toBe(b);
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
