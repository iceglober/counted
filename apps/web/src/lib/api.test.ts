/**
 * The one client, over a stub fetch.
 *
 * What is worth testing is the part that is derived rather than written: that
 * a call is addressed by an operation name the contract knows, that the path
 * is built from the contract's own template, and that the cache tags come out
 * of the contract instead of a map in the UI.
 */

import { describe, expect, test } from "bun:test";
import { ApiError, createClient } from "./api";

type Captured = { url: string; method: string; headers: Record<string, string>; body: string | null };

const stub = (
  respond: (request: Captured) => Response = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
) => {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: URL | string, init: RequestInit = {}) => {
    const captured: Captured = {
      url: String(input),
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()),
      body: init.body === undefined ? null : String(init.body),
    };
    calls.push(captured);
    return respond(captured);
  }) as unknown as typeof fetch;

  return { calls, client: createClient({ baseUrl: "https://api.counted.test", fetch: fetchImpl }) };
};

describe("addressing", () => {
  test("an operation is called by its contract name", async () => {
    const { calls, client } = stub();
    await client("getWorkspace", { params: { workspaceId: "ws_1" } });

    expect(calls[0]).toMatchObject({
      url: "https://api.counted.test/v1/workspaces/ws_1",
      method: "GET",
    });
  });

  test("a name the contract does not know throws before any request", async () => {
    // Rather than a 404 from the API, which reads like the resource is
    // missing and sends somebody looking in the wrong place.
    const { calls, client } = stub();
    await expect(client("getWorkspaceMaybe")).rejects.toThrow(/unknown operation/);
    expect(calls).toEqual([]);
  });

  test("a missing path parameter throws rather than sending an empty one", async () => {
    // v1 sent `""` into a uuid column, which threw in Postgres, got swallowed,
    // and rendered a blank chart.
    const { calls, client } = stub();
    await expect(client("getWorkspace")).rejects.toThrow(/missing path parameter workspaceId/);
    expect(calls).toEqual([]);
  });

  test("path parameters are encoded", async () => {
    const { calls, client } = stub();
    await client("getProject", { params: { projectId: "a/b?c" } });
    expect(calls[0]?.url).toBe("https://api.counted.test/v1/projects/a%2Fb%3Fc");
  });
});

describe("cache tags come from the contract", () => {
  test("a read reports what it provides", async () => {
    const { client } = stub();
    const response = await client("getDashboard", { params: { dashboardId: "d_1" } });
    expect(response.provides).toEqual(["dashboard:d_1"]);
    expect(response.invalidates).toEqual([]);
  });

  test("a write reports what it made stale, with ids filled in", async () => {
    // The design's rule: invalidation is derived from the contract, so the UI
    // never maintains a key map that can drift from the routes.
    const { client } = stub();
    const response = await client("updateDashboard", { params: { dashboardId: "d_1" }, body: { name: "x" } });
    expect(response.invalidates).toEqual(["dashboard:d_1", "dashboards"]);
  });
});

describe("failures", () => {
  test("a problem response becomes an ApiError carrying its detail", async () => {
    const { client } = stub(() =>
      new Response(JSON.stringify({ detail: "A viewer may not update.", code: "auth.forbidden" }), {
        status: 403,
        headers: { "content-type": "application/problem+json", "counted-request-id": "req_1" },
      }),
    );

    const error = await client("getWorkspace", { params: { workspaceId: "ws_1" } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("A viewer may not update.");
    expect((error as ApiError).requestId).toBe("req_1");
  });

  test("a 401 is named, because it drives a redirect rather than an error page", async () => {
    const { client } = stub(() => new Response("{}", { status: 401, headers: { "content-type": "application/problem+json" } }));
    const error = (await client("getWorkspace", { params: { workspaceId: "ws_1" } }).catch((e: unknown) => e)) as ApiError;
    expect(error.isUnauthenticated).toBe(true);
  });

  test("a non-problem error body is not pretended to be parsed", async () => {
    // A proxy answering on the API's behalf sends HTML. Reporting a parsed
    // reason for it would be inventing one.
    const { client } = stub(() => new Response("<html>502</html>", { status: 502, headers: { "content-type": "text/html" } }));
    const error = (await client("getWorkspace", { params: { workspaceId: "ws_1" } }).catch((e: unknown) => e)) as ApiError;
    expect(error.problem).toBeNull();
    expect(error.status).toBe(502);
  });
});

describe("request shape", () => {
  test("a body sets the content type; a bodyless call does not", async () => {
    const { calls, client } = stub();
    await client("updateDashboard", { params: { dashboardId: "d_1" }, body: { name: "x" } });
    await client("getDashboard", { params: { dashboardId: "d_1" } });

    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    expect(calls[1]?.headers["content-type"]).toBeUndefined();
  });

  test("If-Match is sent when given, for optimistic concurrency", async () => {
    // Without it two tabs silently clobber a layout, which is what v1 did.
    const { calls, client } = stub();
    await client("updateDashboard", { params: { dashboardId: "d_1" }, body: {}, ifMatch: 'W/"3"' });
    expect(calls[0]?.headers["if-match"]).toBe('W/"3"');
  });

  test("a 204 resolves without trying to parse a body", async () => {
    const { client } = stub(() => new Response(null, { status: 204 }));
    const response = await client("endSession");
    expect(response.data).toBeUndefined();
  });

  test("nothing is cached", async () => {
    // A signed-in response served from a shared cache is somebody else's data.
    const seen: RequestInit[] = [];
    const client = createClient({
      baseUrl: "https://api.counted.test",
      fetch: (async (_url: unknown, init: RequestInit) => {
        seen.push(init);
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });
    await client("describeCaller");
    expect(seen[0]?.cache).toBe("no-store");
  });
});

describe("a per-request bearer", () => {
  test("is sent, and the session cookie is not sent with it", async () => {
    // The ingest endpoint authenticates with a project key. Attaching the
    // session cookie too would send ambient authority the caller did not ask
    // for — and the API would then require an Origin it has no reason to.
    const seen: RequestInit[] = [];
    const client = createClient({
      baseUrl: "https://api.counted.test",
      credentials: "include",
      fetch: (async (_url: unknown, init: RequestInit) => {
        seen.push(init);
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });

    await client("ingestEvents", { bearer: "ck_live_x", body: { events: [] } });
    expect(new Headers(seen[0]?.headers as HeadersInit).get("authorization")).toBe("Bearer ck_live_x");
    expect(seen[0]?.credentials).toBeUndefined();
  });

  test("a call without one still carries the session", async () => {
    const seen: RequestInit[] = [];
    const client = createClient({
      baseUrl: "https://api.counted.test",
      credentials: "include",
      fetch: (async (_url: unknown, init: RequestInit) => {
        seen.push(init);
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });

    await client("describeCaller");
    expect(seen[0]?.credentials).toBe("include");
  });
});

/**
 * A success with no body.
 *
 * The client special-cased `204` only, so every *other* bodyless success threw
 * a SyntaxError out of `response.json()` on empty input. `POST
 * /v1/auth/sign-in` answers `202` with no body — the contract says so — which
 * meant a valid address produced a sent link, a `202`, and then an exception.
 * The sign-in page caught it and reported "That does not look like an email
 * address", so the one thing that was correct is the thing it told you to fix.
 *
 * These use the statuses the committed contract actually declares bodyless,
 * rather than the ones this client happened to remember.
 */
describe("a 2xx with no body", () => {
  for (const status of [202, 204, 205]) {
    test(`${status} resolves with undefined data rather than throwing`, async () => {
      const { client } = stub(() => new Response(null, { status }));
      const result = await client("requestSignInLink", { body: { email: "a@b.co" } });
      expect(result.data).toBeUndefined();
    });
  }

  test("a 200 that really has JSON is still parsed", async () => {
    const { client } = stub(
      () => new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }),
    );
    const result = await client("describeCaller");
    expect(result.data).toEqual({ ok: true } as never);
  });

  test("a 2xx with a non-JSON content type is not parsed as JSON", async () => {
    // A proxy answering `text/html` on the API's behalf should not become a
    // parse error attributed to the caller's input.
    const { client } = stub(
      () => new Response("<html>hi</html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const result = await client("describeCaller");
    expect(result.data).toBeUndefined();
  });
});
