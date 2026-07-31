/**
 * Signing in, over stubs.
 *
 * What is decided here is almost entirely *what is not said*: that a caller
 * cannot tell a new address from a known one, that a bad token and an expired
 * one are one refusal, and that a cookie-authenticated mutation from somebody
 * else's page is refused before anything is looked up.
 *
 * The storage side — that a link is spent exactly once, that an expired
 * session stops resolving — is proven against real Postgres in the adapter's
 * live tests. A stub would grant both for free.
 */

import { describe, expect, test } from "bun:test";
import { AccountId, Instant, Principal } from "@counted/domain";
import type { ConsoleSessions, Redemption } from "@counted/ports";
import { createApp } from "../server";
import type { Config, Dependencies } from "../composition";
import { silentLogger } from "../server.test";
import { STUB_SCHEMA, emptyUnitOfWork, noConsole, recordingMail, stubPools } from "../testing/stubs";
import { SESSION_COOKIE } from "../http/session";

const NOW = Instant.fromEpochMillis(Date.parse("2026-04-01T09:00:00Z"));
const ACCOUNT = AccountId("acct_1");

const config: Config = {
  databaseUrl: "postgres://stub",
  port: 8080,
  release: "test",
  appUrl: "https://app.counted.dev",
  stripe: { secretKey: "", webhookSecret: "", monthlyPrice: "", annualPrice: "" },
  email: { apiKey: "", from: "Counted <test@counted.test>" },
};

const build = (over: Partial<ConsoleSessions> = {}, mail = recordingMail()) => {
  const console_: ConsoleSessions = { ...noConsole, ...over };
  const deps = {
    log: silentLogger(),
    console: console_,
    notifier: mail,
    clock: { now: () => NOW },
    unitOfWork: emptyUnitOfWork,
    secrets: { digest: (s: string) => `digest:${s}`, issue: () => ({ secret: "", digest: "", prefix: "" }) },
    access: { principalFor: async () => Principal.ANONYMOUS, placementOf: async () => null, roleOf: async () => null },
    config,
  } as unknown as Dependencies;
  return { app: createApp(deps), mail };
};

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("requesting a sign-in link", () => {
  test("a valid address is always accepted, and the answer says nothing else", async () => {
    const { app, mail } = build({
      beginSignIn: async () => ({ token: "tok_abcdefghijklmnop", expiresAt: Instant.fromEpochMillis(Instant.toEpochMillis(NOW) + 900_000) }),
    });
    const response = await post(app, "/v1/auth/sign-in", { email: "someone@example.com" });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
    expect(mail.sent[0]?.to).toBe("someone@example.com");
  });

  test("a brand-new address and a known one are indistinguishable", async () => {
    // The whole of the account-enumeration attack. The port creates the
    // account when it has not seen the address, so there is no second path
    // here that could answer differently.
    const link = { token: "tok_abcdefghijklmnop", expiresAt: NOW };
    const fresh = await post(build({ beginSignIn: async () => link }).app, "/v1/auth/sign-in", { email: "new@example.com" });
    const known = await post(build({ beginSignIn: async () => link }).app, "/v1/auth/sign-in", { email: "old@example.com" });

    expect({ status: fresh.status, body: await fresh.text() }).toEqual({ status: known.status, body: await known.text() });
  });

  test("a failed send is still a 202", async () => {
    // Otherwise the mail provider's opinion of an address leaks through: a
    // bounce would answer "nobody is there" to anyone who asked.
    const failing = { deliver: async () => { throw new Error("provider down"); } };
    const { app } = build({ beginSignIn: async () => ({ token: "tok_abcdefghijklmnop", expiresAt: NOW }) }, failing as never);
    expect((await post(app, "/v1/auth/sign-in", { email: "bounce@example.com" })).status).toBe(202);
  });

  test("the link carries the token and points at the app", async () => {
    const { app, mail } = build({
      beginSignIn: async () => ({ token: "tok_abcdefghijklmnop", expiresAt: NOW }),
    });
    await post(app, "/v1/auth/sign-in", { email: "someone@example.com" });
    expect(mail.sent[0]?.body).toContain("https://app.counted.dev/auth/callback?token=tok_abcdefghijklmnop");
  });

  test("something that is not an address is refused, because that is a fact about the request", async () => {
    const { app } = build();
    expect((await post(app, "/v1/auth/sign-in", { email: "not-an-address" })).status).toBe(422);
    expect((await post(app, "/v1/auth/sign-in", {})).status).toBe(422);
  });
});

describe("redeeming a link", () => {
  const signedIn: Redemption = {
    kind: "signed_in",
    account: { id: ACCOUNT, email: "someone@example.com", createdAt: NOW },
    secret: "sess_secret_value",
    expiresAt: Instant.fromEpochMillis(Instant.toEpochMillis(NOW) + 2_592_000_000),
  };

  test("a good token sets an HttpOnly session cookie", async () => {
    const { app } = build({ redeem: async () => signedIn });
    const response = await post(app, "/v1/auth/session", { token: "tok_abcdefghijklmnop" });

    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=sess_secret_value`);
    // Script must not be able to read it, so an XSS is not a stolen session.
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    // Shared across app. and api. — same registrable domain.
    expect(cookie).toContain("Domain=.counted.dev");
  });

  test("the session secret is not in the body", async () => {
    // Only the cookie carries it. A copy in the body would be readable by
    // script, which is the exact thing HttpOnly exists to prevent.
    const { app } = build({ redeem: async () => signedIn });
    const body = await (await post(app, "/v1/auth/session", { token: "tok_abcdefghijklmnop" })).text();
    expect(body).not.toContain("sess_secret_value");
    expect(JSON.parse(body)).toMatchObject({ account: { email: "someone@example.com" } });
  });

  test("an expired token and an unknown one are refused identically", async () => {
    const expired = await post(build({ redeem: async () => ({ kind: "expired" }) }).app, "/v1/auth/session", { token: "tok_abcdefghijklmnop" });
    const unknown = await post(build({ redeem: async () => ({ kind: "unknown" }) }).app, "/v1/auth/session", { token: "tok_abcdefghijklmnop" });

    // Everything but the request id, which is per-request by design and
    // carries no information about the token.
    const strip = async (r: Response) => {
      const { requestId, ...rest } = (await r.json()) as Record<string, unknown>;
      return rest;
    };
    expect(expired.status).toBe(unknown.status);
    expect(await strip(expired)).toEqual(await strip(unknown));
  });
});

describe("signing out", () => {
  test("clears the cookie and ends the session", async () => {
    const ended: string[] = [];
    const { app } = build({ endSession: async (digest) => void ended.push(digest) });
    const response = await app.request("/v1/auth/session", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=sess_secret_value`, origin: "https://app.counted.dev" },
    });

    expect(response.status).toBe(204);
    expect(ended).toEqual(["digest:sess_secret_value"]);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("succeeds with no session at all", async () => {
    // Signing out of something already gone is what the user wanted anyway.
    const { app } = build();
    const response = await app.request("/v1/auth/session", { method: "DELETE" });
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("a cookie is not enough for a mutation from somewhere else", () => {
  const withSession = () =>
    build({ accountFor: async () => ({ id: ACCOUNT, email: "someone@example.com", createdAt: NOW }) });

  test("a mutation from another origin is refused", async () => {
    // The confused-deputy case: a page on evil.example makes the browser
    // attach the victim's cookie. `Origin` is set by the browser and cannot be
    // forged by script, so this costs nothing and needs no stored token.
    const { app } = withSession();
    const response = await app.request("/v1/auth/session", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=x`, origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  test("a mutation from the app is allowed", async () => {
    const { app } = withSession();
    const response = await app.request("/v1/auth/session", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=x`, origin: "https://app.counted.dev" },
    });
    expect(response.status).toBe(204);
  });

  test("a Bearer credential needs no Origin, even alongside a cookie", async () => {
    // Nothing ambient attaches a Bearer token, so there is no deputy to
    // confuse. Requiring an Origin here would break every server-side client.
    //
    // The cookie is sent too, deliberately: without it the check does not
    // apply at all, and this test passed for that reason rather than for the
    // exemption it names — which a mutation run caught.
    const { app } = withSession();
    const response = await app.request("/v1/auth/session", {
      method: "DELETE",
      headers: { authorization: "Bearer sk_something", cookie: `${SESSION_COOKIE}=x` },
    });
    expect(response.status).toBe(204);
  });

  test("a cookie-only mutation with no Origin header at all is refused", async () => {
    // An old browser, or a request crafted by something that omits it. Failing
    // closed is the only safe reading: absence is not permission.
    const { app } = withSession();
    const response = await app.request("/v1/auth/session", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=x` },
    });
    expect(response.status).toBe(403);
  });

  test("a read with a cookie and no Origin is allowed", async () => {
    // Only mutations are guarded. A GET carries no side effect, and blocking
    // it would break every top-level navigation into the app.
    const { app } = withSession();
    const response = await app.request("/health", { headers: { cookie: `${SESSION_COOKIE}=x` } });
    expect(response.status).toBe(200);
  });
});

describe("CORS", () => {
  test("the app's origin is echoed, with credentials", async () => {
    const { app } = build();
    const response = await app.request("/health", { headers: { origin: "https://app.counted.dev" } });

    // Never `*`: a browser refuses to send credentials to a wildcard, so the
    // lazy version would silently sign every request out.
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.counted.dev");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("vary")).toBe("origin");
  });

  test("an unknown origin gets no CORS headers at all", async () => {
    const { app } = build();
    const response = await app.request("/health", { headers: { origin: "https://evil.example" } });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("a preflight is answered without reaching a route", async () => {
    const { app } = build();
    const response = await app.request("/v1/auth/session", {
      method: "OPTIONS",
      headers: { origin: "https://app.counted.dev", "access-control-request-method": "DELETE" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("DELETE");
    expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
  });
});

describe("describing a signed-in caller", () => {
  test("an account is told where its authority comes from, not given a scope list", async () => {
    // `/v1/me` exists so a 403 can be diagnosed without guesswork, which makes
    // an inaccurate answer worse than none. An account's scopes depend on the
    // workspace, so any list here is wrong for some workspace — this used to
    // report every scope an owner has, to every signed-in account.
    const { app } = build({ accountFor: async () => ({ id: ACCOUNT, email: "someone@example.com", createdAt: NOW }) });
    const response = await app.request("/v1/me", { headers: { cookie: `${SESSION_COOKIE}=x` } });
    const body = (await response.json()) as { kind: string; scopeSource: string; scopes: string[] };

    expect(body).toMatchObject({ kind: "account", scopeSource: "membership", scopes: [] });
  });

  test("and an anonymous caller is distinguishable from a signed-in one", async () => {
    // `none` versus `membership` is the difference between "you are nobody"
    // and "your authority depends on the workspace you name".
    const { app } = build();
    const body = (await (await app.request("/v1/me")).json()) as { scopeSource: string };
    expect(body.scopeSource).toBe("none");
  });
});

describe("where a caller may go", () => {
  const withWorkspaces = (workspaces: readonly { id: string; name: string; role: string }[]) => {
    const deps = {
      log: silentLogger(),
      console: { ...noConsole, accountFor: async () => ({ id: ACCOUNT, email: "a@b.c", createdAt: NOW }) },
      notifier: recordingMail(),
      clock: { now: () => NOW },
      unitOfWork: {
        transact: async (work: (r: Record<string, unknown>) => unknown) =>
          work({ workspaces: { listForAccount: async () => workspaces } }),
      },
      secrets: { digest: (s: string) => `digest:${s}`, issue: () => ({ secret: "", digest: "", prefix: "" }) },
      access: { principalFor: async () => Principal.ANONYMOUS, placementOf: async () => null, roleOf: async () => null },
      config,
    } as unknown as Dependencies;
    return createApp(deps);
  };

  test("an account is told its workspaces and the role it holds in each", async () => {
    // Without this the console cannot start: an account can belong to several,
    // and remembering "the current one" anywhere would be a fourth piece of
    // state free to disagree with the other three.
    const app = withWorkspaces([{ id: "ws_1", name: "Acme", role: "owner" }]);
    const body = (await (await app.request("/v1/me", { headers: { cookie: `${SESSION_COOKIE}=x` } })).json()) as {
      workspaces: { id: string; name: string; role: string }[];
    };
    expect(body.workspaces).toEqual([{ id: "ws_1", name: "Acme", role: "owner" }]);
  });

  test("a credential is told nothing about the tenancy above it", async () => {
    // An ingest key ships in a browser bundle. Telling its holder the
    // workspace's name — or that there are others — discloses the customer's
    // own structure to anybody who views source.
    const app = withWorkspaces([{ id: "ws_1", name: "Acme", role: "owner" }]);
    const body = (await (await app.request("/v1/me")).json()) as { workspaces: unknown[] };
    expect(body.workspaces).toEqual([]);
  });
});
