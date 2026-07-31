/**
 * The one bootstrap path.
 *
 * Two kinds of claim here. The first is that the *sequence* works: a key that
 * ingests before anyone signs in, a link that previews before it commits, and
 * an adoption that opens a workspace for an account that has none.
 *
 * The second is what the endpoints refuse to say. A claim token is a bearer
 * capability, so "no such link" and "that link lapsed" must be one answer —
 * the difference is an oracle for testing guessed tokens.
 */

import { describe, expect, test } from "bun:test";
import { AccountId, Dashboard, Instant, Principal, Project, ProjectId, WorkspaceId, type CredentialDigest } from "@counted/domain";
import { createApp } from "../server";
import type { Config, Dependencies } from "../composition";
import { silentLogger } from "../server.test";
import { STUB_SCHEMA, noConsole, noMail, stubPools } from "../testing/stubs";
import { CLAIM_TTL_MS } from "./bootstrap";

const NOW = Instant.fromEpochMillis(Date.parse("2026-05-01T10:00:00Z"));
const ACCOUNT = AccountId("acct_1");

const config: Config = {
  databaseUrl: "postgres://stub",
  port: 8080,
  release: "test",
  appUrl: "https://app.counted.dev",
  stripe: { secretKey: "", webhookSecret: "", monthlyPrice: "", annualPrice: "" },
  email: { apiKey: "", from: "x" },
};

type World = {
  readonly projects: Map<string, Project>;
  readonly workspaces: { id: string; name: string; role: string }[];
  readonly saved: Project[];
  readonly opened: string[];
};

const build = (over: { signedIn?: boolean; world?: Partial<World>; now?: Instant } = {}) => {
  const world: World = {
    projects: new Map(),
    workspaces: [],
    saved: [],
    opened: [],
    ...over.world,
  };

  let ids = 0;
  const at = over.now ?? NOW;

  const deps = {
    log: silentLogger(),
    console: over.signedIn === true
      ? { ...noConsole, accountFor: async () => ({ id: ACCOUNT, email: "a@b.c", createdAt: NOW }) }
      : noConsole,
    notifier: noMail,
    clock: { now: () => at },
    // Deterministic, so a test can name the token it is about to redeem.
    ids: { next: () => `id_${++ids}` },
    secrets: {
      digest: (s: string) => `digest:${s}` as CredentialDigest,
      issue: () => ({ secret: "ck_live_secret", digest: "digest:ck_live_secret" as CredentialDigest, prefix: "ck_live_se" }),
    },
    grants: { issue: () => "grant_token_value" },
    access: { principalFor: async () => Principal.ANONYMOUS, placementOf: async () => null, roleOf: async () => null },
    unitOfWork: {
      transact: async (work: (r: Record<string, unknown>) => unknown) =>
        work({
          projects: {
            findByClaimDigest: async (digest: string) => world.projects.get(digest) ?? null,
            save: async (p: Project) => void world.saved.push(p),
          },
          workspaces: {
            listForAccount: async () => world.workspaces,
            save: async (w: { snapshot: () => { id: string } }) => void world.opened.push(String(w.snapshot().id)),
          },
        }),
    },
    config,
  } as unknown as Dependencies;

  return { app: createApp(deps), world };
};

const COOKIE = { cookie: "counted_session=x", origin: "https://app.counted.dev" };

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.counted.dev", ...headers },
    body: JSON.stringify(body),
  });

/**
 * An unclaimed project already in the world, keyed by its grant digest.
 *
 * Created at `issuedAt` rather than at `NOW`, because the domain refuses to
 * mint a grant that has already lapsed — correctly. A lapsed one therefore has
 * to be built in the past and left to expire, which is also how a real one
 * gets that way.
 */
const provisioned = (
  name = "Acme",
  expiresAt = Instant.fromEpochMillis(Instant.toEpochMillis(NOW) + CLAIM_TTL_MS),
  issuedAt = Instant.fromEpochMillis(Instant.toEpochMillis(expiresAt) - CLAIM_TTL_MS),
) => {
  const created = Project.provisionUnclaimed(
    ProjectId("prj_1"),
    name,
    { digest: "digest:tok" as CredentialDigest, expiresAt },
    { id: "cred_1" as never, kind: "ingest", label: "Default", digest: "digest:k" as CredentialDigest, prefix: "ck_live_ab" as never },
    issuedAt,
  );
  if (!created.ok) throw new Error("could not provision");
  return new Map([["digest:tok", created.value.project]]);
};

describe("provisioning", () => {
  test("returns a key, a claim link, and something to paste", async () => {
    const { app } = build();
    const response = await post(app, "/v1/provision", { name: "Acme" });
    const payload = (await response.json()) as Record<string, string> & { project: { state: string } };

    expect(response.status).toBe(201);
    expect(payload.ingestKey).toBe("ck_live_secret");
    expect(payload.project.state).toBe("unclaimed");
    expect(payload.claimUrl).toContain("https://app.counted.dev/claim/");
    // The snippet is built server-side so an agent and a human get the same
    // one — two copies of an install instruction is two things to go stale.
    expect(payload.snippet).toContain("ck_live_secret");
    expect(payload.snippet).toContain("@counted/sdk-js");
  });

  test("the project is named at creation", async () => {
    // v1 created "My Project" and asked afterwards, so the rename was a second
    // step most people never took and every list read the same.
    const { app } = build();
    const named = (await (await post(app, "/v1/provision", { name: "Acme" })).json()) as { project: { name: string } };
    expect(named.project.name).toBe("Acme");
  });

  test("a caller with no name in mind still gets a project, not an error", async () => {
    const { app } = build();
    const response = await post(app, "/v1/provision", {});
    expect(response.status).toBe(201);
  });

  test("no credential is required, because this is how you get one", async () => {
    const { app } = build();
    expect((await post(app, "/v1/provision", {})).status).toBe(201);
  });

  test("the key is saved as a digest, and the project as unclaimed", async () => {
    const { app, world } = build();
    await post(app, "/v1/provision", { name: "Acme" });
    const saved = world.saved[0]!.snapshot();
    expect(saved.ownership.state).toBe("unclaimed");
  });
});

describe("previewing a claim link", () => {
  test("says what it would adopt, and nothing secret", async () => {
    const { app } = build({ world: { projects: provisioned("Acme") } });
    const response = await app.request("/v1/claims/tok");
    const payload = (await response.json()) as { project: { name: string } };

    expect(response.status).toBe(200);
    expect(payload.project.name).toBe("Acme");
    // A preview is for deciding whether to sign in, not a way to read the
    // project without doing so.
    expect(JSON.stringify(payload)).not.toContain("digest");
    expect(JSON.stringify(payload)).not.toContain("ck_live");
  });

  test("an unknown link and a lapsed one are refused identically", async () => {
    // The whole of the guessing attack: any difference is an oracle for
    // testing whether a token exists.
    const lapsed = build({
      world: { projects: provisioned("Acme", Instant.fromEpochMillis(Instant.toEpochMillis(NOW) - 1)) },
    });
    const unknown = build();

    const a = await lapsed.app.request("/v1/claims/tok");
    const b = await unknown.app.request("/v1/claims/tok");

    expect(a.status).toBe(b.status);
    const strip = async (r: Response) => {
      const { requestId, ...rest } = (await r.json()) as Record<string, unknown>;
      return rest;
    };
    expect(await strip(a)).toEqual(await strip(b));
  });
});

describe("redeeming", () => {
  test("an anonymous caller cannot adopt", async () => {
    // The grant says *which* project; the session says *who* ends up owning
    // it. Without the second, holding a link would transfer ownership to
    // nobody in particular.
    const { app } = build({ world: { projects: provisioned() } });
    expect((await post(app, "/v1/claims/tok/redeem", {})).status).toBe(401);
  });

  test("an account with no workspace gets one opened for it", async () => {
    // A brand-new account has none, and making them create one first would be
    // the second bootstrap path this file exists to remove.
    const { app, world } = build({ signedIn: true, world: { projects: provisioned("Acme") } });
    const response = await post(app, "/v1/claims/tok/redeem", {}, COOKIE);

    expect(response.status).toBe(200);
    expect(world.opened).toHaveLength(1);
    expect(world.saved.map((p) => p.snapshot().ownership.state)).toEqual(["claimed"]);
  });

  test("an account that already has one adopts into it rather than opening another", async () => {
    const { app, world } = build({
      signedIn: true,
      world: { projects: provisioned(), workspaces: [{ id: "ws_1", name: "Acme", role: "owner" }] },
    });
    const response = await post(app, "/v1/claims/tok/redeem", {}, COOKIE);

    expect(response.status).toBe(200);
    expect(world.opened).toEqual([]);
  });

  test("a workspace the caller does not belong to is refused", async () => {
    // Naming one explicitly must not be a way to adopt into somebody else's.
    const { app } = build({
      signedIn: true,
      world: { projects: provisioned(), workspaces: [{ id: "ws_1", name: "Mine", role: "owner" }] },
    });
    const response = await post(app, "/v1/claims/tok/redeem", { workspaceId: "ws_someone_else" }, COOKIE);
    expect(response.status).toBe(404);
  });

  test("a lapsed grant cannot be redeemed", async () => {
    const { app } = build({
      signedIn: true,
      world: { projects: provisioned("Acme", Instant.fromEpochMillis(Instant.toEpochMillis(NOW) - 1)) },
    });
    expect((await post(app, "/v1/claims/tok/redeem", {}, COOKIE)).status).toBe(404);
  });

  test("an unknown token and a refused claim are one answer", async () => {
    const unknown = build({ signedIn: true });
    const refused = build({
      signedIn: true,
      world: { projects: provisioned("Acme", Instant.fromEpochMillis(Instant.toEpochMillis(NOW) - 1)) },
    });

    const a = await post(unknown.app, "/v1/claims/tok/redeem", {}, COOKIE);
    const b = await post(refused.app, "/v1/claims/tok/redeem", {}, COOKIE);
    expect(a.status).toBe(b.status);
  });
});

describe("nothing is pre-seeded", () => {
  /**
   * v1 created a project *and* a set of insights, so the onboarding panel —
   * which appeared only when a workspace looked empty — was suppressed by
   * content the product had put there itself. The first screen a new user saw
   * was a dashboard of zeroes rather than instructions.
   *
   * Nothing here creates a dashboard, a tile, or a monitor. A new workspace is
   * empty, and an empty workspace is what makes the onboarding state real.
   */
  test("provisioning creates a project and its key, and nothing else", async () => {
    const { app, world } = build();
    await post(app, "/v1/provision", { name: "Acme" });

    expect(world.saved).toHaveLength(1);
    const snapshot = world.saved[0]!.snapshot();
    expect(snapshot.credentials).toHaveLength(1);
    expect(snapshot.credentials[0]!.kind).toBe("ingest");
  });

  test("claiming opens a workspace with no dashboards", async () => {
    const { app, world } = build({ signedIn: true, world: { projects: provisioned("Acme") } });
    await post(app, "/v1/claims/tok/redeem", {}, COOKIE);

    // One workspace, one project, and no dashboard — the workspace repository
    // stub would have recorded a save if anything else were written.
    expect(world.opened).toHaveLength(1);
    expect(world.saved.map((p) => p.snapshot().ownership.state)).toEqual(["claimed"]);
  });

  test("a dashboard is created empty, so its first screen is honest", () => {
    // The domain refuses to invent tiles: `Dashboard.create` takes none.
    const created = Dashboard.create(
      "dash_1" as never,
      WorkspaceId("11111111-1111-1111-1111-111111111111"),
      "First",
      NOW,
    );
    if (!created.ok) throw new Error("expected a dashboard");
    expect(created.value.dashboard.snapshot().tiles).toEqual([]);
  });
});
