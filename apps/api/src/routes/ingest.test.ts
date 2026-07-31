/**
 * POST /v1/events, over stub ports.
 *
 * The whole endpoint runs here — real routing, real guard, real admission,
 * real coalescer — with no database and no server.
 */

import { describe, expect, test } from "bun:test";
import {
  Entitlement,
  Instant,
  Principal,
  ProjectId,
  Quota,
  WorkspaceId,
  type Placement,
  type QuotaDecision,
} from "@counted/domain";
import { IngestReceiptSchema } from "@counted/contracts";
import type { AppendReceipt, EventWriter, WritableEvent } from "@counted/ports";
import { createApp } from "../server";
import { Coalescer } from "../ingest/coalescer";
import { stubAccess, silentLogger } from "../server.test";
import type { Config, Dependencies } from "../composition";

/**
 * One clock for the whole file, and the fixture events sit just before it.
 *
 * They disagreed at first — a 2023 clock with 2026 events — and nothing
 * noticed, because the skew check was comparing NaN. A fixture whose clock
 * contradicts its own data is exactly the kind of thing a broken check hides.
 */
const NOW = Date.parse("2026-03-17T15:00:00.000Z");

const PRJ = ProjectId("prj_1");
const WS = WorkspaceId("ws_1");
const KEY = "ck_testkey123456";
const placement: Placement = { workspace: WS, project: PRJ };

const ingestPrincipal: Principal = {
  kind: "ingest",
  credential: "cred_1" as never,
  project: PRJ,
  scopes: ["events:write"],
};

const config: Config = { databaseUrl: "postgres://stub", port: 8080, release: "test" };

type Harness = {
  quota?: QuotaDecision;
  writer?: EventWriter;
  principals?: Record<string, Principal>;
};

const recordingWriter = () => {
  const seen: WritableEvent[] = [];
  const stored = new Set<string>();
  const writer: EventWriter = {
    append: async (events): Promise<AppendReceipt> => {
      seen.push(...events);
      const written = events.filter((e) => !stored.has(e.idempotencyKey));
      for (const e of written) stored.add(e.idempotencyKey);
      return {
        accepted: written.length,
        deduplicated: events.length - written.length,
        written: written.map((e) => ({ idempotencyKey: e.idempotencyKey, occurredAt: e.occurredAt })),
        committedAt: Instant.fromEpochMillis(NOW),
      };
    },
  };
  return { writer, seen };
};

const app = (h: Harness = {}) => {
  const writer = h.writer ?? recordingWriter().writer;
  const deps: Dependencies = {
    access: stubAccess({
      principals: h.principals ?? { [KEY]: ingestPrincipal },
      placements: { [PRJ]: placement },
    }),
    log: silentLogger(),
  grants: { issue: (kind: "share" | "claim") => `${kind === "share" ? "st" : "ct"}_stubGrantTokenValue000000` },
  ids: { next: () => "00000000-0000-7000-8000-000000000000" },
    secrets: { issue: () => ({ secret: "", digest: "" as never, prefix: "" as never }), digest: (s) => s as never },
    quota: { decide: async () => h.quota ?? Quota.decide(Entitlement.none(), { used: 0 }) },
    ingest: new Coalescer(writer, { windowMs: 0 }),
    writer,
    store: {
      executeBatch: async () => ({ results: new Map(), stats: { statements: 0, totalMs: 0, coalesced: 0 } }),
      capabilities: () => ({ engine: "stub", approximateDistinct: false, partitioning: "none" }),
    },
    unitOfWork: { transact: async (w: never) => w } as unknown as Dependencies["unitOfWork"],
    clock: { now: () => Instant.fromEpochMillis(NOW) },
    boot: {
      capabilities: {
        engine: "stub",
        approximateDistinct: false,
        partitioning: "declarative",
        serverVersion: "17",
        timescale: false,
        timeZone: "UTC",
      },
      bucketContract: { ok: true, checked: 48 },
    } as Dependencies["boot"],
    config,
    shutdown: async () => {},
  };
  return createApp(deps);
};

const post = (
  body: unknown,
  options: { headers?: Record<string, string>; harness?: Harness; path?: string } = {},
) =>
  app(options.harness).request(options.path ?? "/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, ...options.headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const event = (over: Record<string, unknown> = {}) => ({
  name: "page_view",
  visitId: "1720656000.k3j9x2mp",
  occurredAt: "2026-03-17T14:37:00.000Z",
  ...over,
});

describe("202 means committed", () => {
  test("a valid batch is accepted and the receipt validates", async () => {
    const res = await post({ events: [event()] });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(IngestReceiptSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ accepted: 1, deduplicated: 0, rejected: 0 });
  });

  test("the committedAt is the writer's, so the timestamp is a fact", async () => {
    const body = (await (await post({ events: [event()] })).json()) as { committedAt: string };
    expect(body.committedAt).toBe("2026-03-17T15:00:00.000Z");
  });

  test("the response is written after the rows are", async () => {
    // v1 answered from an in-memory array and flushed on a timer, so a deploy
    // in between lost the events. Here the write is observable before the
    // response exists.
    const recorder = recordingWriter();
    await post({ events: [event(), event({ name: "signup" })] }, { harness: { writer: recorder.writer } });
    expect(recorder.seen).toHaveLength(2);
  });
});

describe("the wire's ISO string becomes a domain Instant", () => {
  // Both halves of a real bug: `occurredAt` arrives as a string and `Instant`
  // is epoch milliseconds. Casting rather than converting compiled fine, made
  // every event on a first request look like a duplicate, and disabled the
  // clock checks entirely because `Number("2026-…")` is NaN — and NaN compares
  // false against everything.
  test("a first submission is stored, not reported as a duplicate", async () => {
    const body = (await (
      await post({ events: [event({ idempotencyKey: "fresh" })] })
    ).json()) as { accepted: number; deduplicated: number; outcomes: { deduplicated?: boolean }[] };
    expect(body.accepted).toBe(1);
    expect(body.deduplicated).toBe(0);
    expect(body.outcomes[0]!.deduplicated).toBe(false);
  });

  test("a timestamp far in the future is refused over HTTP, not just in the domain", async () => {
    const body = (await (
      await post({ events: [event({ occurredAt: "2087-01-01T00:00:00.000Z" })] })
    ).json()) as { outcomes: { accepted: boolean; reason?: string }[] };
    expect(body.outcomes[0]!.accepted).toBe(false);
    expect(body.outcomes[0]!.reason).toContain("future");
  });

  test("a timestamp beyond the ingestion window is refused over HTTP", async () => {
    const body = (await (
      await post({ events: [event({ occurredAt: "2020-01-01T00:00:00.000Z" })] })
    ).json()) as { outcomes: { accepted: boolean; reason?: string }[] };
    expect(body.outcomes[0]!.accepted).toBe(false);
  });

  test("what reaches the writer is epoch milliseconds, not a string", async () => {
    const recorder = recordingWriter();
    await post({ events: [event()] }, { harness: { writer: recorder.writer } });
    expect(typeof recorder.seen[0]!.occurredAt).toBe("number");
    expect(Instant.toISO(recorder.seen[0]!.occurredAt)).toBe("2026-03-17T14:37:00.000Z");
  });
});

describe("per-event outcomes", () => {
  test("one outcome per submitted event, in order", async () => {
    const body = (await (
      await post({ events: [event(), event({ name: "" }), event({ name: "signup" })] })
    ).json()) as { outcomes: { index: number; accepted: boolean }[] };
    expect(body.outcomes.map((o) => o.index)).toEqual([0, 1, 2]);
    expect(body.outcomes.map((o) => o.accepted)).toEqual([true, false, true]);
  });

  test("one bad event does not reject the batch", async () => {
    const res = await post({ events: [event({ name: "" }), event()] });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: 1, rejected: 1 });
  });

  test("a rejection says what is wrong in a sentence", async () => {
    const body = (await (await post({ events: [event({ userId: "a@b.com" })] })).json()) as {
      outcomes: { reason?: string }[];
    };
    expect(body.outcomes[0]!.reason).toContain("opaque identifier");
  });

  test("a resend of the same event is reported as deduplicated, not stored twice", async () => {
    // The conformance property: at-least-once delivery is only safe if a
    // retry is visibly a duplicate.
    const recorder = recordingWriter();
    const harness = { writer: recorder.writer };
    const application = app(harness);
    const body = { events: [event({ idempotencyKey: "k1" })] };
    const send = () =>
      application.request("/v1/events", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
        body: JSON.stringify(body),
      });

    const first = (await (await send()).json()) as { accepted: number; outcomes: { deduplicated?: boolean }[] };
    const second = (await (await send()).json()) as {
      accepted: number;
      deduplicated: number;
      outcomes: { deduplicated?: boolean }[];
    };

    expect(first.outcomes[0]!.deduplicated).toBe(false);
    expect(second.outcomes[0]!.deduplicated).toBe(true);
    expect(second.accepted).toBe(0);
    expect(second.deduplicated).toBe(1);
  });
});

describe("over quota is never a silent success", () => {
  const over = Quota.decide(Entitlement.none(), { used: 10_000_000 });

  test("the events are dropped and the state is named", async () => {
    // v1 returned a byte-identical 202 here and threw the events away.
    const res = await post({ events: [event(), event()] }, { harness: { quota: over } });
    const body = (await res.json()) as { rejected: number; accepted: number; quota: { state: string } };
    expect(body.quota.state).toBe("rejected");
    expect(body.accepted).toBe(0);
    expect(body.rejected).toBe(2);
  });

  test("an over-quota response is distinguishable from a successful one", async () => {
    const ok = await (await post({ events: [event()] })).json();
    const dropped = await (await post({ events: [event()] }, { harness: { quota: over } })).json();
    expect(dropped).not.toEqual(ok);
  });

  test("nothing is handed to the writer", async () => {
    const recorder = recordingWriter();
    await post({ events: [event()] }, { harness: { quota: over, writer: recorder.writer } });
    expect(recorder.seen).toHaveLength(0);
  });

  test("the outcome says why, so the customer knows to change plan not payload", async () => {
    const body = (await (await post({ events: [event()] }, { harness: { quota: over } })).json()) as {
      outcomes: { reason?: string }[];
    };
    expect(body.outcomes[0]!.reason).toContain("allowance");
  });

  test("overage still stores, and still says so", async () => {
    const overage = Quota.decide(Entitlement.none(), { used: 100_001 });
    const body = (await (await post({ events: [event()] }, { harness: { quota: overage } })).json()) as {
      accepted: number;
      quota: { state: string };
    };
    expect(body.accepted).toBe(1);
    expect(body.quota.state).toBe("overage");
  });
});

describe("a write that does not commit is not a 202", () => {
  const failing: EventWriter = {
    append: async () => {
      throw new Error("connection reset");
    },
  };

  test("503 with Retry-After, not a cheerful 202", async () => {
    const res = await post({ events: [event()] }, { harness: { writer: failing } });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
  });

  test("the problem says resending is safe, and why", async () => {
    const body = (await (await post({ events: [event()] }, { harness: { writer: failing } })).json()) as {
      retryable: boolean;
      detail: string;
    };
    expect(body.retryable).toBe(true);
    expect(body.detail).toContain("dedup key");
  });
});

describe("authentication", () => {
  test("no credential is 401 with the discovery challenge", async () => {
    const res = await post({ events: [event()] }, { headers: { authorization: "" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
  });

  test("a public ingest key may travel in the query string, for sendBeacon", async () => {
    // sendBeacon cannot set headers, and it is the only way to record the last
    // event of a session as the page closes.
    const res = await app().request(`/v1/events?key=${KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [event()] }),
    });
    expect(res.status).toBe(202);
  });

  test("a secret key in the query string is refused", async () => {
    // That one would be a real leak into access logs and browser history. An
    // ingest key is already published in the page's own JavaScript.
    const res = await app({ principals: { sk_secret123456: ingestPrincipal } }).request(
      "/v1/events?key=sk_secret123456",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [event()] }) },
    );
    expect(res.status).toBe(401);
  });

  test("a service key cannot post events, even with the scope", async () => {
    // The resource comes from the credential; only an ingest key names a
    // project here.
    const service: Principal = {
      kind: "service",
      credential: "c" as never,
      workspace: WS,
      projects: "all",
      scopes: ["events:write"],
      onBehalfOf: "acc" as never,
    };
    const res = await post({ events: [event()] }, { harness: { principals: { [KEY]: service } } });
    expect(res.status).toBe(403);
  });

  test("a key with no events:write scope is refused", async () => {
    const scopeless: Principal = { ...ingestPrincipal, scopes: [] };
    const res = await post({ events: [event()] }, { harness: { principals: { [KEY]: scopeless } } });
    expect(res.status).toBe(403);
  });

  test("a key whose project no longer exists stops ingesting", async () => {
    // The placement lookup is what catches a deleted or unclaimed project.
    const orphan: Principal = { ...ingestPrincipal, project: ProjectId("prj_gone") };
    const res = await post({ events: [event()] }, { harness: { principals: { [KEY]: orphan } } });
    expect(res.status).toBe(404);
  });
});

describe("malformed input", () => {
  test("invalid JSON is 400, not 500", async () => {
    const res = await post("{not json", {});
    expect(res.status).toBe(400);
  });

  test("a schema failure lists every bad field, not just the first", async () => {
    // Type errors, not business-rule violations — those are per-event and
    // come back as outcomes on a 202.
    const res = await post({ events: [{ name: 7, visitId: "v" }, { name: "ok", visitId: [] }] });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { fields: { path: string }[] };
    expect(body.fields.length).toBeGreaterThanOrEqual(2);
    expect(body.fields.some((f) => f.path.startsWith("events[1]"))).toBe(true);
  });

  test("a business-rule violation is an outcome, not a batch rejection", async () => {
    // The line between the two: the schema guards shape, `admit` guards
    // meaning. An empty name is meaning, so forty-nine good events still land.
    const res = await post({ events: [event({ name: "" }), event()] });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { outcomes: { accepted: boolean; reason?: string }[] };
    expect(body.outcomes[0]).toMatchObject({ accepted: false });
    expect(body.outcomes[0]!.reason).toContain("name is required");
  });

  test("a batch beyond the cap is refused whole, because no outcome can say that", async () => {
    const many = Array.from({ length: 251 }, () => event());
    expect((await post({ events: many })).status).toBe(422);
  });

  test("an empty batch is refused by the schema", async () => {
    expect((await post({ events: [] })).status).toBe(422);
  });

  test("a declared body over the limit is 413", async () => {
    const res = await post({ events: [event()] }, { headers: { "content-length": String(2 * 1024 * 1024) } });
    expect(res.status).toBe(413);
  });
});

describe("what the receipt tells the operator", () => {
  test("an unrecognised platform produces a warning rather than silence", async () => {
    const body = (await (
      await post({ events: [event({ systemProperties: { os_name: "PlayStation 6" } })] })
    ).json()) as { warnings?: { index: number; code: string; detail?: string }[] };
    expect(body.warnings).toContainEqual({ index: 0, code: "platform_unrecognised", detail: "PlayStation 6" });
  });

  test("a clean batch carries no warnings key at all", async () => {
    const body = (await (await post({ events: [event()] })).json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("warnings");
  });

  test("the platform stored is the canonical one", async () => {
    const recorder = recordingWriter();
    await post(
      { events: [event({ systemProperties: { os_name: "Mac OS X" } })] },
      { harness: { writer: recorder.writer } },
    );
    // v1 stored all four spellings, so a breakdown showed macOS four times.
    expect(recorder.seen[0]!.system["os_name"]).toBe("macos");
    expect(recorder.seen[0]!.system["os_name_raw"]).toBe("Mac OS X");
  });

  test("every response carries a request id", async () => {
    const res = await post({ events: [event()] });
    expect(res.headers.get("counted-request-id")).toMatch(/^req_/);
  });
});

describe("identity", () => {
  test("no userId means no person reaches storage", async () => {
    const recorder = recordingWriter();
    await post({ events: [event()] }, { harness: { writer: recorder.writer } });
    expect(recorder.seen[0]!.person).toBeNull();
  });

  test("a userId is carried through as a person", async () => {
    const recorder = recordingWriter();
    await post({ events: [event({ userId: "usr_42" })] }, { harness: { writer: recorder.writer } });
    expect(String(recorder.seen[0]!.person)).toBe("usr_42");
  });
});
