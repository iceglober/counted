import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createTestIdentity } from "./testing/harness";

const ORIGIN = "http://localhost:3000";
const post = (path: string, body: unknown, cookie?: string) => new Request(`${ORIGIN}/api/auth${path}`, { method: "POST", headers: { accept: "application/json", "content-type": path === "/oauth2/token" ? "application/x-www-form-urlencoded" : "application/json", ...(cookie ? { cookie } : {}) }, body: path === "/oauth2/token" ? new URLSearchParams(body as Record<string, string>) : JSON.stringify(body) });
const cookieOf = (response: Response) => response.headers.get("set-cookie") ?? "";
async function setup() {
  const identity = createTestIdentity();
  const register = await identity.http.handle(post("/oauth2/register", { client_name: "Test integration", redirect_uris: ["http://localhost:49152/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], application_type: "native" }));
  expect(register.status).toBe(201);
  const client = await register.json() as { client_id: string };
  const verifier = "a".repeat(64);
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: "http://localhost:49152/callback", response_type: "code", scope: "openid offline_access queries:run projects:read", resource: `${ORIGIN}/mcp`, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), state: "test-state" });
  const authorize = await identity.http.handle(new Request(`${ORIGIN}/api/auth/oauth2/authorize?${params}`, { headers: { accept: "text/html" } }));
  expect(authorize.status).toBe(302);
  const login = new URL(authorize.headers.get("location")!, ORIGIN);
  expect(login.pathname).toBe("/sign-in");
  const signup = await identity.http.handle(post("/sign-up/email", { name: "OAuth user", email: "oauth@example.test", password: "correct-horse-battery" }));
  expect(signup.status).toBe(200);
  const cookie = cookieOf(signup);
  const continuation = await identity.http.handle(post("/oauth2/continue", { oauth_query: login.search.slice(1), selected: true }, cookie));
  expect(continuation.status).toBe(200);
  const continued = await continuation.json() as { url: string };
  const consent = new URL(continued.url, ORIGIN);
  expect(consent.pathname).toBe("/consent");
  return { identity, cookie, client, verifier, consent };
}

describe("OAuth authorization code with PKCE", () => {
  test("login resumes consent, token resolves only its scopes, and disconnection revokes tokens", async () => {
    const { identity, cookie, client, verifier, consent } = await setup();
    const accepted = await identity.http.handle(post("/oauth2/consent", { accept: true, oauth_query: consent.search.slice(1) }, cookie));
    expect(accepted.status).toBe(200);
    const callback = new URL((await accepted.json() as { url: string }).url);
    expect(callback.searchParams.get("state")).toBe("test-state");
    const exchange = await identity.http.handle(post("/oauth2/token", { grant_type: "authorization_code", client_id: client.client_id, redirect_uri: "http://localhost:49152/callback", code: callback.searchParams.get("code"), code_verifier: verifier, resource: `${ORIGIN}/mcp` }));
    expect(exchange.status).toBe(200);
    const tokens = await exchange.json() as { access_token: string; refresh_token: string };
    const principal = await identity.http.oauthPrincipal(tokens.access_token);
    expect(principal?.permissions).toEqual(["queries:run", "projects:read"]);
    const grants = await identity.http.handle(new Request(`${ORIGIN}/api/auth/oauth2/get-consents`, { headers: { cookie } }));
    const consents = await grants.json() as { id: string }[];
    expect((await identity.http.handle(post("/oauth2/delete-consent", { id: consents[0]!.id }, cookie))).status).toBe(200);
    expect(await identity.http.oauthPrincipal(tokens.access_token)).toBeNull();
    expect((await identity.http.handle(post("/oauth2/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id }))).status).toBe(400);
    // A later connection is a new consent grant; old JWTs do not revive.
    expect((await identity.http.handle(post("/oauth2/consent", { accept: true, oauth_query: consent.search.slice(1) }, cookie))).status).toBe(200);
    expect(await identity.http.oauthPrincipal(tokens.access_token)).toBeNull();
  });

  test("tampering with signed scopes is rejected and denial returns an OAuth error", async () => {
    const { identity, cookie, consent } = await setup();
    const tampered = new URLSearchParams(consent.search);
    tampered.set("scope", `${tampered.get("scope")} billing:write`);
    expect((await identity.http.handle(post("/oauth2/consent", { accept: true, oauth_query: tampered.toString() }, cookie))).status).toBe(400);
    const denied = await identity.http.handle(post("/oauth2/consent", { accept: false, oauth_query: consent.search.slice(1) }, cookie));
    expect(denied.status).toBe(200);
    expect(new URL((await denied.json() as { url: string }).url).searchParams.get("error")).toBe("access_denied");
  });

  test("a made-up bearer is anonymous and the bridge cannot be called over HTTP", async () => {
    const identity = createTestIdentity();
    expect(await identity.http.oauthPrincipal("not-a-token")).toBeNull();
    expect((await identity.http.handle(post("/counted/oauth-principal", { token: "not-a-token" }))).status).toBe(404);
  });
});
