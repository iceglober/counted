/**
 * The sign-in surfaces, and the one thing this package does with a session:
 * turn it into a `SessionPrincipal` that names nothing better-auth declares.
 *
 * These tests go through HTTP rather than through `auth.api`, because HTTP is
 * how the console will reach them and because the cookie round trip is the
 * part that actually breaks.
 */

import { describe, expect, test } from "bun:test";
import { Duration, Instant } from "@counted/kernel";
import { CLIENT_ADDRESS_HEADER } from "./auth";
import { createTestIdentity } from "./testing/harness";

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("email and password", () => {
  test("a signed-in caller resolves to a principal in our own vocabulary", async () => {
    const identity = createTestIdentity();

    const signUp = await identity.http.handle(
      post("/sign-up/email", {
        email: "ada@example.com",
        password: "correct-horse-battery",
        name: "Ada",
      }),
    );
    expect(signUp.status).toBe(200);

    const cookie = signUp.headers.get("set-cookie");
    expect(cookie).not.toBeNull();

    const principal = await identity.http.principal(new Headers({ cookie: cookie ?? "" }));
    expect(principal).not.toBeNull();
    expect(principal?.email).toBe("ada@example.com");
    // No workspace is selected until the console selects one. This is a
    // display default, never an authorization input.
    expect(principal?.activeWorkspace).toBeNull();
    expect(typeof principal?.expiresAt).toBe("number");

    // The same account the directory sees. `findByEmail` is given the address
    // in the case a phone would have typed it.
    const account = await identity.accounts.findByEmail("ADA@example.com");
    if (account === null || principal === null) throw new Error("no account or principal");
    expect(account.id).toBe(principal.account);
  });

  test("a forged cookie is nobody", async () => {
    const identity = createTestIdentity();
    const principal = await identity.http.principal(
      new Headers({ cookie: "better-auth.session_token=made-up-value" }),
    );
    expect(principal).toBeNull();
  });
});

describe("social sign-in", () => {
  const identityWith = (overrides: Parameters<typeof createTestIdentity>[0] = {}) =>
    createTestIdentity({
      baseURL: "http://api.counted.test/api/auth",
      socialSignIn: [{ provider: "github", clientId: "client", clientSecret: "secret" }],
      ...overrides,
    });

  /** The authorization URL better-auth hands the browser, as a parsed URL. */
  const authorizationUrl = async (identity: ReturnType<typeof createTestIdentity>) => {
    const response = await identity.http.handle(
      new Request("http://api.counted.test/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://console.counted.test" },
        body: JSON.stringify({ provider: "github", callbackURL: "http://console.counted.test/" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { url?: string };
    if (body.url === undefined) throw new Error("no authorization url");
    return new URL(body.url);
  };

  test("the provider is told to return the browser to the console", async () => {
    // Both halves of the flow have to name the same redirect_uri or the
    // provider refuses the exchange, so this is also what the token request
    // will send.
    const identity = identityWith({
      browserOrigin: "http://console.counted.test",
      trustedOrigins: ["http://console.counted.test"],
    });

    const url = await authorizationUrl(identity);
    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://console.counted.test/api/auth/callback/github",
    );
  });

  test("with one origin serving both, the callback stays on the API", async () => {
    const identity = identityWith({ trustedOrigins: ["http://console.counted.test"] });
    const url = await authorizationUrl(identity);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://api.counted.test/api/auth/callback/github",
    );
  });

  test("a provider that is not configured is not offered", async () => {
    const identity = identityWith({ trustedOrigins: ["http://console.counted.test"] });
    const response = await identity.http.handle(
      new Request("http://api.counted.test/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://console.counted.test" },
        body: JSON.stringify({ provider: "google", callbackURL: "http://console.counted.test/" }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe("magic link", () => {
  test("the link goes out through the notifier, not through better-auth's own mailer", async () => {
    const identity = createTestIdentity();
    await identity.givenAccount({ email: "grace@example.com", name: null, emailVerified: true });

    const response = await identity.http.handle(
      post("/sign-in/magic-link", { email: "grace@example.com" }),
    );
    expect(response.status).toBe(200);

    expect(identity.delivered.length).toBe(1);
    const notification = identity.delivered[0];
    expect(notification?.channel).toBe("email");
    if (notification?.channel !== "email") return;
    expect(notification.to).toBe("grace@example.com");
    expect(notification.body).toContain("http://localhost:3000");
  });

  test("the emailed link is on the origin the reader will click it from", async () => {
    // Two origins in production: the console proxies `/api/auth/*` to the API,
    // and the cookie belongs to whichever origin the browser received it from.
    // A link on the API's own origin signs the reader in there and leaves the
    // console — where they are actually looking — signed out.
    const identity = createTestIdentity({
      baseURL: "http://api.counted.test/api/auth",
      browserOrigin: "http://console.counted.test",
    });
    await identity.givenAccount({ email: "grace@example.com", name: null, emailVerified: true });

    const response = await identity.http.handle(
      new Request("http://api.counted.test/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "grace@example.com" }),
      }),
    );
    expect(response.status).toBe(200);

    const notification = identity.delivered[0];
    if (notification?.channel !== "email") throw new Error("no email delivered");
    // The path is better-auth's own and the console proxies that family
    // through unchanged, so only the origin moves.
    expect(notification.body).toContain(
      "http://console.counted.test/api/auth/magic-link/verify?token=",
    );
    expect(notification.body).not.toContain("api.counted.test");
  });

  test("with one origin serving both, the link is issued unchanged", async () => {
    const identity = createTestIdentity({ baseURL: "http://api.counted.test/api/auth" });
    await identity.givenAccount({ email: "grace@example.com", name: null, emailVerified: true });

    await identity.http.handle(
      new Request("http://api.counted.test/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "grace@example.com" }),
      }),
    );

    const notification = identity.delivered[0];
    if (notification?.channel !== "email") throw new Error("no email delivered");
    expect(notification.body).toContain(
      "http://api.counted.test/api/auth/magic-link/verify?token=",
    );
  });

  test("the message is the caller's to write", async () => {
    const identity = createTestIdentity({
      magicLinkMessage: ({ url, email }) => ({
        subject: `Sign in, ${email}`,
        body: `→ ${url}`,
      }),
    });
    await identity.givenAccount({ email: "grace@example.com", name: null, emailVerified: true });

    await identity.http.handle(post("/sign-in/magic-link", { email: "grace@example.com" }));
    const notification = identity.delivered[0];
    if (notification?.channel !== "email") throw new Error("no email delivered");
    expect(notification.subject).toBe("Sign in, grace@example.com");
    expect(notification.body.startsWith("→ http")).toBe(true);
  });
});

describe("session persistence", () => {
  test("the session cookie outlives the browser", async () => {
    const identity = createTestIdentity();
    const signUp = await identity.http.handle(
      post("/sign-up/email", { email: "ada@example.com", password: "correct-horse-battery", name: "Ada" }),
    );
    expect(signUp.status).toBe(200);

    // A cookie with a Max-Age is written to disk; one without dies with the
    // window. Thirty days, as the options say.
    const cookie = signUp.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("session_token=");
    expect(cookie).toMatch(/max-age=2592000/i);

    const principal = await identity.http.principal(new Headers({ cookie }));
    if (principal === null) throw new Error("no principal");
    const days = (Instant.toEpochMillis(principal.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  test("thirty days, refreshed at most daily", () => {
    const identity = createTestIdentity();
    expect(identity.auth.auth.options.session).toEqual({ expiresIn: 2_592_000, updateAge: 86_400 });
  });
});

describe("sign-in rate limit", () => {
  /** A wrong password: better-auth answers 401 until the limiter answers 429. */
  const attempt = (identity: ReturnType<typeof createTestIdentity>, headers: Record<string, string> = {}) =>
    identity.http.handle(
      post("/sign-in/email", { email: "nobody@example.com", password: "not-the-password" }, headers),
    );

  test("the attempt after the limit is refused, with a retry hint", async () => {
    const identity = createTestIdentity({
      signInRateLimit: { window: Duration.minutes(1), maxRequests: 2 },
    });
    expect((await attempt(identity)).status).toBe(401);
    expect((await attempt(identity)).status).toBe(401);

    const refused = await attempt(identity);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("x-retry-after")).not.toBeNull();
  });

  test("attempts are counted per client address, resolved by the composition root's rule", async () => {
    const identity = createTestIdentity({
      signInRateLimit: { window: Duration.minutes(1), maxRequests: 1 },
      // Stands in for the trusted-hop rule `apps/api` supplies.
      clientAddress: (headers) => headers.get("x-test-client"),
    });
    const alice = { "x-test-client": "198.51.100.7" };
    const bob = { "x-test-client": "198.51.100.8" };

    expect((await attempt(identity, alice)).status).toBe(401);
    expect((await attempt(identity, alice)).status).toBe(429);
    // Another address is another bucket.
    expect((await attempt(identity, bob)).status).toBe(401);
    // A caller who writes the private header itself is not believed: the
    // handler strips it and stamps the resolved address over the top.
    expect((await attempt(identity, { ...alice, [CLIENT_ADDRESS_HEADER]: "203.0.113.9" })).status).toBe(429);
  });

  test("without a resolver the private header is stripped, not read", async () => {
    const identity = createTestIdentity({
      signInRateLimit: { window: Duration.minutes(1), maxRequests: 1 },
    }, { resolveClientAddress: false });
    expect(identity.auth.auth.options.advanced?.ipAddress).toBeUndefined();
    expect((await attempt(identity, { [CLIENT_ADDRESS_HEADER]: "203.0.113.1" })).status).toBe(401);
    // Same bucket: the forged address did not buy a fresh one.
    expect((await attempt(identity, { [CLIENT_ADDRESS_HEADER]: "203.0.113.2" })).status).toBe(429);
  });

  test("five a minute by default, with addresses kept only in process memory", () => {
    const identity = createTestIdentity();
    expect(identity.auth.auth.options.rateLimit).toEqual({
      enabled: true,
      storage: "memory",
      customRules: {
        "/sign-in/*": { window: 60, max: 5 },
        "/sign-up/*": { window: 60, max: 5 },
      },
    });
  });
});

describe("social sign-in", () => {
  test("a configured provider gets a route; an unconfigured one does not", async () => {
    const identity = createTestIdentity({
      socialSignIn: [{ provider: "github", clientId: "id", clientSecret: "secret" }],
    });

    const configured = await identity.http.handle(
      post("/sign-in/social", { provider: "github", callbackURL: "/" }),
    );
    expect(configured.status).toBe(200);

    // Not configured: better-auth refuses rather than redirecting somewhere
    // that will fail later with somebody else's client id.
    const missing = await identity.http.handle(
      post("/sign-in/social", { provider: "google", callbackURL: "/" }),
    );
    expect(missing.status).not.toBe(200);
  });
});
