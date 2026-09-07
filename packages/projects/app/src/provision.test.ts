import { describe, expect, test } from "bun:test";
import { AccountId, Instant, WorkspaceId, type Permission } from "@counted/kernel";
import { canIngest } from "@counted/projects-domain";
import { harness } from "./fakes";
import { provisionProject } from "./provision";

const NOW = Instant.fromEpochMillis(1_700_000_000_000);
const WS = WorkspaceId("ws_1");
const ACTOR = AccountId("acc_1");

const ADMIN: readonly Permission[] = [
  "queries:run",
  "projects:read",
  "projects:write",
  "dashboards:read",
  "dashboards:write",
  "monitors:read",
  "monitors:write",
  "workspace:read",
  "events:write",
  "credentials:read",
  "credentials:write",
  "billing:read",
];
const MEMBER: readonly Permission[] = ADMIN.filter(
  (p) => p !== "events:write" && p !== "credentials:write" && p !== "credentials:read",
);

describe("provisionProject", () => {
  test("a new project is born with a usable ingest key", async () => {
    // v1 shipped the opposite: the signup path wrote a ck_ value into the
    // legacy apiKey column and left clientKey NULL, so the key the UI showed
    // could never ingest. The project existed and silently dropped everything.
    const h = harness(NOW);
    const result = await provisionProject(h.deps, {
      workspace: WS,
      name: "Acme web",
      issuedBy: ACTOR,
      held: ADMIN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.credential.secret).toBeTruthy();
    expect(result.value.credential.credential.permissions).toEqual(["events:write"]);

    const keys = await h.credentials.list({ level: "project", project: result.value.project.id });
    expect(canIngest(keys, NOW)).toBe(true);
  });

  test("a blank name gets a generated one, never a placeholder", async () => {
    const h = harness(NOW);
    const result = await provisionProject(h.deps, {
      workspace: WS,
      name: "   ",
      issuedBy: ACTOR,
      held: ADMIN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.project.name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  test("both facts reach the outbox, in the order they happened", async () => {
    const h = harness(NOW);
    await provisionProject(h.deps, {
      workspace: WS,
      name: "Acme web",
      issuedBy: ACTOR,
      held: ADMIN,
    });
    expect(h.outbox.kinds()).toEqual(["projects.ProjectCreated", "projects.CredentialIssued"]);
  });

  test("an issuer who cannot write events provisions nothing at all", async () => {
    // Q3 runs before the first write, so a refused request does not leave a
    // half-built project behind as the evidence that it was refused.
    const h = harness(NOW);
    const result = await provisionProject(h.deps, {
      workspace: WS,
      name: "Acme web",
      issuedBy: ACTOR,
      held: MEMBER,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("PermissionEscalation");
    expect(h.projects.rows.size).toBe(0);
    expect(h.outbox.enqueued).toHaveLength(0);
  });

  test("a project whose key could not be minted is deleted, and the undo is a fact", async () => {
    // The two stores share no transaction. A consumer that reacted to
    // ProjectCreated cannot observe a rollback it never saw, so the
    // compensation has to be an event it can react to.
    const h = harness(NOW, { failNextIssue: { kind: "IssuerNotAMember", account: ACTOR } });
    const result = await provisionProject(h.deps, {
      workspace: WS,
      name: "Acme web",
      issuedBy: ACTOR,
      held: ADMIN,
    });
    expect(result).toEqual({ ok: false, error: { kind: "IssuerNotAMember", account: ACTOR } });
    expect(h.projects.rows.size).toBe(0);
    expect(h.outbox.kinds()).toEqual(["projects.ProjectCreated", "projects.ProjectDeleted"]);
  });

  test("a key that came back over-privileged is revoked and the project undone", async () => {
    // The store derives permissions server-side and this layer derives them
    // from the grant table; they are two representations of one policy. If they
    // ever disagree, somebody has hand-authored a permission set — the exact
    // invariant that keeps accesscontrol the single source.
    const h = harness(NOW, { grantInstead: ["events:write", "billing:write"] });
    const result = await provisionProject(h.deps, {
      workspace: WS,
      name: "Acme web",
      issuedBy: ACTOR,
      held: ADMIN,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: "PermissionEscalation",
      requested: ["billing:write"],
      held: ["events:write"],
    });

    const surviving = [...h.credentials.rows.values()];
    expect(surviving.every((c) => c.revokedAt !== null)).toBe(true);
    expect(h.projects.rows.size).toBe(0);
  });
});
