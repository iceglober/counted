/**
 * What a tool call becomes on the wire.
 *
 * The interesting failures are silent ones: a query parameter spelled in a way
 * the API decodes as something else, a path parameter that lands in the body,
 * or this server adding a credential of its own. None of those throws — they
 * all produce a request that looks fine and means something different — so
 * every test below reads the built `Request`, not a return code.
 */

import { describe, expect, test } from "bun:test";
import { buildRequest, httpInvoker, type Invocation } from "./invoke";
import { project, TOOLS_BY_NAME, type Tool } from "./projection";

const tool = (name: string): Tool => {
  const found = TOOLS_BY_NAME.get(name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
};

const built = (invocation: Invocation): Request => {
  const result = buildRequest("https://api.counted.dev", invocation);
  if (!result.ok) throw new Error(`build failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

describe("building the request", () => {
  test("path parameters are substituted, not sent as fields", () => {
    const request = built({
      tool: tool("dashboards_list"),
      args: { workspaceId: "ws_1" },
      token: "tok",
    });
    expect(request.url).toBe("https://api.counted.dev/v1/workspaces/ws_1/dashboards");
    expect(request.method).toBe("GET");
  });

  test("a path parameter is URL-encoded", () => {
    // Ids are opaque strings from the caller. One containing a slash would
    // otherwise reach a different route entirely.
    const request = built({
      tool: tool("dashboards_list"),
      args: { workspaceId: "ws/../../admin" },
      token: "tok",
    });
    expect(new URL(request.url).pathname).toBe("/v1/workspaces/ws%2F..%2F..%2Fadmin/dashboards");
  });

  test("a declared query parameter is spelled the way the contract declares it", () => {
    const request = built({
      tool: tool("projects_list"),
      args: { workspaceId: "ws_1", includeArchived: "true" },
      token: "tok",
    });
    const url = new URL(request.url);
    expect(url.pathname).toBe("/v1/workspaces/ws_1/projects");
    expect(url.searchParams.get("includeArchived")).toBe("true");
  });

  test("a GET carrying an undeclared field is refused rather than guessed at", () => {
    // oRPC's default query encoding is bracket notation, which the generated
    // document does not advertise. Inventing a spelling here would send a
    // parameter the API decodes as something else — better to fail.
    const result = buildRequest("https://api.counted.dev", {
      tool: tool("dashboards_list"),
      args: { workspaceId: "ws_1", surprise: "1" },
      token: "tok",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("UndeclaredQueryParam");
  });

  test("a missing path parameter is reported, not sent as the literal brace", () => {
    const result = buildRequest("https://api.counted.dev", {
      tool: tool("dashboards_list"),
      args: {},
      token: "tok",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: "MissingPathParam", param: "workspaceId" });
  });

  test("a write puts the remainder in a JSON body and the path params nowhere near it", async () => {
    const request = built({
      tool: tool("dashboards_create"),
      args: { workspaceId: "ws_1", name: "Weekly" },
      token: "tok",
    });
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/v1/workspaces/ws_1/dashboards");
    expect(await request.json()).toEqual({ name: "Weekly" });
  });

  test("an undefined argument is left out rather than sent as null", async () => {
    const request = built({
      tool: tool("projects_provision"),
      args: { name: undefined },
      token: undefined,
    });
    expect(await request.json()).toEqual({});
  });
});

describe("the credential on the request", () => {
  test("is the caller's token, and this server adds nothing of its own", () => {
    const request = built({ tool: tool("workspaces_list"), args: {}, token: "tok_caller" });
    expect(request.headers.get("authorization")).toBe("Bearer tok_caller");
    // The property `apps/web` is held to, held to here too: no cookie, no
    // second key, nothing that would let this server reach further than the
    // agent that called it.
    expect(request.headers.get("cookie")).toBeNull();
    expect(request.headers.get("x-api-key")).toBeNull();
    expect([...request.headers.keys()].sort()).toEqual(["accept", "authorization"]);
  });

  test("is absent when the caller presented none", () => {
    const request = built({ tool: tool("projects_provision"), args: {}, token: undefined });
    expect(request.headers.get("authorization")).toBeNull();
  });
});

describe("what comes back", () => {
  const invokerOver = (respond: (request: Request) => Response) =>
    httpInvoker({
      baseUrl: "https://api.counted.dev",
      fetch: (async (input, init) =>
        respond(input instanceof Request ? input : new Request(input, init))) as typeof fetch,
      timeoutMs: 1000,
    });

  test("a 2xx is the procedure's output", async () => {
    const invoker = invokerOver(() =>
      Response.json({ items: [] }, { status: 200 }),
    );
    const outcome = await invoker.invoke({ tool: tool("workspaces_list"), args: {}, token: "t" });
    expect(outcome).toEqual({ kind: "answered", status: 200, body: { items: [] } });
  });

  test("a 403 is reported as a refusal — it is never pre-empted and never retried", async () => {
    // The whole point of the design: this server does not know what a token may
    // do, so a refusal can only come from the API, and it arrives as an answer
    // rather than as an exception.
    let calls = 0;
    const invoker = invokerOver(() => {
      calls += 1;
      return Response.json(
        { defined: true, inferable: false, code: "FORBIDDEN", status: 403, message: "no", data: { reason: "NotPermitted" } },
        { status: 403 },
      );
    });
    const outcome = await invoker.invoke({ tool: tool("projects_create"), args: { workspaceId: "ws_1", name: "n" }, token: "t" });
    expect(calls).toBe(1);
    expect(outcome).toEqual({
      kind: "refused",
      status: 403,
      code: "FORBIDDEN",
      message: "no",
      data: { reason: "NotPermitted" },
    });
  });

  test("an error body without a code still becomes a refusal that names the status", async () => {
    const invoker = invokerOver(() => new Response("{}", { status: 502, headers: { "content-type": "application/json" } }));
    const outcome = await invoker.invoke({ tool: tool("workspaces_list"), args: {}, token: "t" });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.code).toBe("HTTP_502");
  });

  test("a reply that is not JSON is unreachable, not an empty answer", async () => {
    const invoker = invokerOver(() => new Response("<html>gateway</html>", { status: 200 }));
    const outcome = await invoker.invoke({ tool: tool("workspaces_list"), args: {}, token: "t" });
    expect(outcome.kind).toBe("unreachable");
  });

  test("a transport failure is unreachable, not a refusal", async () => {
    // A refusal tells an agent to stop asking. A network blip must not.
    const invoker = httpInvoker({
      baseUrl: "https://api.counted.dev",
      fetch: (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
      timeoutMs: 1000,
    });
    const outcome = await invoker.invoke({ tool: tool("workspaces_list"), args: {}, token: "t" });
    expect(outcome).toEqual({ kind: "unreachable", because: "ECONNREFUSED" });
  });

  test("a request that cannot be built never reaches the network", async () => {
    let called = false;
    const invoker = httpInvoker({
      baseUrl: "https://api.counted.dev",
      fetch: (() => {
        called = true;
        return Promise.resolve(Response.json({}));
      }) as unknown as typeof fetch,
      timeoutMs: 1000,
    });
    const outcome = await invoker.invoke({ tool: tool("dashboards_list"), args: {}, token: "t" });
    expect(called).toBe(false);
    expect(outcome.kind).toBe("unreachable");
  });
});

describe("query spellings this server can produce", () => {
  /**
   * The contract uses `primitive` and `json` today. The other three are
   * implemented because a route may declare them tomorrow, and an encoder that
   * only looks right is worse than none — so each is pinned against oRPC's own
   * documented decoding table.
   */
  const shareReadouts = project({ id: "share.readouts", title: "test only" });

  test("json is the value, JSON-encoded, in one parameter", () => {
    const request = built({
      tool: shareReadouts,
      args: { shareToken: "st_1", window: { kind: "last", days: 7 } },
      token: undefined,
    });
    const url = new URL(request.url);
    expect(url.searchParams.get("shareToken")).toBe("st_1");
    expect(JSON.parse(url.searchParams.get("window") as string)).toEqual({ kind: "last", days: 7 });
  });

  test("primitive takes one occurrence", () => {
    const request = built({
      tool: tool("queries_dimension_values"),
      args: { projectId: "prj_1", dimension: "country", limit: 25 },
      token: "t",
    });
    expect(new URL(request.url).searchParams.getAll("limit")).toEqual(["25"]);
  });
});
