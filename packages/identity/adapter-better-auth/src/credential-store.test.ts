/**
 * What the port contract cannot see.
 *
 * The contract suite pins behaviour that any CredentialStore must have. These
 * are the properties that exist because the store is *this* one: the vendor's
 * columns we deliberately leave alone, the vendor's reaper we deliberately
 * avoid, the rows the vendor could create that we deliberately refuse to see,
 * and the rate limiter the port names but does not describe.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Duration, Instant, ProjectId, unbrand, type WorkspaceId } from "@counted/kernel";
import { credentialHint } from "@counted/identity-ports";
import { API_KEY_MODEL, CONFIG_ID } from "./placement";
import type { ApiKeyRow } from "./rows";
import { createTestIdentity } from "./testing/harness";

const T0 = Instant.fromEpochMillis(1_767_225_600_000);
const MINUTE = Duration.minutes(1);

type World = {
  identity: ReturnType<typeof createTestIdentity>;
  workspace: WorkspaceId;
  project: ProjectId;
  owner: import("@counted/kernel").AccountId;
};

const world = async (
  overrides: Parameters<typeof createTestIdentity>[0] = {},
): Promise<World> => {
  const identity = createTestIdentity(overrides);
  const workspace = await identity.givenWorkspace("Acme");
  const project = ProjectId("project-acme");
  identity.defineProject(project, workspace);
  const owner = await identity.givenMember(workspace, "owner");
  return { identity, workspace, project, owner };
};

const rawRow = async (w: World, id: string) =>
  (await w.identity.auth.auth.$context).adapter.findOne<ApiKeyRow>({
    model: API_KEY_MODEL,
    where: [{ field: "id", value: id }],
  });

describe("what this store writes into better-auth's table", () => {
  let w!: World;
  beforeEach(async () => {
    w = await world();
  });

  test("the domain's expiry is ours; the vendor's column stays empty", async () => {
    // `createApiKey` fires `deleteAllExpiredApiKeys`, which hard-deletes every
    // row whose vendor `expiresAt` is in the past. Storing the domain's expiry
    // there would erase lapsed keys from the record — and "which key was this
    // and who issued it" is asked after the key is already gone.
    const issued = await w.identity.credentials.issue(
      {
        kind: "service",
        name: "reaped?",
        workspace: w.workspace,
        project: null,
        issuedBy: w.owner,
        expiresIn: MINUTE,
      },
      T0,
    );
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const row = await rawRow(w, unbrand(issued.value.credential.id));
    expect(row?.expiresAt ?? null).toBeNull();
    expect(row?.countedExpiresAt).not.toBeNull();
    expect(issued.value.credential.expiresAt).toBe(Instant.plus(T0, MINUTE));

    // T0 is long past by the wall clock, so a key whose expiry lived in the
    // vendor's column would be gone after this call.
    await w.identity.auth.auth.api.deleteAllExpiredApiKeys();
    const listed = await w.identity.credentials.list({
      level: "workspace",
      workspace: w.workspace,
    });
    expect(listed.map((c) => c.id)).toContain(issued.value.credential.id);
  });

  test("revocation writes the instant and the vendor's flag", async () => {
    // The instant is what the port needs; the flag is what makes any
    // better-auth code path that ever reads this row refuse it too.
    const issued = await w.identity.credentials.issue(
      { kind: "service", name: "k", workspace: w.workspace, project: null, issuedBy: w.owner, expiresIn: null },
      T0,
    );
    if (!issued.ok) return;
    await w.identity.credentials.revoke(issued.value.credential.id, T0);

    const row = await rawRow(w, unbrand(issued.value.credential.id));
    expect(row?.enabled).toBe(false);
    expect(row?.countedRevokedAt).not.toBeNull();
    // Not deleted.
    expect(row).not.toBeNull();
  });

  test("the hint a list shows is the hint issuance computed", async () => {
    // `list` never sees a secret. It reconstructs the hint from the `start`
    // column, which is sized for exactly this in auth.ts — so if that sizing
    // drifts, the two stop agreeing and this test says so.
    const issued = await w.identity.credentials.issue(
      { kind: "ingest", name: "web", workspace: w.workspace, project: w.project, issuedBy: w.owner, expiresIn: null },
      T0,
    );
    if (!issued.ok) return;

    expect(issued.value.credential.hint).toBe(credentialHint(issued.value.secret));
    const [listed] = await w.identity.credentials.list({ level: "project", project: w.project });
    expect(listed?.hint).toBe(credentialHint(issued.value.secret));
  });

  test("the two kinds land in different configurations", async () => {
    const ingest = await w.identity.credentials.issue(
      { kind: "ingest", name: "i", workspace: w.workspace, project: null, issuedBy: w.owner, expiresIn: null },
      T0,
    );
    const service = await w.identity.credentials.issue(
      { kind: "service", name: "s", workspace: w.workspace, project: null, issuedBy: w.owner, expiresIn: null },
      T0,
    );
    if (!ingest.ok || !service.ok) return;

    expect((await rawRow(w, unbrand(ingest.value.credential.id)))?.configId).toBe(CONFIG_ID.ingest);
    expect((await rawRow(w, unbrand(service.value.credential.id)))?.configId).toBe(CONFIG_ID.service);
  });
});

describe("a key the vendor made and this store did not", () => {
  test("is invisible to the store and cannot verify", async () => {
    // `handler.ts` blocks `/api-key/*` so this cannot happen over HTTP. It can
    // still happen in-process, and a credential with no workspace has no
    // scope — a scopeless credential must not be usable.
    const w = await world();
    const smuggled = await w.identity.auth.auth.api.createApiKey({
      body: {
        configId: CONFIG_ID.service,
        name: "smuggled",
        userId: unbrand(w.owner),
        metadata: { workspaceId: unbrand(w.workspace), projectId: null },
      },
    });

    expect(smuggled.permissions).not.toBeNull();

    const listed = await w.identity.credentials.list({ level: "workspace", workspace: w.workspace });
    expect(listed.map((c) => unbrand(c.id))).not.toContain(smuggled.id);

    const verified = await w.identity.credentials.verify(smuggled.key, T0);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.error.kind).toBe("Unknown");
  });
});

describe("the ingest rate limit", () => {
  const limited = { ingestRateLimit: { window: MINUTE, maxRequests: 2 } };

  test("refuses past the limit and says how long to wait", async () => {
    const w = await world(limited);
    const issued = await w.identity.credentials.issue(
      { kind: "ingest", name: "web", workspace: w.workspace, project: null, issuedBy: w.owner, expiresIn: null },
      T0,
    );
    if (!issued.ok) return;
    const secret = issued.value.secret;

    expect((await w.identity.credentials.verify(secret, T0)).ok).toBe(true);
    expect((await w.identity.credentials.verify(secret, T0)).ok).toBe(true);

    const third = await w.identity.credentials.verify(secret, T0);
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.error.kind).toBe("RateLimited");
    if (third.error.kind !== "RateLimited") return;
    // The whole window, because every request landed on the instant it opened.
    expect(third.error.retryAfter).toBe(MINUTE);
  });

  test("a new window admits the caller again", async () => {
    const w = await world(limited);
    const issued = await w.identity.credentials.issue(
      { kind: "ingest", name: "web", workspace: w.workspace, project: null, issuedBy: w.owner, expiresIn: null },
      T0,
    );
    if (!issued.ok) return;

    await w.identity.credentials.verify(issued.value.secret, T0);
    await w.identity.credentials.verify(issued.value.secret, T0);
    expect((await w.identity.credentials.verify(issued.value.secret, T0)).ok).toBe(false);

    expect(
      (await w.identity.credentials.verify(issued.value.secret, Instant.plus(T0, MINUTE))).ok,
    ).toBe(true);
  });

  test("service keys are not metered — they are secret, not public", async () => {
    const w = await world(limited);
    const issued = await w.identity.credentials.issue(
      { kind: "service", name: "worker", workspace: w.workspace, project: null, issuedBy: w.owner, expiresIn: null },
      T0,
    );
    if (!issued.ok) return;

    for (let i = 0; i < 5; i += 1) {
      expect((await w.identity.credentials.verify(issued.value.secret, T0)).ok).toBe(true);
    }
  });
});

describe("lastUsedAt", () => {
  test("is written once per resolution window, not once per event", async () => {
    // The port calls this field advisory and allows it to lag, which is what
    // keeps a row update off the ingest hot path for a field nothing
    // authorizes on.
    const w = await world({ lastUsedResolution: Duration.hours(1) });
    const issued = await w.identity.credentials.issue(
      { kind: "service", name: "worker", workspace: w.workspace, project: null, issuedBy: w.owner, expiresIn: null },
      T0,
    );
    if (!issued.ok) return;
    const id = unbrand(issued.value.credential.id);

    await w.identity.credentials.verify(issued.value.secret, T0);
    const first = (await rawRow(w, id))?.countedLastUsedAt;
    expect(first).not.toBeNull();

    await w.identity.credentials.verify(issued.value.secret, Instant.plus(T0, MINUTE));
    expect((await rawRow(w, id))?.countedLastUsedAt).toEqual(first as Date);

    await w.identity.credentials.verify(issued.value.secret, Instant.plus(T0, Duration.hours(2)));
    expect((await rawRow(w, id))?.countedLastUsedAt).not.toEqual(first as Date);
  });
});
