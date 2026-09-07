import { describe, expect, test } from "bun:test";
import { attempt, authorityFrom, contractClient } from "./client";

/** Captures what the link actually put on the wire. */
const recorder = () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let respond: () => Response = () =>
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  return {
    calls,
    answer: (next: () => Response) => {
      respond = next;
    },
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond();
    },
  };
};

const headersOf = (init: RequestInit): Headers => new Headers(init.headers as HeadersInit);

describe("the client carries the caller's authority and nothing else", () => {
  test("a cookie on the inbound request reaches the API", async () => {
    const link = recorder();
    const client = contractClient({
      authority: authorityFrom(new Headers({ cookie: "counted.session=abc" })),
      origin: "http://api.test",
      fetch: link.fetch,
    });

    link.answer(
      () =>
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await attempt(client.workspaces.list({}));

    expect(headersOf(link.calls[0]!.init).get("cookie")).toBe("counted.session=abc");
  });

  test("an anonymous caller produces an anonymous request", async () => {
    // The whole invariant in one assertion: given nothing, the client sends
    // nothing. There is no fallback credential for it to reach for.
    const link = recorder();
    const client = contractClient({
      authority: authorityFrom(new Headers()),
      origin: "http://api.test",
      fetch: link.fetch,
    });

    await attempt(client.workspaces.list({}));

    const sent = headersOf(link.calls[0]!.init);
    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("authorization")).toBeNull();
  });
});

describe("the contract decides the URL", () => {
  const client = (link: ReturnType<typeof recorder>) =>
    contractClient({ authority: {}, origin: "http://api.test", fetch: link.fetch });

  test("path parameters land in the path, not the query", async () => {
    const link = recorder();
    await attempt(client(link).tiles.resize({ dashboardId: "d1", tileId: "t1", width: 6 }));
    expect(link.calls[0]!.url).toBe("http://api.test/v1/dashboards/d1/tiles/t1/width");
    expect(link.calls[0]!.init.method).toBe("PUT");
    expect(link.calls[0]!.init.body).toBe(JSON.stringify({ width: 6 }));
  });

  test("a declared query parameter is spelled the way the document says", async () => {
    // `includeArchived` is declared `primitive` in the contract. oRPC's default
    // is bracket notation, which is not what the OpenAPI document describes —
    // this is the assertion that the two agree at the client end too.
    const link = recorder();
    await attempt(client(link).projects.list({ workspaceId: "w1", includeArchived: "true" }));
    expect(link.calls[0]!.url).toBe("http://api.test/v1/workspaces/w1/projects?includeArchived=true");
  });
});

describe("attempt reports outcomes instead of throwing", () => {
  const failing = (status: number, body: unknown) => {
    const link = recorder();
    link.answer(
      () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    );
    return {
      link,
      client: contractClient({ authority: {}, origin: "http://api.test", fetch: link.fetch }),
    };
  };

  test("a refused rule arrives with its domain reason intact", async () => {
    const { client } = failing(409, {
      defined: true,
      inferable: false,
      code: "CONFLICT",
      message: "That is already the name.",
      data: { reason: "NameUnchanged" },
    });

    const outcome = await attempt(client.dashboards.rename({ dashboardId: "d1", name: "Board" }));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.failure.code).toBe("CONFLICT");
    expect(outcome.failure.status).toBe(409);
    expect(outcome.failure.reason).toBe("NameUnchanged");
  });

  test("a reason survives even when the server did not mark the error inferable", async () => {
    // `isDefinedError` is `isInferableError` in @orpc/client@2.0.0-beta.32: it
    // is true only when the server set `inferable: true` on the wire. Nothing
    // here depends on that flag, so a server that stops setting it does not
    // silently take this console's error handling with it.
    const { client } = failing(402, {
      defined: false,
      inferable: false,
      code: "PAYMENT_REQUIRED",
      message: "Project limit reached.",
      data: { reason: "ProjectLimitReached", limit: 3 },
    });

    const outcome = await attempt(client.projects.create({ workspaceId: "w1", name: "New" }));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.failure.reason).toBe("ProjectLimitReached");
    expect(outcome.failure.status).toBe(402);
  });

  test("an unreachable API is a network failure, not a 500", async () => {
    // "The API did not answer" and "the API answered with a bug" need
    // different things done about them, and a 500 tells you the wrong one.
    const link = recorder();
    link.answer(() => {
      throw new TypeError("fetch failed");
    });
    const client = contractClient({ authority: {}, origin: "http://api.test", fetch: link.fetch });

    const outcome = await attempt(client.account.me({}));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.failure.code).toBe("NETWORK");
  });
});
