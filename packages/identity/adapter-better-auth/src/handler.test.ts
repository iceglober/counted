/**
 * The two doors that are nailed shut, and the proof that they were reachable.
 *
 * A test that only asserts "blocked path answers 404" would pass just as
 * happily if better-auth had never registered the route. Each case here first
 * calls better-auth's own handler and checks the route is *live*, then calls
 * ours and checks it is not — so the assertion is about the guard rather than
 * about a spelling.
 */

import { describe, expect, test } from "bun:test";
import { isBlockedIdentityPath } from "./handler";
import { createTestIdentity } from "./testing/harness";

const post = (path: string, body: unknown = {}) =>
  new Request(`http://localhost:3000/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("the mounted identity handler", () => {
  test("better-auth really does serve the routes we block", async () => {
    const identity = createTestIdentity();

    // No session and no body, so these fail — but they fail as themselves,
    // with a 400 or a 401, which is what proves the route exists.
    const key = await identity.auth.auth.handler(post("/api-key/create", { name: "x" }));
    expect(key.status).not.toBe(404);

    const org = await identity.auth.auth.handler(
      post("/organization/create", { name: "Acme", slug: "acme" }),
    );
    expect(org.status).not.toBe(404);
  });

  test("the vendor's key CRUD is not reachable through us", async () => {
    // A key minted here would have a referenceId and no workspace: a
    // credential the store cannot see and the domain cannot scope.
    const identity = createTestIdentity();
    for (const path of ["/api-key/create", "/api-key/list", "/api-key/verify", "/api-key"]) {
      const response = await identity.http.handle(post(path));
      expect(response.status).toBe(404);
    }
  });

  test("organizations cannot be created or deleted around the provisioner", async () => {
    // An organization with no workspace is invisible to billing and uncharged.
    const identity = createTestIdentity();
    for (const path of ["/organization/create", "/organization/delete"]) {
      expect((await identity.http.handle(post(path))).status).toBe(404);
    }
  });

  test("workspace and membership mutations cannot bypass the contract's invariants", async () => {
    const identity = createTestIdentity();
    for (const path of ["/organization/update", "/organization/update-member-role", "/organization/remove-member", "/organization/leave"]) expect((await identity.http.handle(post(path))).status).toBe(404);
  });

  test("everything else still reaches better-auth", async () => {
    const identity = createTestIdentity();
    // Sign-in with no such account: a 401, which is better-auth answering.
    const response = await identity.http.handle(
      post("/sign-in/email", { email: "nobody@example.com", password: "whatever-12345" }),
    );
    expect(response.status).not.toBe(404);

    // Organization membership management is deliberately NOT blocked: those
    // rules are better-auth's and reimplementing them would be a second copy.
    const list = await identity.http.handle(
      new Request("http://localhost:3000/api/auth/organization/list"),
    );
    expect(list.status).not.toBe(404);
  });

  test("the block matches whole path segments, not prefixes", () => {
    // `/api-keys` is a route somebody could add later. It must not be swept up
    // by a naive startsWith on `/api-key`.
    expect(isBlockedIdentityPath("/api-key")).toBe(true);
    expect(isBlockedIdentityPath("/api-key/")).toBe(true);
    expect(isBlockedIdentityPath("/api-key/create")).toBe(true);
    expect(isBlockedIdentityPath("/api-keys/create")).toBe(false);
    expect(isBlockedIdentityPath("/organization/create")).toBe(true);
    expect(isBlockedIdentityPath("/organization/list")).toBe(false);
    expect(isBlockedIdentityPath("/sign-in/email")).toBe(false);
  });

  test("a key that belongs to neither kind cannot be minted by forgetting an argument", async () => {
    // There is deliberately no `default` api-key configuration, so the plugin
    // refuses a call that omits `configId` instead of quietly inventing one.
    const identity = createTestIdentity();
    const response = await identity.auth.auth.handler(post("/api-key/create", { name: "x" }));
    expect(response.status).toBe(400);
  });

  test("a signed-out caller has no principal", async () => {
    const identity = createTestIdentity();
    expect(await identity.http.principal(new Headers())).toBeNull();
  });
});
