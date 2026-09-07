import { describe, expect, test } from "bun:test";
import {
  AccountId,
  CredentialId,
  Duration,
  Instant,
  ProjectId,
  WorkspaceId,
  type Permission,
} from "@counted/kernel";
import { credentialStatus, type CredentialFacts } from "@counted/projects-domain";
import type { CredentialSummary } from "@counted/identity-ports";
import {
  issueCredential,
  listCredentials,
  revokeCredential,
  rotateCredential,
} from "./credentials";
import { harness, type Harness } from "./fakes";
import { provisionProject } from "./provision";
import { DEFAULT_ROTATION_OVERLAP, MAX_ROTATION_OVERLAP, resolveOverlap } from "./rotation";

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
const OWNER: readonly Permission[] = [...ADMIN, "workspace:admin", "billing:write"];

/** A project with its first ingest key, which is the only way one is ever created. */
const provisioned = async (h: Harness = harness(NOW)) => {
  const result = await provisionProject(h.deps, {
    workspace: WS,
    name: "Acme web",
    issuedBy: ACTOR,
    held: ADMIN,
  });
  if (!result.ok) throw new Error("provisioning failed in a fixture");
  h.outbox.enqueued.length = 0;
  return { h, project: result.value.project.id, first: result.value.credential.credential.id };
};

describe("the port's CredentialSummary satisfies the domain's CredentialFacts", () => {
  test("structurally, with no cast at the seam", () => {
    // `@counted/projects-domain` may not import `@counted/identity-ports` —
    // domain-is-pure forbids it — so the two types are declared independently
    // and this is the only layer that can hold both. If they ever drift, this
    // file stops compiling, which is the point of it existing.
    const summary: CredentialSummary = {
      id: CredentialId("cred_1"),
      kind: "ingest",
      name: "default",
      hint: "ck_1…",
      workspace: WS,
      project: null,
      permissions: ["events:write"],
      issuedBy: ACTOR,
      createdAt: NOW,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    };
    const facts: CredentialFacts = summary;
    expect(credentialStatus(facts, NOW)).toBe("active");
  });
});

describe("listCredentials", () => {
  test("hands every caller the derived status rather than two nullable timestamps", async () => {
    const { h, project, first } = await provisioned();
    await rotateCredential(h.deps, {
      project,
      held: ADMIN,
      credential: first,
      expected: "ingest",
      overlap: Duration.hours(6),
    });

    const listing = await listCredentials(h.deps, project);
    const byId = new Map(listing.map((l) => [l.credential.id, l.status]));
    expect(byId.get(first)).toBe("expiring");
    expect([...byId.values()].filter((s) => s === "active")).toHaveLength(1);
  });
});

describe("issueCredential", () => {
  test("a requested subset is issued exactly and a request outside the caller's grant is refused", async () => {
    const { h, project } = await provisioned();
    const issued = await issueCredential(h.deps, { project, kind: "service", name: "reader", issuedBy: ACTOR, held: ADMIN, requested: ["queries:run"], expiresIn: null });
    expect(issued.ok && issued.value.credential.permissions).toEqual(["queries:run"]);
    const before = h.credentials.rows.size;
    const refused = await issueCredential(h.deps, { project, kind: "service", name: "escalation", issuedBy: ACTOR, held: ["credentials:write", "queries:run"], requested: ["projects:delete"], expiresIn: null });
    expect(refused).toMatchObject({ ok: false, error: { kind: "PermissionEscalation", requested: ["projects:delete"] } });
    expect(h.credentials.rows.size).toBe(before);
  });

  test("an ingest key carries exactly events:write even for an owner", async () => {
    const { h, project } = await provisioned();
    const issued = await issueCredential(h.deps, {
      project,
      kind: "ingest",
      name: "mobile",
      issuedBy: ACTOR,
      held: OWNER,
      expiresIn: null,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.value.credential.permissions).toEqual(["events:write"]);
  });

  test("refuses a name a usable key already holds, naming the clash", async () => {
    const { h, project, first } = await provisioned();
    const clash = await issueCredential(h.deps, {
      project,
      kind: "ingest",
      name: "default",
      issuedBy: ACTOR,
      held: ADMIN,
      expiresIn: null,
    });
    expect(clash).toEqual({ ok: false, error: { kind: "CredentialExists", credential: first } });
  });

  test("refuses on an archived project and on one that does not exist", async () => {
    const { h, project } = await provisioned();
    const missing = await issueCredential(h.deps, {
      project: ProjectId("missing"),
      kind: "service",
      name: "ci",
      issuedBy: ACTOR,
      held: ADMIN,
      expiresIn: null,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe("NoSuchProject");

    const loaded = await h.projects.find(project);
    if (loaded === null) throw new Error("unreachable");
    const archived = loaded.archive(NOW);
    if (!archived.ok) throw new Error("unreachable");
    await h.projects.save(archived.value.project, archived.value.events);

    const refused = await issueCredential(h.deps, {
      project,
      kind: "service",
      name: "ci",
      issuedBy: ACTOR,
      held: ADMIN,
      expiresIn: null,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.kind).toBe("ProjectArchived");
  });

  test("a key the store over-granted is revoked before the call returns", async () => {
    const { h, project } = await provisioned();
    h.credentials.configure({ grantInstead: ["queries:run", "workspace:admin"] });
    const issued = await issueCredential(h.deps, {
      project,
      kind: "service",
      name: "ci",
      issuedBy: ACTOR,
      held: ADMIN,
      expiresIn: null,
    });
    expect(issued.ok).toBe(false);
    if (issued.ok) return;
    expect(issued.error.kind).toBe("PermissionEscalation");

    const listing = await listCredentials(h.deps, project);
    const ci = listing.find((l) => l.credential.name === "ci");
    expect(ci?.status).toBe("revoked");
  });
});

describe("rotateCredential — the overlap window", () => {
  test("an admin cannot rotate an owner key to acquire project deletion", async () => {
    const { h, project } = await provisioned();
    const issued = await issueCredential(h.deps, { project, kind: "service", name: "owner automation", issuedBy: ACTOR, held: [...OWNER, "projects:delete"], expiresIn: null });
    if (!issued.ok) throw new Error("bad fixture");
    h.outbox.enqueued.length = 0;
    const refused = await rotateCredential(h.deps, { project, credential: issued.value.credential.id, held: ADMIN, expected: "service", overlap: null });
    expect(refused).toMatchObject({ ok: false, error: { kind: "PermissionEscalation", requested: ["projects:delete"] } });
    expect(h.credentials.rows.size).toBe(2);
    expect(h.outbox.enqueued).toHaveLength(0);
    expect(h.credentials.rows.get(issued.value.credential.id)?.expiresAt).toBeNull();
  });

  test("a credentials-write-only OAuth grant cannot obtain an ingest secret by rotating it", async () => {
    const { h, project, first } = await provisioned();
    const refused = await rotateCredential(h.deps, { project, credential: first, held: ["credentials:write"], expected: null, overlap: null });
    expect(refused).toMatchObject({ ok: false, error: { kind: "PermissionEscalation", requested: ["events:write"] } });
    expect(h.credentials.rows.size).toBe(1);
    expect(h.outbox.enqueued).toHaveLength(0);
  });

  test("the outgoing key keeps working for the window, then stops", async () => {
    // v1 rotated by overwriting in place: every deployed client broke the
    // instant somebody clicked the button, and the only signal was the graph
    // going flat.
    const { h, project, first } = await provisioned();
    const rotated = await rotateCredential(h.deps, {
      project,
      held: ADMIN,
      credential: first,
      expected: "ingest",
      overlap: Duration.hours(6),
    });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.value.graceEndsAt).toBe(Instant.plus(NOW, Duration.hours(6)));

    const outgoing = rotated.value.retiring;
    expect(credentialStatus(outgoing, Instant.plus(NOW, Duration.hours(5)))).toBe("expiring");
    expect(credentialStatus(outgoing, Instant.plus(NOW, Duration.hours(7)))).toBe("expired");
    // Both work during the window — which is the entire point of rotating.
    expect(credentialStatus(rotated.value.issued.credential, Instant.plus(NOW, Duration.hours(5))))
      .toBe("active");
  });

  test("the window is defaulted and clamped, never refused", async () => {
    // An overlap is a comfort window. Failing the one call an operator makes
    // while a key is leaking, because they asked for thirty days, trades a real
    // emergency against a preference.
    expect(resolveOverlap(null)).toBe(DEFAULT_ROTATION_OVERLAP);
    expect(resolveOverlap(Duration.days(30))).toBe(MAX_ROTATION_OVERLAP);
    expect(resolveOverlap(Duration.hours(-1))).toBe(Duration.ZERO);
    expect(resolveOverlap(Duration.ZERO)).toBe(Duration.ZERO);

    const { h, project, first } = await provisioned();
    const rotated = await rotateCredential(h.deps, {
      project,
      held: ADMIN,
      credential: first,
      expected: "ingest",
      overlap: null,
    });
    if (!rotated.ok) throw new Error("unreachable");
    expect(rotated.value.graceEndsAt).toBe(Instant.plus(NOW, DEFAULT_ROTATION_OVERLAP));
  });

  test("a zero overlap cuts the old secret off immediately", async () => {
    const { h, project, first } = await provisioned();
    const rotated = await rotateCredential(h.deps, {
      project,
      held: ADMIN,
      credential: first,
      expected: "ingest",
      overlap: Duration.ZERO,
    });
    if (!rotated.ok) throw new Error("unreachable");
    expect(credentialStatus(rotated.value.retiring, NOW)).toBe("expired");
  });

  test("both facts reach the outbox, so the window is visible in the record", async () => {
    const { h, project, first } = await provisioned();
    await rotateCredential(h.deps, {
      project,
      held: ADMIN,
      credential: first,
      expected: "ingest",
      overlap: Duration.hours(6),
    });
    expect(h.outbox.kinds()).toEqual([
      "projects.CredentialIssued",
      "projects.CredentialRotated",
    ]);
    const rotatedEvent = h.outbox.enqueued[1]?.payload;
    expect(rotatedEvent).toMatchObject({
      kind: "CredentialRotated",
      outgoing: first,
      graceEndsAt: Instant.plus(NOW, Duration.hours(6)),
    });
  });

  test("refuses a kind mismatch without touching the store", async () => {
    const { h, project, first } = await provisioned();
    const refused = await rotateCredential(h.deps, {
      project,
      held: ADMIN,
      credential: first,
      expected: "service",
      overlap: null,
    });
    expect(refused).toEqual({ ok: false, error: { kind: "RotationKindMismatch" } });
    expect(h.credentials.rows.size).toBe(1);
    expect(h.outbox.enqueued).toHaveLength(0);
  });
});

describe("revokeCredential — the last usable ingest key", () => {
  test("refuses to leave the project unable to receive events", async () => {
    // A typed refusal, not an exception: the console has to be able to say what
    // happened, and 'your data stopped arriving' is the most expensive failure
    // this product has.
    const { h, project, first } = await provisioned();
    const refused = await revokeCredential(h.deps, { project, credential: first });
    expect(refused).toEqual({
      ok: false,
      error: { kind: "LastIngestCredential", credential: first },
    });
    // Nothing was written — the store is not asked once the precondition fails.
    const listing = await listCredentials(h.deps, project);
    expect(listing.map((l) => l.status)).toEqual(["active"]);
    expect(h.outbox.enqueued).toHaveLength(0);
  });

  test("allows it once a second usable ingest key exists", async () => {
    const { h, project, first } = await provisioned();
    await issueCredential(h.deps, {
      project,
      kind: "ingest",
      name: "mobile",
      issuedBy: ACTOR,
      held: ADMIN,
      expiresIn: null,
    });
    h.outbox.enqueued.length = 0;

    const revoked = await revokeCredential(h.deps, { project, credential: first });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.value.revokedAt).toBe(NOW);
    expect(h.outbox.kinds()).toEqual(["projects.CredentialRevoked"]);
  });

  test("the replacement half of a rotation is cover, so the leaked half can be killed", async () => {
    // This is the case that matters: you rotate because a key leaked, and then
    // you want the leaked one dead before its overlap runs out.
    const { h, project, first } = await provisioned();
    await rotateCredential(h.deps, {
      project,
      held: ADMIN,
      credential: first,
      expected: "ingest",
      overlap: Duration.hours(24),
    });
    const revoked = await revokeCredential(h.deps, { project, credential: first });
    expect(revoked.ok).toBe(true);
  });

  test("a service key is never the last ingest key", async () => {
    const { h, project } = await provisioned();
    const issued = await issueCredential(h.deps, {
      project,
      kind: "service",
      name: "ci",
      issuedBy: ACTOR,
      held: ADMIN,
      expiresIn: null,
    });
    if (!issued.ok) throw new Error("unreachable");
    const revoked = await revokeCredential(h.deps, {
      project,
      credential: issued.value.credential.id,
    });
    expect(revoked.ok).toBe(true);
  });

  test("a second revoke is refused with the reason, not silently accepted", async () => {
    const { h, project } = await provisioned();
    const issued = await issueCredential(h.deps, {
      project,
      kind: "service",
      name: "ci",
      issuedBy: ACTOR,
      held: ADMIN,
      expiresIn: null,
    });
    if (!issued.ok) throw new Error("unreachable");
    const id = issued.value.credential.id;
    await revokeCredential(h.deps, { project, credential: id });
    expect(await revokeCredential(h.deps, { project, credential: id })).toEqual({
      ok: false,
      error: { kind: "CredentialRevoked", credential: id },
    });
  });
});
