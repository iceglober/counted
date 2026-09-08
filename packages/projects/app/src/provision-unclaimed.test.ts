/**
 * The no-signup path, and the repair that closes provisioning's crash window.
 *
 * Both are sagas across two stores that share no transaction, so both are
 * tested for what survives each failure rather than only for the happy path.
 */

import { describe, expect, test } from "bun:test";
import {
  AccountId,
  Duration,
  Instant,
  ProjectId,
  WorkspaceId,
  type Permission,
} from "@counted/kernel";
import { canIngest, ClaimDigest, Project } from "@counted/projects-domain";
import { harness } from "./fakes";
import { provisionProject, provisionUnclaimedProject, repairProjectCredential } from "./provision";

const NOW = Instant.fromEpochMillis(1_700_000_000_000);
const LATER = Instant.plus(NOW, Duration.hours(72));
const HOLDING = { workspace: WorkspaceId("ws_holding"), issuedBy: AccountId("acct_operator") };
const GRANT = { digest: ClaimDigest("digest-of-a-token"), expiresAt: LATER };
const WS = WorkspaceId("ws_1");
const OWNER = AccountId("acc_owner");

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
const MEMBER: readonly Permission[] = ADMIN.filter((p) => p !== "events:write");

describe("provisionUnclaimedProject", () => {
  test("an anonymous caller gets a project, unclaimed, with a usable ingest key", async () => {
    // The whole no-signup path in one call. This use case did not exist: the
    // gap was that `IssueRequest.workspace` is not nullable and an unclaimed
    // project has no workspace, which is what the holding placement answers.
    const h = harness(NOW);
    const result = await provisionUnclaimedProject(h.deps, {
      name: "Agent scratch",
      grant: GRANT,
      holding: HOLDING,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.project.ownership.state).toBe("unclaimed");
    expect(result.value.credential.credential.kind).toBe("ingest");
    expect(result.value.credential.credential.permissions).toEqual(["events:write"]);
    // Placed on the project it was minted with, in the holding workspace.
    expect(result.value.credential.credential.project).toBe(result.value.project.id);
    expect(result.value.credential.credential.workspace).toBe(HOLDING.workspace);
    expect(canIngest([result.value.credential.credential], NOW)).toBe(true);
  });

  test("a blank name becomes a generated one, never 'Untitled project'", async () => {
    const h = harness(NOW);
    const result = await provisionUnclaimedProject(h.deps, {
      name: "   ",
      grant: GRANT,
      holding: HOLDING,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.project.name.trim().length).toBeGreaterThan(0);
    expect(result.value.project.name).not.toBe("Untitled project");
  });

  test("a grant that has already expired is refused before anything is written", async () => {
    // `Project.provisionUnclaimed` holds this rule; the point here is that the
    // refusal costs no rows — an expired grant must not leave a project behind.
    const h = harness(NOW);
    const result = await provisionUnclaimedProject(h.deps, {
      name: "late",
      grant: { digest: ClaimDigest("d"), expiresAt: NOW },
      holding: HOLDING,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("GrantExpired");
    expect(h.projects.rows.size).toBe(0);
    expect(h.credentials.rows.size).toBe(0);
  });

  test("a refused issuance takes the project with it", async () => {
    // A project with no ingest key is exactly what this path exists not to
    // hand out. The compensation is the only thing standing between a failed
    // issuance and a project that can never receive an event.
    const h = harness(NOW, { failNextIssue: { kind: "NothingGrantable", account: HOLDING.issuedBy } });
    const result = await provisionUnclaimedProject(h.deps, {
      name: "doomed",
      grant: GRANT,
      holding: HOLDING,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NothingGrantable");
    expect(h.projects.rows.size).toBe(0);
  });

  test("a key that came back carrying more than an ingest key may is revoked, and the project undone", async () => {
    // Nobody's authority is being exceeded here — the caller has none — so
    // what bounds the key is the credential-kind ceiling. A store that handed
    // back `projects:delete` on an ingest key has mis-derived, and the only
    // safe response is to kill the key that already exists.
    const h = harness(NOW, { grantInstead: ["events:write", "projects:delete"] });
    const result = await provisionUnclaimedProject(h.deps, {
      name: "over-granted",
      grant: GRANT,
      holding: HOLDING,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("PermissionEscalation");
    expect(h.projects.rows.size).toBe(0);
    expect([...h.credentials.rows.values()].every((c) => c.revokedAt !== null)).toBe(true);
  });

  test("no ProjectDeleted is enqueued for a project that never had a workspace", async () => {
    // The event carries a workspace and an unclaimed project has none. A
    // consumer told the project was deleted from a workspace it was never in
    // has been handed a false fact, which is worse than no fact — and nothing
    // downstream provisions anything for an unclaimed project anyway.
    const h = harness(NOW, { failNextIssue: { kind: "NoSuchWorkspace", workspace: HOLDING.workspace } });
    await provisionUnclaimedProject(h.deps, { name: "doomed", grant: GRANT, holding: HOLDING });
    expect(h.outbox.kinds()).not.toContain("projects.ProjectDeleted");
    expect(h.outbox.kinds()).toContain("projects.ProjectProvisionedUnclaimed");
  });
});

describe("repairProjectCredential", () => {
  /** A project saved with no credential — provisioning's crash window, exactly. */
  const orphan = async (h: ReturnType<typeof harness>) => {
    const created = Project.create(ProjectId("prj_orphan"), "Orphan", WS, NOW);
    if (!created.ok) throw new Error("fixture");
    await h.deps.uow.transact(({ projects }) => projects.save(created.value.project, []));
    return created.value.project.id;
  };

  test("a project with no ingest key gets one", async () => {
    const h = harness(NOW);
    const project = await orphan(h);

    const result = await repairProjectCredential(h.deps, {
      project,
      issuedBy: OWNER,
      held: ADMIN,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("repaired");
    const listed = await h.credentials.list({ level: "project", project });
    expect(canIngest(listed, NOW)).toBe(true);
    expect(h.outbox.kinds()).toContain("projects.CredentialIssued");
  });

  test("a project that already has a usable key is left alone", async () => {
    // Idempotence is the property that makes this safe to run on a schedule:
    // a sweep that re-issued every time would mint a key per pass.
    const h = harness(NOW);
    const provisioned = await provisionProject(h.deps, {
      workspace: WS,
      name: "Healthy",
      issuedBy: OWNER,
      held: ADMIN,
    });
    expect(provisioned.ok).toBe(true);
    if (!provisioned.ok) return;

    const before = h.credentials.rows.size;
    const result = await repairProjectCredential(h.deps, {
      project: provisioned.value.project.id,
      issuedBy: OWNER,
      held: ADMIN,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("already-provisioned");
    expect(h.credentials.rows.size).toBe(before);
  });

  test("a revoked key does not count as one", async () => {
    // `canIngest` is the same function the domain uses to decide whether the
    // project can receive an event. If it says no, the project needs a key.
    const h = harness(NOW);
    const provisioned = await provisionProject(h.deps, {
      workspace: WS,
      name: "Revoked",
      issuedBy: OWNER,
      held: ADMIN,
    });
    if (!provisioned.ok) return;
    await h.credentials.revoke(provisioned.value.credential.credential.id, NOW);

    const result = await repairProjectCredential(h.deps, {
      project: provisioned.value.project.id,
      issuedBy: OWNER,
      held: ADMIN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("repaired");
    // The replacement does not collide with the revoked key's name, which
    // `nameIsAvailable` counts as taken.
    if (result.value.kind !== "repaired") return;
    expect(result.value.credential.credential.name).not.toBe(
      provisioned.value.credential.credential.name,
    );
  });

  test("an issuer who may not write events cannot repair", async () => {
    // Q3 still applies. The repair is provisioning's second half and is bound
    // by the same rule: no key carries a permission its issuer does not hold.
    const h = harness(NOW);
    const project = await orphan(h);
    const result = await repairProjectCredential(h.deps, {
      project,
      issuedBy: OWNER,
      held: MEMBER,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("PermissionEscalation");
    expect(h.credentials.rows.size).toBe(0);
  });

  test("an archived project needs no key and is not given one", async () => {
    const h = harness(NOW);
    const project = await orphan(h);
    const loaded = await h.projects.find(project);
    if (loaded === null) return;
    const archived = loaded.archive(NOW);
    if (!archived.ok) return;
    await h.deps.uow.transact(({ projects }) => projects.save(archived.value.project, []));

    const result = await repairProjectCredential(h.deps, { project, issuedBy: OWNER, held: ADMIN });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("lapsed");
    expect(h.credentials.rows.size).toBe(0);
  });

  test("a project that does not exist is refused, not invented", async () => {
    const h = harness(NOW);
    const result = await repairProjectCredential(h.deps, {
      project: ProjectId("prj_nowhere"),
      issuedBy: OWNER,
      held: ADMIN,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NoSuchProject");
  });

  test("an unclaimed project is reported rather than repaired into the wrong workspace", async () => {
    // Its key belongs in the holding workspace and this use case has not been
    // told which one that is. Guessing would put a customer's key somewhere
    // nobody can list it from; the grant expires anyway, so the project stops
    // admitting events on its own.
    const h = harness(NOW);
    const provisioned = await provisionUnclaimedProject(h.deps, {
      name: "unclaimed",
      grant: GRANT,
      holding: HOLDING,
    });
    if (!provisioned.ok) return;
    await h.credentials.revoke(provisioned.value.credential.credential.id, NOW);

    const result = await repairProjectCredential(h.deps, {
      project: provisioned.value.project.id,
      issuedBy: OWNER,
      held: ADMIN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("lapsed");
  });
});
