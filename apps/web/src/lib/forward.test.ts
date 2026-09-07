import { describe, expect, test } from "bun:test";
import {
  FORWARDED_REQUEST_HEADERS,
  forwardedLocation,
  forwardedRequestHeaders,
  forwardedResponseHeaders,
  upstreamPathFor,
} from "./forward";

describe("what the proxy will forward", () => {
  test("a contract route loses the console's /api mount", () => {
    expect(upstreamPathFor("/api/v1/workspaces")).toBe("/v1/workspaces");
    expect(upstreamPathFor("/api/v1/dashboards/d1/tiles/t1/width")).toBe(
      "/v1/dashboards/d1/tiles/t1/width",
    );
  });

  test("better-auth's mount passes through unchanged", () => {
    // The provider issues cookies against the paths it sees. Rewriting this
    // family would set them for a path the browser never sends back.
    expect(upstreamPathFor("/api/auth/sign-in/email")).toBe("/api/auth/sign-in/email");
    expect(upstreamPathFor("/api/auth")).toBe("/api/auth");
  });

  test("anything the console did not name is refused, not relayed", () => {
    // The failure this prevents: an open relay onto the API's whole surface,
    // where /health and every route added later is public through a path
    // nobody reviewed.
    expect(upstreamPathFor("/api/health")).toBeNull();
    expect(upstreamPathFor("/health")).toBeNull();
    expect(upstreamPathFor("/api/v2/anything")).toBeNull();
    expect(upstreamPathFor("/dashboards")).toBeNull();
    expect(upstreamPathFor("/api/authorize")).toBeNull();
  });

  test("the Stripe webhook is refused even though it lives under /v1", () => {
    // A proxy that re-serializes the body has destroyed the bytes the
    // signature covers, so a webhook that "works" through here is one whose
    // verification means nothing.
    expect(upstreamPathFor("/api/v1/webhooks/stripe")).toBeNull();
  });
});

describe("the proxy forwards authority and never adds any", () => {
  const subsetOf = (outgoing: Headers, incoming: Headers): boolean =>
    [...outgoing.keys()].every((name) => incoming.has(name));

  test("every outbound header came off the inbound request", () => {
    // The invariant, stated as a property rather than as a list. An edit that
    // adds a header the console invents fails here without anyone having to
    // notice the new name.
    const cases: readonly Headers[] = [
      new Headers(),
      new Headers({ cookie: "counted.session=abc" }),
      new Headers({ authorization: "Bearer sk_live_x", "content-type": "application/json" }),
      new Headers({ host: "console.counted.dev", "x-forwarded-for": "10.0.0.1" }),
      new Headers({ accept: "text/html", "accept-language": "en", "user-agent": "curl/8" }),
    ];
    for (const incoming of cases) {
      expect(subsetOf(forwardedRequestHeaders(incoming), incoming)).toBe(true);
    }
  });

  test("an anonymous request stays anonymous", () => {
    const outgoing = forwardedRequestHeaders(new Headers({ accept: "application/json" }));
    expect(outgoing.get("cookie")).toBeNull();
    expect(outgoing.get("authorization")).toBeNull();
    expect(outgoing.get("x-api-key")).toBeNull();
  });

  test("the caller's own credentials are forwarded verbatim", () => {
    const outgoing = forwardedRequestHeaders(
      new Headers({ cookie: "counted.session=abc", authorization: "Bearer sk_x" }),
    );
    expect(outgoing.get("cookie")).toBe("counted.session=abc");
    expect(outgoing.get("authorization")).toBe("Bearer sk_x");
  });

  test("host and x-forwarded-for are dropped", () => {
    // host upstream makes better-auth resolve its base URL against the
    // console's hostname and issue cookies for an origin it does not serve —
    // sign-in appears to work and produces no session. x-forwarded-for is a
    // caller-controlled string a rate limiter would otherwise trust.
    const outgoing = forwardedRequestHeaders(
      new Headers({ host: "console.counted.dev", "x-forwarded-for": "1.2.3.4" }),
    );
    expect(outgoing.get("host")).toBeNull();
    expect(outgoing.get("x-forwarded-for")).toBeNull();
  });

  test("the allowlist carries no header the console could invent a value for", () => {
    expect(FORWARDED_REQUEST_HEADERS).not.toContain("host");
    // The browser's origin is what better-auth's CSRF check reads; without it
    // every sign-in through the proxy is "Missing or null Origin".
    expect(FORWARDED_REQUEST_HEADERS).toContain("origin");
    expect(FORWARDED_REQUEST_HEADERS).not.toContain("x-forwarded-for");
    expect(FORWARDED_REQUEST_HEADERS).not.toContain("x-api-key");
  });
});

describe("the response direction", () => {
  test("several set-cookie headers survive as several", () => {
    // Headers.get joins them with a comma and a cookie value may legally
    // contain one, so a sign-in that sets two cookies sets one broken one.
    const upstream = new Headers();
    upstream.append("set-cookie", "a=1; Path=/; HttpOnly");
    upstream.append("set-cookie", "b=2; Path=/; HttpOnly");
    expect(forwardedResponseHeaders(upstream).getSetCookie()).toEqual([
      "a=1; Path=/; HttpOnly",
      "b=2; Path=/; HttpOnly",
    ]);
  });

  test("content-encoding and content-length are dropped", () => {
    // fetch already decompressed the body. Forwarding the header makes the
    // browser try to gunzip plain bytes and render a broken page at status 200.
    const upstream = new Headers({
      "content-type": "application/json",
      "content-encoding": "gzip",
      "content-length": "1234",
    });
    const outgoing = forwardedResponseHeaders(upstream);
    expect(outgoing.get("content-type")).toBe("application/json");
    expect(outgoing.get("content-encoding")).toBeNull();
    expect(outgoing.get("content-length")).toBeNull();
  });
});

describe("redirects back to the API are rewritten onto the console", () => {
  const api = "http://localhost:8080";
  const console_ = "http://localhost:3000";

  test("an API path comes back through the proxy mount", () => {
    // Without this the browser leaves the origin holding the session cookie,
    // and the page it lands on tells it to sign in again.
    expect(forwardedLocation(`${api}/v1/me`, api, console_)).toBe("http://localhost:3000/api/v1/me");
  });

  test("the auth mount keeps its own path", () => {
    expect(forwardedLocation(`${api}/api/auth/callback`, api, console_)).toBe(
      "http://localhost:3000/api/auth/callback",
    );
  });

  test("a third party's URL is left exactly as it is", () => {
    // Rewriting a hosted checkout URL is how you break the thing you proxied
    // for.
    const stripe = "https://checkout.stripe.com/c/pay/cs_test_123";
    expect(forwardedLocation(stripe, api, console_)).toBe(stripe);
  });
});
