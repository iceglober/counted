/**
 * The invariants that hold for every failure, asserted over the whole
 * registry rather than over the handful of routes that exist today.
 *
 * That is the difference between "we remembered on these endpoints" and
 * "there is no way to emit a 401 without the discovery header" — which is what
 * the issue asks for, and what v1 did not have: it emitted the header the
 * product documents from exactly one route.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { ERROR_CODES, ProblemSchema, definitionOf, type ErrorCode } from "@counted/contracts";
import type { ApiEnv } from "../server";
import { sendProblem } from "./respond";

const REQUEST_ID = "req_01J8ZQ5S0000000000000000AB";

/** Every code, sent through the real responder, over a real Hono context. */
const respond = async (code: ErrorCode, options: Parameters<typeof sendProblem>[2] = {}) => {
  const app = new Hono<ApiEnv>();
  app.use("*", async (c, next) => {
    c.set("requestId", REQUEST_ID);
    await next();
  });
  app.get("/v1/thing", (c) => sendProblem(c, code, options));
  const res = await app.request("/v1/thing");
  return { res, body: (await res.json()) as Record<string, unknown> };
};

describe("every failure, for every code in the registry", () => {
  test("is sent as application/problem+json, never as plain json", async () => {
    for (const code of ERROR_CODES) {
      const { res } = await respond(code);
      expect({ code, type: res.headers.get("content-type") }).toMatchObject({
        type: expect.stringContaining("application/problem+json"),
      });
    }
  });

  test("carries the status its code declares", async () => {
    // A route cannot answer 403 with a body that says 404, because neither is
    // a parameter — both come from the code.
    for (const code of ERROR_CODES) {
      const { res, body } = await respond(code);
      expect({ code, status: res.status }).toEqual({ code, status: definitionOf(code).status });
      expect(body["status"]).toBe(res.status);
    }
  });

  test("validates against the published schema", async () => {
    for (const code of ERROR_CODES) {
      const { body } = await respond(code);
      expect({ code, ok: ProblemSchema.safeParse(body).success }).toEqual({ code, ok: true });
    }
  });

  test("carries the request id, so every failure is traceable", async () => {
    for (const code of ERROR_CODES) {
      const { body } = await respond(code);
      expect(body["requestId"]).toBe(REQUEST_ID);
    }
  });

  test("names the path that failed", async () => {
    for (const code of ERROR_CODES) {
      const { body } = await respond(code);
      expect(body["instance"]).toBe("/v1/thing");
    }
  });
});

describe("WWW-Authenticate on every 401, without exception", () => {
  test("every 401-producing code emits the discovery challenge", async () => {
    // Asserted across the registry rather than per route: there is no other
    // way to produce a 401, so adding a new one cannot omit the header.
    const unauthorized = ERROR_CODES.filter((c) => definitionOf(c).status === 401);
    expect(unauthorized.length).toBeGreaterThan(0);

    for (const code of unauthorized) {
      const { res } = await respond(code);
      const challenge = res.headers.get("www-authenticate") ?? "";
      expect({ code, challenge }).toMatchObject({ challenge: expect.stringContaining('Bearer realm="counted"') });
      // RFC 9728 discovery — the thing the product documents.
      expect(challenge).toContain("resource_metadata=");
    }
  });

  test("the missing scope is named in the challenge when one is known", async () => {
    const { res } = await respond("auth.unauthenticated", { scope: "queries:run" });
    expect(res.headers.get("www-authenticate")).toContain('scope="queries:run"');
  });

  test("no other status carries the header", async () => {
    // It is a challenge to authenticate. On a 403 the caller already did.
    for (const code of ERROR_CODES) {
      if (definitionOf(code).status === 401) continue;
      const { res } = await respond(code);
      expect({ code, header: res.headers.get("www-authenticate") }).toEqual({ code, header: null });
    }
  });
});

describe("Retry-After is sent whenever the body promises one", () => {
  test("the header mirrors the field", async () => {
    const { res, body } = await respond("rate.limited", { retryAfter: 30 });
    expect(res.headers.get("retry-after")).toBe("30");
    expect(body["retryAfter"]).toBe(30);
  });

  test("no header when the body does not carry one", async () => {
    const { res } = await respond("rate.limited");
    expect(res.headers.get("retry-after")).toBeNull();
  });
});

describe("retryable is stated, so an SDK never has to guess", () => {
  test("every response says whether resending could help", async () => {
    for (const code of ERROR_CODES) {
      const { body } = await respond(code);
      expect({ code, retryable: typeof body["retryable"] }).toEqual({ code, retryable: "boolean" });
    }
  });

  test("two 429s disagree, which is why the flag exists", async () => {
    // A rate limit clears on its own; a monthly quota does not. v1's SDKs
    // retried any non-2xx, so an over-quota batch was resent four times.
    expect((await respond("rate.limited")).body["retryable"]).toBe(true);
    expect((await respond("quota.exceeded")).body["retryable"]).toBe(false);
  });
});
