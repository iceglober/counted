import { describe, expect, test } from "bun:test";
import { CredentialId, ProjectId, WorkspaceId } from "../shared/ids";
import { Duration, Instant } from "../shared";
import { Credential, CredentialDigest, CredentialPrefix } from "./credential";
import { type ClaimGrant, Project, type IssueRequest } from "./project";
import type { ProjectError } from "./errors";

const t0 = Instant.fromEpochMillis(1_700_000_000_000);
const at = (d: Duration) => Instant.plus(t0, d);

const prj = ProjectId("prj_1");
const ws = WorkspaceId("ws_1");

const ingest = (n: string): IssueRequest => ({
  id: CredentialId(`cred_${n}`),
  kind: "ingest",
  label: `ingest ${n}`,
  digest: CredentialDigest(`digest_${n}`),
  prefix: CredentialPrefix(`ck_${n}`),
});
const service = (n: string, scopes: IssueRequest["scopes"]): IssueRequest => ({
  id: CredentialId(`cred_${n}`),
  kind: "service",
  label: `service ${n}`,
  digest: CredentialDigest(`digest_${n}`),
  prefix: CredentialPrefix(`sk_${n}`),
  ...(scopes === undefined ? {} : { scopes }),
});

const must = <T>(r: { ok: true; value: T } | { ok: false; error: ProjectError }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const errorOf = <T>(r: { ok: true; value: T } | { ok: false; error: ProjectError }): ProjectError => {
  if (r.ok) throw new Error("expected an error, got ok");
  return r.error;
};

const created = () => must(Project.create(prj, "Web", ws, ingest("a"), t0)).project;

describe("creating a project", () => {
  test("it is born with a working ingest credential — the state v1's signup shipped without", () => {
    const { project, credential } = must(Project.create(prj, "Web", ws, ingest("a"), t0));
    expect(project.workspace).toBe(ws);
    expect(project.acceptsEvents(t0)).toBe(true);
    expect(credential.kind).toBe("ingest");
    expect(project.usableIngestCredentials(t0)).toHaveLength(1);
  });

  test("the first credential must be an ingest credential", () => {
    const r = Project.create(prj, "Web", ws, service("a", ["events:read"]), t0);
    expect(errorOf(r).kind).toBe("FirstCredentialMustIngest");
  });

  test("a blank name is rejected", () => {
    expect(errorOf(Project.create(prj, "  ", ws, ingest("a"), t0)).kind).toBe("NameRequired");
  });
});

describe("ingest credentials are narrow by construction", () => {
  test("an ingest credential carries events:write and nothing else, whatever was asked for", () => {
    const sneaky: IssueRequest = { ...ingest("b"), scopes: ["projects:write", "dashboards:write"] };
    const { credential } = must(created().issue(sneaky, t0));
    expect(credential.scopes).toEqual(["events:write"]);
    expect(Credential.grants(credential, "projects:write")).toBe(false);
  });

  test("a service credential must declare scopes", () => {
    expect(errorOf(created().issue(service("b", []), t0)).kind).toBe("ScopesRequired");
    expect(errorOf(created().issue(service("c", undefined), t0)).kind).toBe("ScopesRequired");
  });

  test("a project holds many credentials — not one column per kind", () => {
    const p1 = must(created().issue(ingest("b"), t0)).project;
    const p2 = must(p1.issue(service("c", ["events:read"]), t0)).project;
    expect(p2.usableCredentials(t0)).toHaveLength(3);
    expect(p2.usableIngestCredentials(t0)).toHaveLength(2);
  });

  test("duplicate credential ids are rejected", () => {
    expect(errorOf(created().issue(ingest("a"), t0)).kind).toBe("CredentialExists");
  });
});

describe("authenticating", () => {
  test("a known, usable digest resolves", () => {
    const c = must(created().authenticate(CredentialDigest("digest_a"), t0));
    expect(c.id).toBe(CredentialId("cred_a"));
  });

  test("an unknown digest does not", () => {
    expect(errorOf(created().authenticate(CredentialDigest("nope"), t0)).kind).toBe("UnknownCredential");
  });

  test("a revoked credential stops resolving", () => {
    const p = must(created().issue(ingest("b"), t0)).project;
    const revoked = must(p.revoke(CredentialId("cred_a"), t0)).project;
    expect(errorOf(revoked.authenticate(CredentialDigest("digest_a"), t0)).kind).toBe("CredentialRevoked");
  });
});

describe("rotation with overlap", () => {
  const grace = Duration.hours(24);

  test("both keys work during the grace window, then only the new one", () => {
    const p = created();
    const { project } = must(p.rotate(CredentialId("cred_a"), ingest("b"), grace, t0));

    // Immediately: both usable.
    expect(project.usableIngestCredentials(t0)).toHaveLength(2);
    expect(must(project.authenticate(CredentialDigest("digest_a"), t0)).id).toBe(CredentialId("cred_a"));

    // Inside the window: still both.
    const midway = at(Duration.hours(12));
    expect(project.usableIngestCredentials(midway)).toHaveLength(2);

    // After it: the outgoing key is gone, the project still ingests.
    const after = at(Duration.hours(25));
    expect(project.usableIngestCredentials(after)).toHaveLength(1);
    expect(errorOf(project.authenticate(CredentialDigest("digest_a"), after)).kind).toBe("CredentialExpired");
    expect(project.acceptsEvents(after)).toBe(true);
  });

  test("the grace end is published in the event so an operator can see it", () => {
    const { events } = must(created().rotate(CredentialId("cred_a"), ingest("b"), grace, t0));
    const rotated = events.find((e) => e.kind === "CredentialRotated");
    expect(rotated).toMatchObject({ graceEndsAt: at(grace) });
  });

  test("kinds cannot be swapped mid-rotation", () => {
    const r = created().rotate(CredentialId("cred_a"), service("b", ["events:read"]), grace, t0);
    expect(errorOf(r).kind).toBe("RotationKindMismatch");
  });
});

describe("revocation", () => {
  test("the last usable ingest credential cannot be revoked", () => {
    const e = errorOf(created().revoke(CredentialId("cred_a"), t0));
    expect(e).toEqual({ kind: "LastIngestCredential", credential: CredentialId("cred_a") });
  });

  test("with a second ingest credential present, the first may go", () => {
    const p = must(created().issue(ingest("b"), t0)).project;
    const after = must(p.revoke(CredentialId("cred_a"), t0)).project;
    expect(after.usableIngestCredentials(t0)).toHaveLength(1);
    expect(after.acceptsEvents(t0)).toBe(true);
  });

  test("a service credential has no such protection", () => {
    const p = must(created().issue(service("b", ["events:read"]), t0)).project;
    expect(must(p.revoke(CredentialId("cred_b"), t0)).project.usableCredentials(t0)).toHaveLength(1);
  });

  test("an expiring credential does not count as the survivor", () => {
    // After rotating, the outgoing key is expiring. Once the grace window has
    // passed it is no longer usable, so the replacement is the last one.
    const { project } = must(created().rotate(CredentialId("cred_a"), ingest("b"), Duration.hours(1), t0));
    const after = at(Duration.hours(2));
    expect(errorOf(project.revoke(CredentialId("cred_b"), after)).kind).toBe("LastIngestCredential");
  });

  test("double revocation is an error, not a silent no-op", () => {
    const p = must(created().issue(ingest("b"), t0)).project;
    const once = must(p.revoke(CredentialId("cred_a"), t0)).project;
    expect(errorOf(once.revoke(CredentialId("cred_a"), t0)).kind).toBe("CredentialRevoked");
  });
});

describe("the unclaimed lifecycle", () => {
  const grant: ClaimGrant = {
    digest: CredentialDigest("grant_secret"),
    expiresAt: at(Duration.days(7)),
  };

  const unclaimed = () =>
    must(Project.provisionUnclaimed(prj, "My App", grant, ingest("a"), t0)).project;

  test("it ingests immediately, with no signup", () => {
    const p = unclaimed();
    expect(p.isClaimed).toBe(false);
    expect(p.workspace).toBeNull();
    expect(p.acceptsEvents(t0)).toBe(true);
  });

  test("it stops ingesting once the grant lapses", () => {
    const p = unclaimed();
    expect(p.acceptsEvents(at(Duration.days(6)))).toBe(true);
    expect(p.acceptsEvents(at(Duration.days(8)))).toBe(false);
  });

  test("presenting the grant adopts it into a workspace", () => {
    const { project, events } = must(unclaimed().claim(CredentialDigest("grant_secret"), ws, at(Duration.days(1))));
    expect(project.isClaimed).toBe(true);
    expect(project.workspace).toBe(ws);
    expect(events[0]).toMatchObject({ kind: "ProjectClaimed", workspace: ws });
  });

  test("claiming carries the credentials across, so the key in the docs keeps working", () => {
    const claimed = must(unclaimed().claim(CredentialDigest("grant_secret"), ws, t0)).project;
    expect(must(claimed.authenticate(CredentialDigest("digest_a"), t0)).id).toBe(CredentialId("cred_a"));
  });

  test("a wrong grant is refused", () => {
    expect(errorOf(unclaimed().claim(CredentialDigest("guess"), ws, t0)).kind).toBe("GrantMismatch");
  });

  test("an expired grant is refused — v1's claim link never expired once a project had events", () => {
    const r = unclaimed().claim(CredentialDigest("grant_secret"), ws, at(Duration.days(8)));
    expect(errorOf(r).kind).toBe("GrantExpired");
  });

  test("claiming is single-use", () => {
    const claimed = must(unclaimed().claim(CredentialDigest("grant_secret"), ws, t0)).project;
    expect(errorOf(claimed.claim(CredentialDigest("grant_secret"), WorkspaceId("ws_2"), t0)).kind).toBe("AlreadyClaimed");
  });

  test("provisioning with an already-expired grant is refused", () => {
    const stale: ClaimGrant = { digest: CredentialDigest("g"), expiresAt: t0 };
    expect(errorOf(Project.provisionUnclaimed(prj, "x", stale, ingest("a"), t0)).kind).toBe("GrantExpired");
  });
});

describe("rename", () => {
  test("trims, and rejects blank or unchanged", () => {
    expect(must(created().rename("  Mobile  ", t0)).project.name).toBe("Mobile");
    expect(errorOf(created().rename("   ", t0)).kind).toBe("NameRequired");
    expect(errorOf(created().rename("Web", t0)).kind).toBe("NameUnchanged");
  });
});

describe("rehydration and immutability", () => {
  test("snapshot round-trips and keeps its invariants", () => {
    const built = must(created().issue(service("b", ["events:read", "dashboards:read"]), t0)).project;
    const revived = Project.rehydrate(built.snapshot());

    expect(revived.usableCredentials(t0)).toHaveLength(2);
    expect(revived.workspace).toBe(ws);
    expect(errorOf(revived.revoke(CredentialId("cred_a"), t0)).kind).toBe("LastIngestCredential");
  });

  test("commands leave the original untouched", () => {
    const before = created();
    const after = must(before.issue(ingest("b"), t0)).project;
    expect(before.usableCredentials(t0)).toHaveLength(1);
    expect(after.usableCredentials(t0)).toHaveLength(2);
  });
});
