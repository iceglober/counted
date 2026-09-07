/**
 * Authentication, and the line it must not cross.
 *
 * Two things are being protected. First, that the 401 an MCP client needs in
 * order to start an OAuth flow actually arrives — a resource server that
 * answers anything else is one nobody ever authenticates to. Second, that
 * verification answers only "is somebody there": no scope is read, so there is
 * nothing here that could become a second, coarser version of the permission
 * check `apps/api` already does.
 */

import { describe, expect, test } from "bun:test";
import {
  apiVerifier,
  bearerOf,
  challengeFor,
  metadataPathFor,
  metadataUrlFor,
  protectedResourceMetadata,
} from "./authentication";

const identity = {
  resource: "https://mcp.counted.dev/mcp",
  issuer: "https://api.counted.dev",
};

describe("reading the bearer", () => {
  test("accepts the scheme in any case, as RFC 7235 requires", () => {
    for (const header of ["Bearer abc", "bearer abc", "BEARER  abc", "  Bearer abc  "]) {
      expect(bearerOf(new Request("https://x/", { headers: { authorization: header } }))).toBe("abc");
    }
  });

  test("is undefined for a missing or differently-schemed header", () => {
    expect(bearerOf(new Request("https://x/"))).toBeUndefined();
    expect(bearerOf(new Request("https://x/", { headers: { authorization: "Basic abc" } }))).toBeUndefined();
    expect(bearerOf(new Request("https://x/", { headers: { authorization: "Bearer" } }))).toBeUndefined();
  });
});

describe("protected-resource metadata", () => {
  test("is served at the RFC 9728 path for a resource with a path", () => {
    expect(metadataPathFor("https://mcp.counted.dev/mcp")).toBe(
      "/.well-known/oauth-protected-resource/mcp",
    );
  });

  test("is served at the bare well-known path for a resource at the root", () => {
    expect(metadataPathFor("https://mcp.counted.dev/")).toBe("/.well-known/oauth-protected-resource");
  });

  test("names the resource, issuer, and the existing permission scopes clients can request", () => {
    const document = protectedResourceMetadata(identity);
    expect(document["resource"]).toBe(identity.resource);
    expect(document["authorization_servers"]).toEqual([identity.issuer]);
    // Scope names reuse the contract vocabulary; omitted tools grant no extra
    // authority just because a client follows discovery's suggestions.
    expect(document["scopes_supported"]).toEqual(expect.arrayContaining(["projects:read", "dashboards:write", "queries:run", "events:write"]));
    expect(document["scopes_supported"]).not.toContain("workspace:admin");
    expect(document["scopes_supported"]).not.toContain("billing:write");
    expect(document["scopes_supported"]).not.toContain("offline_access");
  });

  test("the challenge points a client at that document", () => {
    expect(challengeFor(identity)).toContain(`resource_metadata="${metadataUrlFor(identity)}"`);
    expect(metadataUrlFor(identity)).toBe(
      "https://mcp.counted.dev/.well-known/oauth-protected-resource/mcp",
    );
  });
});

describe("asking the API whether a token is live", () => {
  const verifierOver = (respond: (request: Request) => Response) => {
    const seen: Request[] = [];
    const verifier = apiVerifier({
      baseUrl: "https://api.counted.dev",
      fetch: (async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        seen.push(request);
        return respond(request);
      }) as typeof fetch,
      timeoutMs: 1000,
    });
    return { verifier, seen };
  };

  test("a 2xx means live", async () => {
    const { verifier } = verifierOver(() => Response.json({ account: { id: "acc_1" } }));
    expect(await verifier.verify("tok")).toEqual({ kind: "live" });
  });

  test("401 and 403 both mean the credential is unusable", async () => {
    // `/v1/me` needs no permission, so the only way to be refused it is to not
    // be anybody. Reporting a 403 as "unreachable" would leave a dead token
    // producing 503s forever instead of a re-authentication prompt.
    for (const status of [401, 403]) {
      const { verifier } = verifierOver(() => new Response("{}", { status }));
      expect((await verifier.verify("tok")).kind).toBe("rejected");
    }
  });

  test("a server error means we could not ask, not that the caller is unknown", async () => {
    const { verifier } = verifierOver(() => new Response("{}", { status: 500 }));
    expect((await verifier.verify("tok")).kind).toBe("unreachable");
  });

  test("a transport failure means we could not ask", async () => {
    const verifier = apiVerifier({
      baseUrl: "https://api.counted.dev",
      fetch: (() => Promise.reject(new Error("ETIMEDOUT"))) as unknown as typeof fetch,
      timeoutMs: 1000,
    });
    expect(await verifier.verify("tok")).toEqual({ kind: "unreachable", because: "ETIMEDOUT" });
  });

  test("asks the identity route and nothing else, carrying only the token", async () => {
    const { verifier, seen } = verifierOver(() => Response.json({}));
    await verifier.verify("tok");
    expect(seen.length).toBe(1);
    const request = seen[0] as Request;
    expect(request.url).toBe("https://api.counted.dev/v1/me");
    expect(request.method).toBe("GET");
    expect(request.headers.get("authorization")).toBe("Bearer tok");
  });

  test("a live verdict carries no scopes, because nothing here may read one", async () => {
    // Structural, not stylistic: a scope list on the verdict is the first step
    // towards this server deciding something, and there is nowhere for the
    // second step to live if the first never happens.
    const { verifier } = verifierOver(() => Response.json({}));
    expect(Object.keys(await verifier.verify("tok"))).toEqual(["kind"]);
  });
});
