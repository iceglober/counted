/**
 * The ingest contract: a 2xx means the events are durable, and nothing else
 * does.
 *
 * v1's ingest returned 202 with an empty body whether it had written the batch
 * or dropped it past a quota — byte-identical responses for "stored" and
 * "discarded" — so the SDK moved on either way and the customer's data was gone
 * with no signal. Every test here is about the answer being distinguishable.
 */

import { describe, expect, test } from "bun:test";
import { Duration, Instant, type ProjectId, type WorkspaceId } from "@counted/kernel";
import type { Ack, GroupCommit } from "@counted/ingestion-app";
import type { IngestBatch } from "@counted/ingestion-domain";
import { UNOWNED_WORKSPACE, handleIngest, ingestKeyOf, type IngestDeps } from "./route";
import { fixedCredentials, fixedGeo, ingestCredential } from "../testing";
import { silentLogger } from "../logging";
import { IngestFailureSchema, IngestReceiptSchema, IngestRequestSchema, INGESTION_PATHS } from "@counted/contract";
import { admit } from "@counted/ingestion-domain";

const AT = Instant.fromEpochMillis(1_700_000_000_000);
const PROJECT = "pr_1" as ProjectId;
const WORKSPACE = "ws_1" as WorkspaceId;

const committing = (ack: Ack, seen: { batch?: unknown } = {}): GroupCommit =>
  ({
    submit: async (batch: unknown) => {
      seen.batch = batch;
      return ack;
    },
  }) as unknown as GroupCommit;

const committed = (accepted: number): Ack => ({
  kind: "Committed",
  accepted,
  deduplicated: 0,
  rejected: [],
  commit: { size: accepted, written: accepted, deduplicated: 0 },
});

const deps = (overrides: Partial<IngestDeps> = {}): IngestDeps => ({
  credentials: fixedCredentials({ ck_good: ingestCredential(PROJECT, WORKSPACE) }),
  commit: committing(committed(1)),
  projectWorkspace: async () => WORKSPACE,
  logger: silentLogger,
  maxBodyBytes: 1000,
  geo: fixedGeo({ "203.0.113.7": "NZ", "198.51.100.4": "JP" }),
  trustedProxyHops: 1,
  ...overrides,
});

const post = (body: unknown, headers: Record<string, string> = {}, url = "http://api/v1/events") =>
  new Request(url, { method: "POST", headers, body: JSON.stringify(body) });

describe("the published ingestion schemas match admission and HTTP receipts", () => {
  test("the documented example is admitted and returns the documented receipt shape", async () => {
    const body = INGESTION_PATHS["/v1/events"].post.requestBody.content["application/json"].example;
    expect(IngestRequestSchema.safeParse(body).success).toBe(true);
    const seen: { batch?: IngestBatch } = {};
    const reply = await handleIngest(deps({ commit: committing(committed(1), seen) }), post(body, { authorization: "Bearer ck_good" }), AT);
    const admitted = admit(seen.batch!);
    expect(admitted.ok && admitted.value.admitted.length).toBe(1);
    expect(reply.status).toBe(202);
    expect(IngestReceiptSchema.safeParse(reply.body).success).toBe(true);
  });

  test("partial rejections are outcomes inside a 202 and retain the original array index", async () => {
    const batch: IngestBatch = { workspace: WORKSPACE, project: PROJECT, receivedAt: AT,
      country: null, bytes: null, events: [{ name: "page_view", visitId: "ephemeral" }, { name: "bad name", visitId: "ephemeral" }] };
    const checked = admit(batch);
    if (!checked.ok) throw new Error("fixture should pass batch admission");
    const ack: Ack = { ...committed(checked.value.admitted.length), rejected: checked.value.rejected };
    const reply = await handleIngest(deps({ commit: committing(ack) }), post({ events: batch.events }, { authorization: "Bearer ck_good" }), AT);
    expect(reply.status).toBe(202);
    expect(IngestReceiptSchema.parse(reply.body)).toEqual({ accepted: 1, deduplicated: 0, rejected: 1,
      outcomes: [{ index: 1, accepted: false, reason: "MalformedEvent" }] });
  });

  test("unauthorized and quota failures conform without masquerading as receipts", async () => {
    const unauthorized = await handleIngest(deps(), post({ events: [] }), AT);
    expect(IngestFailureSchema.safeParse(unauthorized.body).success).toBe(true);
    expect(IngestReceiptSchema.safeParse(unauthorized.body).success).toBe(false);
    const quota = await handleIngest(deps({ commit: committing({ kind: "Refused", error: { kind: "PlanExceeded", used: 100, limit: 100 }, rejected: [] }) }), post({ events: [] }, { authorization: "Bearer ck_good" }), AT);
    expect(quota.status).toBe(402);
    expect(IngestFailureSchema.parse(quota.body)).toMatchObject({ retryable: false, reason: "PlanExceeded" });
  });

  test("body limits count UTF-8 bytes rather than JavaScript string characters", async () => {
    const payload = { events: [{ name: "page_view", visitId: "ephemeral", properties: { label: "😀".repeat(20) } }] };
    const json = JSON.stringify(payload);
    const reply = await handleIngest(deps({ maxBodyBytes: json.length }), post(payload, { authorization: "Bearer ck_good" }), AT);
    expect(reply.status).toBe(413);
    expect(IngestFailureSchema.parse(reply.body)).toMatchObject({ reason: "PayloadTooLarge", bytes: new TextEncoder().encode(json).byteLength });
  });
});

describe("presenting a key", () => {
  test("the SDK's Authorization header is accepted", () => {
    expect(ingestKeyOf(post({}, { authorization: "Bearer ck_good" }))).toBe("ck_good");
  });

  /**
   * `navigator.sendBeacon` cannot set headers, so the SDK puts the key in the
   * query on page unload. Refusing that loses the last events of every session.
   */
  test("the beacon's query parameter is accepted", () => {
    expect(ingestKeyOf(post({}, {}, "http://api/v1/events?key=ck_good"))).toBe("ck_good");
  });

  test("no key at all is 401 with no detail", async () => {
    const outcome = await handleIngest(deps(), post({ events: [] }), AT);
    expect(outcome.status).toBe(401);
  });

  test("an unknown key is the same 401 as a revoked one", async () => {
    const outcome = await handleIngest(
      deps(),
      post({ events: [] }, { authorization: "Bearer ck_nope" }),
      AT,
    );
    expect(outcome.status).toBe(401);
    expect(JSON.stringify(outcome.body)).not.toContain("revoked");
  });

  test("a rate-limited key gets a retry-after header, not a 401", async () => {
    const outcome = await handleIngest(
      deps({
        credentials: {
          ...fixedCredentials({}),
          verify: async () => ({
            ok: false,
            error: { kind: "RateLimited", retryAfter: Duration.seconds(30) },
          }),
        },
      }),
      post({ events: [] }, { authorization: "Bearer whatever" }),
      AT,
    );
    expect(outcome.status).toBe(429);
    expect(outcome.headers["retry-after"]).toBe("30");
  });

  /**
   * A real credential that cannot write events is a 403, not a 401: the caller
   * should stop retrying with it rather than go and fetch a new one.
   */
  test("a credential without events:write is 403", async () => {
    const outcome = await handleIngest(
      deps({
        credentials: fixedCredentials({
          sk_read: { ...ingestCredential(PROJECT, WORKSPACE), kind: "service", permissions: ["projects:read"] },
        }),
      }),
      post({ events: [] }, { authorization: "Bearer sk_read" }),
      AT,
    );
    expect(outcome.status).toBe(403);
  });
});

describe("the batch", () => {
  test("the project and workspace come from the credential, never from the body", async () => {
    const seen: { batch?: { project: ProjectId; workspace: WorkspaceId } } = {};
    await handleIngest(
      deps({ commit: committing(committed(1), seen as never) }),
      post(
        { events: [{ name: "x" }], project: "pr_someone_else", workspace: "ws_someone_else" },
        { authorization: "Bearer ck_good" },
      ),
      AT,
    );
    expect(seen.batch?.project).toBe(PROJECT);
    expect(seen.batch?.workspace).toBe(WORKSPACE);
  });

  /**
   * An unclaimed project has no workspace and `IngestBatch.workspace` is not
   * nullable, so a sentinel travels in its place and the quota recognises it.
   * The alternative — refusing ingest until a project is claimed — is the
   * no-signup path not working, which is the whole feature.
   */
  test("an unclaimed project's events carry the unowned sentinel", async () => {
    const seen: { batch?: { workspace: WorkspaceId } } = {};
    await handleIngest(
      deps({
        projectWorkspace: async () => null,
        commit: committing(committed(1), seen as never),
      }),
      post({ events: [{ name: "x" }] }, { authorization: "Bearer ck_good" }),
      AT,
    );
    expect(seen.batch?.workspace).toBe(UNOWNED_WORKSPACE);
  });

  test("a body that is not JSON is refused without a retry", async () => {
    const outcome = await handleIngest(
      deps(),
      new Request("http://api/v1/events", {
        method: "POST",
        headers: { authorization: "Bearer ck_good" },
        body: "{not json",
      }),
      AT,
    );
    expect(outcome.status).toBe(400);
    expect((outcome.body as { retryable: boolean }).retryable).toBe(false);
  });

  test("a body without an events array is refused", async () => {
    const outcome = await handleIngest(
      deps(),
      post({ event: { name: "x" } }, { authorization: "Bearer ck_good" }),
      AT,
    );
    expect(outcome.status).toBe(400);
  });

  /**
   * Measured at the socket, before parsing. Re-serialising the parsed body to
   * count its bytes measures our serialiser, not what the client sent.
   */
  test("an oversized body is 413 and not retried", async () => {
    const outcome = await handleIngest(
      deps({ maxBodyBytes: 10 }),
      post({ events: [{ name: "a".repeat(100) }] }, { authorization: "Bearer ck_good" }),
      AT,
    );
    expect(outcome.status).toBe(413);
    expect((outcome.body as { retryable: boolean }).retryable).toBe(false);
  });
});

describe("the acknowledgement", () => {
  test("a commit answers 202 with the receipt the SDK reads", async () => {
    const outcome = await handleIngest(
      deps({ commit: committing(committed(3)) }),
      post({ events: [{ name: "x" }] }, { authorization: "Bearer ck_good" }),
      AT,
    );
    expect(outcome.status).toBe(202);
    expect(outcome.body).toEqual({ accepted: 3, deduplicated: 0, rejected: 0 });
  });

  /**
   * Per-event rejections ride in the body of a 2xx, because the rest of the
   * batch did land and no status can say "eleven of twelve". `outcomes` is what
   * stops the SDK resending the three it got wrong.
   */
  test("rejected events are named in the body of a successful commit", async () => {
    const outcome = await handleIngest(
      deps({
        commit: committing({
          kind: "Committed",
          accepted: 1,
          deduplicated: 0,
          rejected: [{ index: 1, error: { kind: "PersonIdRequired" } }],
          commit: { size: 1, written: 1, deduplicated: 0 },
        }),
      }),
      post({ events: [{ name: "x" }, { name: "y" }] }, { authorization: "Bearer ck_good" }),
      AT,
    );
    expect(outcome.status).toBe(202);
    expect(outcome.body).toMatchObject({
      accepted: 1,
      rejected: 1,
      outcomes: [{ index: 1, accepted: false, reason: "PersonIdRequired" }],
    });
  });

  /**
   * The two refusals a customer acts on differently: upgrade versus back off.
   * v1 answered both with 429 and produced a customer who retried for two days
   * against a quota that was never going to move.
   */
  test("a plan cap is 402 and not retryable; a rate limit is 429 and is", async () => {
    const capped = await handleIngest(
      deps({
        commit: committing({
          kind: "Refused",
          error: { kind: "PlanExceeded", limit: 100, used: 200 },
          rejected: [],
        }),
      }),
      post({ events: [{ name: "x" }] }, { authorization: "Bearer ck_good" }),
      AT,
    );
    const limited = await handleIngest(
      deps({
        commit: committing({
          kind: "Refused",
          error: { kind: "RateLimited", retryAfterMs: 2000 },
          rejected: [],
        }),
      }),
      post({ events: [{ name: "x" }] }, { authorization: "Bearer ck_good" }),
      AT,
    );

    expect(capped.status).toBe(402);
    expect((capped.body as { retryable: boolean }).retryable).toBe(false);
    expect(limited.status).toBe(429);
    expect((limited.body as { retryable: boolean }).retryable).toBe(true);
    expect(limited.headers["retry-after"]).toBe("2");
  });

  test("a sink failure is 503 and retryable — the client still holds the events", async () => {
    const outcome = await handleIngest(
      deps({
        commit: committing({
          kind: "Refused",
          error: { kind: "SinkUnavailable", detail: "down" },
          rejected: [],
        }),
      }),
      post({ events: [{ name: "x" }] }, { authorization: "Bearer ck_good" }),
      AT,
    );
    expect(outcome.status).toBe(503);
    expect((outcome.body as { retryable: boolean }).retryable).toBe(true);
  });

  test("a key naming a project that no longer exists is 404, not 401", async () => {
    const outcome = await handleIngest(
      deps({ projectWorkspace: async () => undefined }),
      post({ events: [] }, { authorization: "Bearer ck_good" }),
      AT,
    );
    expect(outcome.status).toBe(404);
  });
});

/**
 * Geography is derived here and the address stops here.
 *
 * The batch carries two letters or nothing. It has no field an address could
 * sit in, which is the property that makes "no IP storage" true by
 * construction rather than by everyone remembering — but the derivation still
 * has to be right, and it is the one place in the API that reads an address at
 * all.
 */
describe("country is derived from the connection, and the address is not kept", () => {
  const submitted = async (headers: Record<string, string>, overrides: Partial<IngestDeps> = {}) => {
    const seen: { batch?: unknown } = {};
    await handleIngest(
      deps({ commit: committing(committed(1), seen), ...overrides }),
      post({ events: [{ name: "x", visitId: "1770000000.abcd1234" }] }, {
        authorization: "Bearer ck_good",
        ...headers,
      }),
      AT,
    );
    return seen.batch as IngestBatch;
  };

  test("the batch carries the country of the forwarded address", async () => {
    const batch = await submitted({ "x-forwarded-for": "203.0.113.7" });
    expect(batch.country).toBe("NZ" as never);
  });

  test("the batch carries no address, in any field", async () => {
    const batch = await submitted({ "x-forwarded-for": "203.0.113.7" });
    // The type has no place for one; this is the runtime statement of the same
    // thing, and it would catch an address smuggled into a field that is
    // `unknown` on the wire.
    expect(JSON.stringify(batch)).not.toContain("203.0.113.7");
  });

  test("a forged leading entry does not choose the country", async () => {
    // `198.51.100.4` is JP in this test's locator and `203.0.113.7` is NZ. The
    // caller put JP at the front; the proxy appended the address it saw.
    const batch = await submitted({ "x-forwarded-for": "198.51.100.4, 203.0.113.7" });
    expect(batch.country).toBe("NZ" as never);
  });

  test("no header means no country, and the batch still lands", async () => {
    const batch = await submitted({});
    expect(batch.country).toBeNull();
    expect(batch.events).toHaveLength(1);
  });

  test("an address the locator cannot place is null, not a refusal", async () => {
    const batch = await submitted({ "x-forwarded-for": "10.0.0.1" });
    expect(batch.country).toBeNull();
  });

  test("zero trusted hops derives nothing, whatever the header says", async () => {
    const batch = await submitted({ "x-forwarded-for": "203.0.113.7" }, { trustedProxyHops: 0 });
    expect(batch.country).toBeNull();
  });

  test("a locator that throws costs the slice, not the batch — and does not log the address", async () => {
    // The bundled locator cannot fail; this is the rule for whatever replaces
    // it. `normaliseSystemProperties` follows the same one: a broken dimension
    // costs the event its dimension, not its existence.
    const lines: string[] = [];
    const seen: { batch?: unknown } = {};
    const outcome = await handleIngest(
      deps({
        commit: committing(committed(1), seen),
        geo: {
          countryOf: () => {
            throw new Error("locator exploded on 203.0.113.7");
          },
        },
        logger: { ...silentLogger, warn: (message, fields) => lines.push(`${message} ${JSON.stringify(fields)}`) },
      }),
      post({ events: [{ name: "x", visitId: "1770000000.abcd1234" }] }, {
        authorization: "Bearer ck_good",
        "x-forwarded-for": "203.0.113.7",
      }),
      AT,
    );
    expect(outcome.status).toBe(202);
    expect((seen.batch as IngestBatch).country).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("country lookup failed");
    // The error path is where a discard is easiest to break, because somebody
    // reasonably wants to know which input failed. It must still not say.
    expect(lines[0]).not.toContain("203.0.113.7");
  });
});
