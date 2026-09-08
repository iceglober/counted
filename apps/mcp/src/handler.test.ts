/**
 * The server as a client actually meets it: real JSON-RPC over the 2026-07-28
 * profile, through `createMcpHandler`, against a stand-in for `apps/api`.
 *
 * These tests exist because the interesting properties are end-to-end ones. That
 * a tool handler forwards a token is easy to assert in isolation and proves
 * little; that a `tools/call` arriving over the wire produces exactly one
 * outbound HTTP request, carrying exactly the caller's credential, to exactly
 * the route the contract declares, is the claim this package makes.
 *
 * The last block is the one to read first. **There is no MCP-specific
 * authorization path** is not a slogan here — it is asserted as an
 * indistinguishability property: two callers whose tokens can do wildly
 * different things produce byte-identical behaviour from this server, and the
 * difference appears only in what the API answers.
 */

import { describe, expect, test } from "bun:test";
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import type { TokenVerifier } from "./authentication";
import { createHandler } from "./handler";
import { httpInvoker } from "./invoke";
import { TOOLS } from "./projection";

const MODERN = "2026-07-28";

const identity = { resource: "https://mcp.counted.dev/mcp", issuer: "https://api.counted.dev" };

/**
 * A 2026-07-28 request. The envelope — the two reserved `_meta` keys plus the
 * `Mcp-Method` and `Mcp-Name` headers — is what tells the endpoint this is
 * modern traffic; without it the handler is configured to reject rather than
 * silently fall back to the 2025 era.
 */
const rpc = (id: number, method: string, params: Record<string, unknown> = {}): Request => {
  const body = {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: { [PROTOCOL_VERSION_META_KEY]: MODERN, [CLIENT_CAPABILITIES_META_KEY]: {} },
    },
  };
  const name = params["name"];
  return new Request("https://mcp.counted.dev/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MODERN,
      "mcp-method": method,
      ...(typeof name === "string" ? { "mcp-name": name } : {}),
    },
    body: JSON.stringify(body),
  });
};

const withToken = (request: Request, token: string): Request => {
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(request, { headers });
};

const live: TokenVerifier = { verify: async () => ({ kind: "live" }) };

/** A stand-in for `apps/api` that records what it was asked and answers what it is told to. */
const stubApi = (respond: (request: Request) => Response) => {
  const seen: Request[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    seen.push(request);
    return respond(request);
  }) as typeof globalThis.fetch;
  return { seen, fetch };
};

const handlerOver = (
  respond: (request: Request) => Response,
  verifier: TokenVerifier = live,
) => {
  const api = stubApi(respond);
  const handler = createHandler({
    identity,
    endpoint: "/mcp",
    verifier,
    invoker: httpInvoker({ baseUrl: "https://api.counted.dev", fetch: api.fetch, timeoutMs: 1000 }),
  });
  return { ...handler, api };
};

type RpcReply = { result?: Record<string, unknown>; error?: { code: number; message: string } };

describe("the OAuth challenge", () => {
  test("a request with no credential is answered 401 with a challenge, not 200", async () => {
    // An MCP client starts an authorization flow when it sees this and at no
    // other time. An endpoint that quietly serves unauthenticated traffic is an
    // endpoint nobody ever authenticates to.
    const { fetch } = handlerOver(() => Response.json({}));
    const response = await fetch(rpc(1, "tools/list"));
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain("Bearer");
    expect(challenge).toContain(
      'resource_metadata="https://mcp.counted.dev/.well-known/oauth-protected-resource/mcp"',
    );
  });

  test("a token the API will not accept is answered 401 invalid_token", async () => {
    const { fetch } = handlerOver(() => Response.json({}), {
      verify: async () => ({ kind: "rejected", because: "expired" }),
    });
    const response = await fetch(withToken(rpc(1, "tools/list"), "stale"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  test("an API that is down is 503, not 401", async () => {
    // A 401 tells the client to go and get a new token. If the reason it failed
    // is that the API is unreachable, the new token will fail the same way and
    // the client loops through an authorization dance it cannot finish.
    const { fetch } = handlerOver(() => Response.json({}), {
      verify: async () => ({ kind: "unreachable", because: "ECONNREFUSED" }),
    });
    const response = await fetch(withToken(rpc(1, "tools/list"), "tok"));
    expect(response.status).toBe(503);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  test("no tool call escapes to the API before the credential is checked", async () => {
    const { fetch, api } = handlerOver(() => Response.json({}), {
      verify: async () => ({ kind: "rejected", because: "unknown" }),
    });
    await fetch(withToken(rpc(1, "tools/call", { name: "projects_provision", arguments: {} }), "bad"));
    expect(api.seen.length).toBe(0);
  });
});

describe("routing", () => {
  test("the metadata document is served, unauthenticated, at the RFC 9728 path", async () => {
    const { fetch } = handlerOver(() => Response.json({}));
    const response = await fetch(
      new Request("https://mcp.counted.dev/.well-known/oauth-protected-resource/mcp"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: identity.resource,
      authorization_servers: [identity.issuer],
      scopes_supported: expect.arrayContaining(["queries:run", "workspace:read"]),
      bearer_methods_supported: ["header"],
    });
  });

  test("anything else is a 404, and never a silently-served MCP endpoint", async () => {
    const { fetch } = handlerOver(() => Response.json({}));
    expect((await fetch(new Request("https://mcp.counted.dev/"))).status).toBe(404);
    expect((await fetch(new Request("https://mcp.counted.dev/v1/me"))).status).toBe(404);
  });

  test("liveness and readiness both answer, unauthenticated, at the paths the deployment names", async () => {
    // `deploy/mcp.railway.json` checks `/health/ready`. A path the check names
    // and the server does not serve waits out the timeout and is then marked
    // healthy anyway, which is how a broken replica looks like a working one.
    const { fetch, api } = handlerOver(() => Response.json({}));
    const live = await fetch(new Request("https://mcp.counted.dev/health"));
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ ok: true });
    const ready = await fetch(new Request("https://mcp.counted.dev/health/ready"));
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ready: true });
    // Neither asks the API anything: a health check that fans out turns one slow
    // dependency into a rolling restart.
    expect(api.seen.length).toBe(0);
  });
});

describe("listing tools", () => {
  test("every projected tool is offered, with the contract's schema", async () => {
    const { fetch } = handlerOver(() => Response.json({}));
    const reply = (await (await fetch(withToken(rpc(1, "tools/list"), "tok"))).json()) as RpcReply;
    const tools = reply.result?.["tools"] as { name: string; inputSchema: Record<string, unknown> }[];
    expect(tools.length).toBe(TOOLS.length);
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());

    const provision = tools.find((t) => t.name === "projects_provision");
    expect(provision?.inputSchema["type"]).toBe("object");
    expect(Object.keys((provision?.inputSchema["properties"] ?? {}) as object)).toContain("name");
  });

  test("the tools the exposure table withholds are not reachable by name either", async () => {
    const { fetch, api } = handlerOver(() => Response.json({}));
    const reply = (await (
      await fetch(withToken(rpc(1, "tools/call", { name: "projects_delete", arguments: {} }), "tok"))
    ).json()) as RpcReply;
    expect(reply.error?.message ?? "").toContain("projects_delete");
    expect(api.seen.length).toBe(0);
  });
});

describe("calling a tool", () => {
  test("one call becomes exactly one request, to the route the contract declares", async () => {
    const { fetch, api } = handlerOver(() =>
      Response.json({ items: [{ id: "ws_1", name: "Acme", role: "owner", permissions: ["workspace:read"] }] }),
    );
    const reply = (await (
      await fetch(withToken(rpc(2, "tools/call", { name: "workspaces_list", arguments: {} }), "tok_caller"))
    ).json()) as RpcReply;

    expect(api.seen.length).toBe(1);
    const outbound = api.seen[0] as Request;
    expect(outbound.method).toBe("GET");
    expect(outbound.url).toBe("https://api.counted.dev/v1/workspaces");
    expect(outbound.headers.get("authorization")).toBe("Bearer tok_caller");

    expect(reply.result?.["structuredContent"]).toEqual({
      items: [{ id: "ws_1", name: "Acme", role: "owner", permissions: ["workspace:read"] }],
    });
  });

  test("a refusal arrives as a readable tool error, not as a protocol error", async () => {
    // An agent has to be able to read why it was refused. A JSON-RPC error would
    // be handled by the client library and, in most, never shown to the model.
    const { fetch } = handlerOver(() =>
      Response.json(
        {
          defined: true,
          inferable: false,
          code: "FORBIDDEN",
          status: 403,
          message: "Not permitted.",
          data: { reason: "NotPermitted" },
        },
        { status: 403 },
      ),
    );
    const reply = (await (
      await fetch(
        withToken(rpc(3, "tools/call", { name: "projects_create", arguments: { workspaceId: "ws_1", name: "n" } }), "tok"),
      )
    ).json()) as RpcReply;

    expect(reply.error).toBeUndefined();
    expect(reply.result?.["isError"]).toBe(true);
    const text = JSON.stringify(reply.result?.["content"]);
    expect(text).toContain("FORBIDDEN");
    expect(text).toContain("Retrying will not help");
  });

  test("arguments are validated against the contract's schema before anything is sent", async () => {
    const { fetch, api } = handlerOver(() => Response.json({}));
    const reply = (await (
      await fetch(
        withToken(rpc(4, "tools/call", { name: "projects_create", arguments: { workspaceId: 42 } }), "tok"),
      )
    ).json()) as RpcReply;
    expect(reply.result?.["isError"]).toBe(true);
    expect(JSON.stringify(reply.result?.["content"])).toContain("Input validation error");
    // The point: a malformed call is refused by the contract's own schema and
    // never becomes a request the API has to reject.
    expect(api.seen.length).toBe(0);
  });

  test("an unreachable API is distinguishable from a refusal, because one is worth retrying", async () => {
    // Collapsing these two either has an agent hammering a permission it will
    // never have, or giving up on a network blip.
    const handler = createHandler({
      identity,
      endpoint: "/mcp",
      verifier: live,
      invoker: httpInvoker({
        baseUrl: "https://api.counted.dev",
        fetch: (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof globalThis.fetch,
        timeoutMs: 1000,
      }),
    });
    const reply = (await (
      await handler.fetch(withToken(rpc(6, "tools/call", { name: "workspaces_list", arguments: {} }), "tok"))
    ).json()) as RpcReply;
    expect(reply.result?.["isError"]).toBe(true);
    const text = JSON.stringify(reply.result?.["content"]);
    expect(text).toContain("could not be reached");
    expect(text).not.toContain("Retrying will not help");
  });

  test("an API reply that does not match its own declared shape is named, not swallowed", async () => {
    const { fetch } = handlerOver(() => Response.json({ nonsense: true }));
    const reply = (await (
      await fetch(withToken(rpc(5, "tools/call", { name: "workspaces_list", arguments: {} }), "tok"))
    ).json()) as RpcReply;
    expect(reply.result?.["isError"]).toBe(true);
    expect(JSON.stringify(reply.result?.["content"])).toContain("did not match the shape");
  });
});

describe("there is no MCP-specific authorization path", () => {
  /**
   * The property, stated as indistinguishability: this server behaves
   * identically for every caller. It cannot narrow a tool list by identity, it
   * cannot pre-empt a call it expects to be refused, and it cannot widen
   * anything — because it never learns what a token may do. The only place that
   * knows is `packages/authorization`, inside `apps/api`, and both callers below
   * reach it by exactly the same route.
   */
  test("two callers with different authority are offered the same tools", async () => {
    const { fetch } = handlerOver(() => Response.json({}));
    const names = async (token: string) => {
      const reply = (await (await fetch(withToken(rpc(1, "tools/list"), token))).json()) as RpcReply;
      return (reply.result?.["tools"] as { name: string }[]).map((t) => t.name).sort();
    };
    expect(await names("token_of_an_owner")).toEqual(await names("token_of_a_read_only_member"));
  });

  test("the same call from two callers produces the same request but for the token", async () => {
    const { fetch, api } = handlerOver((request) =>
      request.headers.get("authorization") === "Bearer owner"
        ? Response.json({ ok: true }, { status: 201 })
        : Response.json(
            { defined: true, inferable: false, code: "FORBIDDEN", status: 403, message: "no" },
            { status: 403 },
          ),
    );

    const call = (token: string) =>
      fetch(
        withToken(
          rpc(1, "tools/call", { name: "projects_create", arguments: { workspaceId: "ws_1", name: "n" } }),
          token,
        ),
      );

    const ownerReply = (await (await call("owner")).json()) as RpcReply;
    const memberReply = (await (await call("member")).json()) as RpcReply;

    expect(api.seen.length).toBe(2);
    const [first, second] = api.seen as [Request, Request];
    expect(second.url).toBe(first.url);
    expect(second.method).toBe(first.method);
    expect(await second.text()).toBe(await first.text());
    expect(first.headers.get("authorization")).toBe("Bearer owner");
    expect(second.headers.get("authorization")).toBe("Bearer member");

    // The difference shows up only in the answer — which is the point.
    expect(JSON.stringify(ownerReply.result?.["content"])).not.toContain("FORBIDDEN");
    expect(memberReply.result?.["isError"]).toBe(true);
    expect(JSON.stringify(memberReply.result?.["content"])).toContain("FORBIDDEN");
  });

  test("this package imports nothing that could decide authorization", async () => {
    // Structural, and cheap to keep true. `@counted/authorization` and
    // `accesscontrol` are the only two things in the repository that can answer
    // "may this principal do that", and neither may appear here — a rule
    // dependency-cruiser cannot state for a single app, so it is stated here.
    // Tests are excluded because this one has to *name* the imports it forbids,
    // and a scan that included itself would always fail.
    const sources = [
      ...new Bun.Glob("*.ts").scanSync({ cwd: import.meta.dir, absolute: true }),
    ].filter(
      (file) => !file.endsWith(".test.ts"),
    );
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const text = await Bun.file(file).text();
      expect(text, file).not.toContain('from "@counted/authorization"');
      expect(text, file).not.toContain('from "accesscontrol"');
      expect(text, file).not.toContain("@counted/identity-adapter-better-auth");
    }
  });
});
