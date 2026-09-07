import { describe, expect, test } from "bun:test";
import { createTestIdentity } from "./testing/harness";
import { WorkspaceId } from "@counted/kernel";

const post = (path: string, body: unknown, cookie?: string) => new Request(`http://localhost:3000/api/auth${path}`, {
  method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
});
const signUp = async (identity: ReturnType<typeof createTestIdentity>, email: string) => {
  const result = await identity.http.handle(post("/sign-up/email", { name: "Test person", email, password: "first-password-123" }));
  expect(result.status).toBe(200);
  return result.headers.get("set-cookie") ?? "";
};

describe("account recovery", () => {
  test("account closure requires leaving every workspace and revokes its sessions", async () => {
    const identity = createTestIdentity();
    const cookie = await signUp(identity, "close@example.test");
    const org = await identity.auth.auth.api.createOrganization({ headers: new Headers({ cookie }), body: { name: "Studio", slug: "studio" } });
    expect((await identity.http.handle(post("/delete-user", { password: "first-password-123" }, cookie))).status).toBe(403);
    // A separate member can leave; the last owner remains intact.
    const second = await signUp(identity, "close-alone@example.test");
    expect((await identity.http.handle(post("/delete-user", { password: "wrong-password" }, second))).status).toBe(400);
    expect((await identity.http.handle(post("/delete-user", { password: "first-password-123" }, second))).status).toBe(200);
    expect(await identity.http.principal(new Headers({ cookie: second }))).toBeNull();
    expect(await identity.accounts.findByEmail("close-alone@example.test")).toBeNull();
    expect(org?.id).toBeDefined();
  });
  test("reset email uses the browser origin; token changes the password once and revokes existing sessions", async () => {
    const identity = createTestIdentity({ browserOrigin: "http://console.test", trustedOrigins: ["http://console.test"] });
    const cookie = await signUp(identity, "recover@example.test");
    const requested = await identity.http.handle(post("/request-password-reset", { email: "recover@example.test", redirectTo: "http://console.test/reset-password?next=%2Finvitations%2Fabc" }));
    expect(requested.status).toBe(200);
    const message = identity.delivered.at(-1);
    if (message?.channel !== "email") throw new Error("expected reset email");
    expect(message?.subject).toBe("Reset your Counted password");
    const link = /https?:\/\/\S+/.exec(message?.body ?? "")?.[0];
    expect(link).toBeDefined();
    const url = new URL(link!);
    expect(url.origin).toBe("http://console.test");
    const token = url.pathname.split("/").at(-1);
    const reset = await identity.http.handle(post("/reset-password", { token, newPassword: "second-password-456" }));
    expect(reset.status).toBe(200);
    expect(await identity.http.principal(new Headers({ cookie }))).toBeNull();
    expect((await identity.http.handle(post("/sign-in/email", { email: "recover@example.test", password: "first-password-123" }))).status).toBe(401);
    expect((await identity.http.handle(post("/sign-in/email", { email: "recover@example.test", password: "second-password-456" }))).status).toBe(200);
    expect((await identity.http.handle(post("/reset-password", { token, newPassword: "third-password-789" }))).status).toBe(400);
  });

  test("an unknown address receives the same success response without email", async () => {
    const identity = createTestIdentity();
    expect((await identity.http.handle(post("/request-password-reset", { email: "nobody@example.test", redirectTo: "http://localhost:3000/reset-password" }))).status).toBe(200);
    expect(identity.delivered).toHaveLength(0);
  });

  test("an installation without mail refuses email actions and advertises the missing capability", async () => {
    const identity = createTestIdentity({ emailDelivery: false });
    expect(await (await identity.http.handle(new Request("http://localhost:3000/api/auth/capabilities"))).json()).toEqual({ email: false });
    for (const path of ["/request-password-reset", "/sign-in/magic-link", "/organization/invite-member", "/send-verification-email"]) expect((await identity.http.handle(post(path, { email: "nobody@example.test" }))).status).toBe(503);
    expect(identity.delivered).toHaveLength(0);
    await signUp(identity, "password-only@example.test");
  });
});

describe("workspace invitations", () => {
  test("administrators cannot invite through the provider around the shared workspace-admin grant", async () => {
    const identity = createTestIdentity();
    const cookie = await signUp(identity, "admin@example.test");
    const org = await identity.auth.auth.api.createOrganization({ headers: new Headers({ cookie }), body: { name: "Studio", slug: "studio" } });
    await (await identity.auth.auth.$context).adapter.updateMany({ model: "member", where: [{ field: "organizationId", value: org!.id }], update: { role: "admin" } });
    expect((await identity.http.handle(post("/organization/invite-member", { organizationId: org!.id, email: "other@example.test", role: "member" }, cookie))).status).toBe(403);
    expect(identity.delivered).toHaveLength(0);
  });
  test("delivers a browser invitation, rejects a different recipient, accepts once, and reports membership", async () => {
    const identity = createTestIdentity({ browserOrigin: "http://console.test" });
    const owner = await signUp(identity, "owner@example.test");
    const org = await identity.auth.auth.api.createOrganization({ headers: new Headers({ cookie: owner }), body: { name: "Studio", slug: "studio" } });
    if (!org) throw new Error("no workspace");
    const invited = await identity.http.handle(post("/organization/invite-member", { organizationId: org.id, email: "invited@example.test", role: "member" }, owner));
    expect(invited.status).toBe(200);
    const invitation = await invited.json() as { id: string };
    const mail = identity.delivered.at(-1);
    if (mail?.channel !== "email") throw new Error("expected invitation email");
    expect(mail.body).toContain(`http://console.test/invitations/${invitation.id}`);
    expect((await identity.http.handle(post("/organization/accept-invitation", { invitationId: invitation.id }, owner))).status).toBe(403);
    const recipient = await signUp(identity, "invited@example.test");
    const accepted = await identity.http.handle(post("/organization/accept-invitation", { invitationId: invitation.id }, recipient));
    expect(accepted.status).toBe(200);
    expect((await identity.http.handle(post("/organization/accept-invitation", { invitationId: invitation.id }, recipient))).status).toBe(400);
    const account = await identity.accounts.findByEmail("invited@example.test");
    expect(await identity.memberships.roleOf(account!.id, WorkspaceId(org.id))).toBe("member");
  });

  test("resend delivers again; a canceled invitation cannot be accepted", async () => {
    const identity = createTestIdentity();
    const owner = await signUp(identity, "owner@example.test");
    const org = await identity.auth.auth.api.createOrganization({ headers: new Headers({ cookie: owner }), body: { name: "Studio", slug: "studio" } });
    const body = { organizationId: org!.id, email: "invited@example.test", role: "member" };
    const first = await identity.http.handle(post("/organization/invite-member", body, owner));
    const invitation = await first.json() as { id: string };
    expect((await identity.http.handle(post("/organization/invite-member", { ...body, resend: true }, owner))).status).toBe(200);
    expect(identity.delivered).toHaveLength(2);
    expect((await identity.http.handle(post("/organization/cancel-invitation", { invitationId: invitation.id }, owner))).status).toBe(200);
    const recipient = await signUp(identity, "invited@example.test");
    expect((await identity.http.handle(post("/organization/accept-invitation", { invitationId: invitation.id }, recipient))).status).toBe(400);
  });
});
