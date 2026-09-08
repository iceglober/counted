/**
 * The proxy, exercised end to end with a stubbed upstream.
 *
 * `forward.test.ts` proves the rules; this proves the handler applies them.
 * The one assertion that matters most is the second: given a request carrying
 * nothing, the upstream request carries nothing. There is no environment
 * variable, no fallback key and no code path in this app that could add one —
 * which is what makes "every console action is reachable by a third party with
 * the right key" a fact about the product rather than a claim about it.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GET, POST } from "./route";

const realFetch = globalThis.fetch;
const realApi = process.env.COUNTED_API_URL;

let seen: Request[] = [];
let answer: (request: Request) => Response = () =>
  new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  seen = [];
  process.env.COUNTED_API_URL = "http://api.test";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    seen.push(request);
    return answer(request);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realApi === undefined) delete process.env.COUNTED_API_URL;
  else process.env.COUNTED_API_URL = realApi;
  answer = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
});

const get = (path: string, headers: Record<string, string> = {}) =>
  GET(new Request(`http://console.test${path}`, { headers }));

describe("what reaches the API", () => {
  test("the /api mount is stripped and the query survives", async () => {
    await get("/api/v1/workspaces/w1/projects?includeArchived=true");
    expect(seen[0]!.url).toBe("http://api.test/v1/workspaces/w1/projects?includeArchived=true");
  });

  test("a caller's cookie is forwarded verbatim", async () => {
    await get("/api/v1/me", { cookie: "counted.session=abc" });
    expect(seen[0]!.headers.get("cookie")).toBe("counted.session=abc");
  });

  test("a request with no credentials produces one with no credentials", async () => {
    await get("/api/v1/me");
    expect(seen[0]!.headers.get("cookie")).toBeNull();
    expect(seen[0]!.headers.get("authorization")).toBeNull();
    expect(seen[0]!.headers.get("x-api-key")).toBeNull();
  });

  test("the console's own host header does not travel", async () => {
    // With it, better-auth resolves its base URL against the console's
    // hostname and issues cookies for an origin it is not serving: sign-in
    // appears to work and leaves no session.
    await get("/api/v1/me", { host: "console.test" });
    // The runtime sets `host` from the destination URL; what must never happen
    // is the console's own value being carried across.
    expect(seen[0]!.headers.get("host")).not.toBe("console.test");
  });

  test("a POST body is passed through", async () => {
    const response = await POST(
      new Request("http://console.test/api/v1/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Acme" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await seen[0]!.json()).toEqual({ name: "Acme" });
  });
});

describe("what the proxy refuses", () => {
  test("a path it does not name is a 404 that never reaches the API", async () => {
    const response = await get("/api/health");
    expect(response.status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  test("the Stripe webhook cannot be relayed", async () => {
    // Re-serializing the body destroys the bytes the signature covers.
    const response = await POST(
      new Request("http://console.test/api/v1/webhooks/stripe", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(404);
    expect(seen).toHaveLength(0);
  });
});

describe("what comes back", () => {
  test("several set-cookie headers survive as several", async () => {
    answer = () => {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "a=1; Path=/");
      headers.append("set-cookie", "b=2; Path=/");
      return new Response("{}", { status: 200, headers });
    };
    const response = await get("/api/auth/get-session");
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  test("a redirect back to the API is rewritten onto the console", async () => {
    answer = () =>
      new Response(null, { status: 302, headers: { location: "http://api.test/api/auth/callback" } });
    const response = await get("/api/auth/sign-in/magic-link");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/api/auth/callback");
  });

  test("an unreachable API is a 503, not an unhandled throw", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const response = await get("/api/v1/me");
    expect(response.status).toBe(503);
  });
});
