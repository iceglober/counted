import { describe, expect, test } from "bun:test";
import { Duration, Instant, ProjectId, WorkspaceId } from "@counted/kernel";
import { ClaimDigest, Project, type ClaimGrant } from "./project";
import { RETENTION_INHERIT, retentionPolicy } from "./retention";

const NOW = Instant.fromEpochMillis(1_700_000_000_000);
const LATER = Instant.plus(NOW, Duration.hours(1));
const ID = ProjectId("prj_1");
const WS = WorkspaceId("ws_1");

const claimed = (): Project => {
  const created = Project.create(ID, "Acme web", WS, NOW);
  if (!created.ok) throw new Error("unreachable");
  return created.value.project;
};

const grant = (expiresAt = Instant.plus(NOW, Duration.hours(24))): ClaimGrant => ({
  digest: ClaimDigest("d".repeat(64)),
  expiresAt,
});

const unclaimed = (g: ClaimGrant = grant()): Project => {
  const provisioned = Project.provisionUnclaimed(ID, "slate-harbor", g, NOW);
  if (!provisioned.ok) throw new Error("unreachable");
  return provisioned.value.project;
};

describe("creation", () => {
  test("a name is required and is trimmed", () => {
    expect(Project.create(ID, "   ", WS, NOW)).toEqual({
      ok: false,
      error: { kind: "NameRequired" },
    });
    const created = Project.create(ID, "  Acme web  ", WS, NOW);
    if (!created.ok) throw new Error("unreachable");
    expect(created.value.project.name).toBe("Acme web");
  });

  test("a new project inherits its plan's retention rather than pinning one", () => {
    expect(claimed().retention).toEqual(RETENTION_INHERIT);
  });

  test("it emits exactly the fact that happened", () => {
    const created = Project.create(ID, "Acme web", WS, NOW);
    if (!created.ok) throw new Error("unreachable");
    expect(created.value.events).toEqual([
      { kind: "ProjectCreated", project: ID, workspace: WS, name: "Acme web", at: NOW },
    ]);
  });

  test("a snapshot round-trips through rehydrate", () => {
    const before = claimed();
    expect(Project.rehydrate(before.snapshot()).snapshot()).toEqual(before.snapshot());
  });
});

describe("claiming", () => {
  test("an unclaimed project has no workspace until it is claimed", () => {
    const project = unclaimed();
    expect(project.workspace).toBeNull();
    expect(project.isClaimed).toBe(false);

    const adopted = project.claim(grant().digest, WS, NOW);
    if (!adopted.ok) throw new Error("unreachable");
    expect(adopted.value.project.workspace).toBe(WS);
  });

  test("a grant is single use — the claimed state has no digest left to present", () => {
    // v1 modelled this as a nullable claimToken and the link then never expired
    // for any project that had events. Dropping the grant on success is what
    // makes single-use structural rather than a flag somebody has to clear.
    const adopted = unclaimed().claim(grant().digest, WS, NOW);
    if (!adopted.ok) throw new Error("unreachable");
    expect(adopted.value.project.claim(grant().digest, WorkspaceId("ws_2"), NOW)).toEqual({
      ok: false,
      error: { kind: "AlreadyClaimed" },
    });
  });

  test("a lapsed grant is refused, at the expiry instant and after", () => {
    const expiresAt = Instant.plus(NOW, Duration.hours(1));
    const project = unclaimed(grant(expiresAt));
    expect(project.claim(grant().digest, WS, expiresAt)).toEqual({
      ok: false,
      error: { kind: "GrantExpired" },
    });
    expect(project.claim(grant().digest, WS, Instant.plus(expiresAt, Duration.hours(1)))).toEqual({
      ok: false,
      error: { kind: "GrantExpired" },
    });
  });

  test("a wrong digest is refused, and expiry is checked before the digest", () => {
    // Order matters for what an attacker learns: a lapsed grant must answer
    // GrantExpired whether or not the guess was right.
    const expiresAt = Instant.plus(NOW, Duration.hours(1));
    expect(unclaimed().claim(ClaimDigest("e".repeat(64)), WS, NOW)).toEqual({
      ok: false,
      error: { kind: "GrantMismatch" },
    });
    expect(unclaimed(grant(expiresAt)).claim(ClaimDigest("e".repeat(64)), WS, expiresAt)).toEqual({
      ok: false,
      error: { kind: "GrantExpired" },
    });
  });

  test("a digest of a different length is a mismatch, not a crash", () => {
    expect(unclaimed().claim(ClaimDigest("d"), WS, NOW)).toEqual({
      ok: false,
      error: { kind: "GrantMismatch" },
    });
  });

  test("provisioning with an already-lapsed grant is refused", () => {
    expect(Project.provisionUnclaimed(ID, "slate-harbor", grant(NOW), NOW)).toEqual({
      ok: false,
      error: { kind: "GrantExpired" },
    });
  });
});

describe("admitting events", () => {
  test("an unclaimed project stops admitting events once its grant lapses", () => {
    // Otherwise anonymous provisioning is an unbounded free tier: no signup, no
    // limit, no way to attribute the volume to anybody.
    const expiresAt = Instant.plus(NOW, Duration.hours(1));
    const project = unclaimed(grant(expiresAt));
    expect(project.admitsEvents(NOW)).toBe(true);
    expect(project.admitsEvents(expiresAt)).toBe(false);
  });

  test("a claimed project admits events indefinitely", () => {
    expect(claimed().admitsEvents(Instant.plus(NOW, Duration.days(3650)))).toBe(true);
  });

  test("an archived project admits nothing", () => {
    const archived = claimed().archive(NOW);
    if (!archived.ok) throw new Error("unreachable");
    expect(archived.value.project.admitsEvents(NOW)).toBe(false);
  });
});

describe("rename", () => {
  test("refuses an unchanged name rather than emitting a fact that did not happen", () => {
    expect(claimed().rename("Acme web", LATER)).toEqual({
      ok: false,
      error: { kind: "NameUnchanged" },
    });
    expect(claimed().rename("  Acme web  ", LATER)).toEqual({
      ok: false,
      error: { kind: "NameUnchanged" },
    });
  });

  test("refuses an empty name", () => {
    expect(claimed().rename("", LATER)).toEqual({ ok: false, error: { kind: "NameRequired" } });
  });
});

describe("archive and restore", () => {
  test("archiving is reversible, and that is why it exists", () => {
    const archived = claimed().archive(NOW);
    if (!archived.ok) throw new Error("unreachable");
    expect(archived.value.project.archived).toBe(true);
    expect(archived.value.events).toEqual([{ kind: "ProjectArchived", project: ID, at: NOW }]);

    const restored = archived.value.project.restore(LATER);
    if (!restored.ok) throw new Error("unreachable");
    expect(restored.value.project.archived).toBe(false);
  });

  test("neither is idempotent — a second archive is a conflict, not a no-op", () => {
    const archived = claimed().archive(NOW);
    if (!archived.ok) throw new Error("unreachable");
    expect(archived.value.project.archive(LATER)).toEqual({
      ok: false,
      error: { kind: "ProjectArchived", project: ID },
    });
    expect(claimed().restore(LATER)).toEqual({
      ok: false,
      error: { kind: "ProjectNotArchived", project: ID },
    });
  });

  test("an archived project refuses every other write", () => {
    const archived = claimed().archive(NOW);
    if (!archived.ok) throw new Error("unreachable");
    const pinned = retentionPolicy(30);
    if (!pinned.ok) throw new Error("unreachable");
    expect(archived.value.project.rename("Something else", LATER).ok).toBe(false);
    expect(archived.value.project.setRetention(pinned.value, LATER).ok).toBe(false);
  });

  test("archiving preserves ownership and retention", () => {
    const pinned = retentionPolicy(30);
    if (!pinned.ok) throw new Error("unreachable");
    const withRetention = claimed().setRetention(pinned.value, NOW);
    if (!withRetention.ok) throw new Error("unreachable");
    const archived = withRetention.value.project.archive(LATER);
    if (!archived.ok) throw new Error("unreachable");
    expect(archived.value.project.retention).toEqual(pinned.value);
    expect(archived.value.project.workspace).toBe(WS);
  });
});

describe("retention", () => {
  test("setting the same policy twice is a conflict", () => {
    expect(claimed().setRetention(RETENTION_INHERIT, LATER)).toEqual({
      ok: false,
      error: { kind: "RetentionUnchanged" },
    });
  });

  test("the event carries null for inherit, so a reader never has to guess", () => {
    const pinned = retentionPolicy(30);
    if (!pinned.ok) throw new Error("unreachable");
    const set = claimed().setRetention(pinned.value, NOW);
    if (!set.ok) throw new Error("unreachable");
    expect(set.value.events).toEqual([
      { kind: "ProjectRetentionChanged", project: ID, days: 30, at: NOW },
    ]);

    const back = set.value.project.setRetention(RETENTION_INHERIT, LATER);
    if (!back.ok) throw new Error("unreachable");
    expect(back.value.events).toEqual([
      { kind: "ProjectRetentionChanged", project: ID, days: null, at: LATER },
    ]);
  });
});
