/**
 * Management endpoints, over stub ports.
 *
 * The load-bearing test here is the last one: it walks every management
 * response and asserts nothing secret-shaped appears in the bytes. v1's
 * `GET /projects` returned `SELECT *` — `serverKey`, `apiKey` and
 * `claimToken` — to any member of the workspace.
 */

import { describe, expect, test } from "bun:test";
import {
  Analysis,
  Credential,
  CredentialDigest,
  CredentialId,
  CredentialPrefix,
  Dashboard,
  DashboardId,
  Duration,
  Instant,
  Measure,
  Monitor,
  MonitorId,
  Principal,
  Threshold,
  Project,
  ProjectId,
  Window,
  Workspace,
  WorkspaceId,
  WorkspaceLimits,
  type Placement,
} from "@counted/domain";
import {
  CredentialListSchema,
  DashboardListSchema,
  DashboardViewSchema,
  MonitorListSchema,
  ProjectListSchema,
  ProjectViewSchema,
  WorkspaceViewSchema,
} from "@counted/contracts";
import type { EventWriter } from "@counted/ports";
import { createApp } from "../server";
import { Coalescer } from "../ingest/coalescer";
import { stubAccess, silentLogger } from "../server.test";
import type { Config, Dependencies } from "../composition";

const NOW = Date.parse("2026-03-17T15:00:00.000Z");
const at = Instant.fromEpochMillis(NOW);
const WS = WorkspaceId("22222222-2222-2222-2222-222222222222");
const PRJ = ProjectId("33333333-3333-3333-3333-333333333333");
const DASH = DashboardId("55555555-5555-5555-5555-555555555555");
const MON = MonitorId("66666666-6666-6666-6666-666666666666");
const CRED = CredentialId("44444444-4444-4444-4444-444444444444");
const ACC = "acc_alice";
const KEY = "sk_management_key";

/** The strings that must never reach a response body. */
const SECRET = "sk_kP3nR7xQ9wLmZaB4cD6eF8gH0jK2lM4n";
const DIGEST = "9f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff00";
const CLAIM = "ct_bXlDbGFpbVRva2VuVmFsdWVIZXJlMDAw";
const WEBHOOK = "https://hooks.example.com/services/T000/B000/verySecretPath";
const EMAIL = "alice@example.com";

const must = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
  return r.value;
};

const workspace = (): Workspace =>
  must(Workspace.open(WS, "Acme", ACC as never, WorkspaceLimits.UNLIMITED, at)).workspace;

const project = (): Project =>
  must(
    Project.create(
      PRJ,
      "Web",
      WS,
      {
        id: CRED,
        kind: "ingest",
        label: "Default",
        digest: CredentialDigest(DIGEST),
        prefix: CredentialPrefix("ck_aBc123"),
      },
      at,
    ),
  ).project;

const dashboard = (): Dashboard =>
  Dashboard.rehydrate({ id: DASH, workspace: WS, name: "Main", tiles: [], isDefault: true, share: null });

const monitor = (): Monitor =>
  must(
    Monitor.create(
      MON,
      PRJ,
      "Spike",
      Analysis.countOverWindow(Window.lastDays(1)),
      Threshold.above(100),
      at,
      {
        cooldown: Duration.hours(1),
        channels: [
          { kind: "webhook", url: WEBHOOK },
          { kind: "email", address: EMAIL },
        ],
      },
    ),
  ).monitor;

const principal: Principal = {
  kind: "service",
  credential: "c" as never,
  workspace: WS,
  projects: "all",
  scopes: [
    "workspace:read",
    "workspace:admin",
    "projects:read",
    "projects:write",
    "credentials:read",
    "credentials:write",
    "dashboards:read",
    "dashboards:write",
    "monitors:read",
    "monitors:write",
  ],
  onBehalfOf: ACC as never,
};

const config: Config = { databaseUrl: "postgres://stub", port: 8080, release: "test" };

type World = {
  workspaces: Map<string, Workspace>;
  projects: Map<string, Project>;
  dashboards: Map<string, Dashboard>;
  monitors: Map<string, Monitor>;
};

const world = (): World => ({
  workspaces: new Map([[String(WS), workspace()]]),
  projects: new Map([[String(PRJ), project()]]),
  dashboards: new Map([[String(DASH), dashboard()]]),
  monitors: new Map([[String(MON), monitor()]]),
});

const app = (w: World = world(), who: Principal = principal) => {
  const writer: EventWriter = {
    append: async () => ({ accepted: 0, deduplicated: 0, written: [], committedAt: at }),
  };
  const repos = {
    workspaces: {
      find: async (id: unknown) => w.workspaces.get(String(id)) ?? null,
      save: async (ws: Workspace) => void w.workspaces.set(String(ws.snapshot().id), ws),
    },
    projects: {
      find: async (id: unknown) => w.projects.get(String(id)) ?? null,
      listForWorkspace: async () => [...w.projects.values()],
      save: async (p: Project) => void w.projects.set(String(p.snapshot().id), p),
    },
    dashboards: {
      find: async (id: unknown) => w.dashboards.get(String(id)) ?? null,
      listForWorkspace: async () => [...w.dashboards.values()],
      delete: async (id: unknown) => void w.dashboards.delete(String(id)),
      save: async (d: Dashboard) => void w.dashboards.set(String(d.snapshot().id), d),
    },
    monitors: {
      find: async (id: unknown) => w.monitors.get(String(id)) ?? null,
      listForProject: async () => [...w.monitors.values()],
      save: async (m: Monitor) => void w.monitors.set(String(m.snapshot().id), m),
    },
  };

  let n = 0;
  const deps: Dependencies = {
    access: stubAccess({
      principals: { [KEY]: who },
      placements: {
        [WS]: { workspace: WS, project: null } as Placement,
        [PRJ]: { workspace: WS, project: PRJ },
        [DASH]: { workspace: WS, project: null },
        [MON]: { workspace: WS, project: PRJ },
      },
    }),
    log: silentLogger(),
    ids: { next: () => `00000000-0000-7000-8000-${String(n++).padStart(12, "0")}` },
    // Issues a recognisable secret, so the leak test has something to find.
    secrets: {
      issue: () => ({ secret: SECRET, digest: CredentialDigest(DIGEST), prefix: CredentialPrefix("ck_new123") }),
      digest: (s) => s as never,
    },
    quota: { decide: async () => ({ kind: "accept", used: 0, limit: null }) },
    ingest: new Coalescer(writer, { windowMs: 0 }),
    writer,
    store: {
      executeBatch: async () => ({ results: new Map(), stats: { statements: 0, totalMs: 0, coalesced: 0 } }),
      capabilities: () => ({ engine: "stub", approximateDistinct: false, partitioning: "none" }),
    },
    unitOfWork: { transact: async (work: (r: unknown) => unknown) => work(repos) } as unknown as Dependencies["unitOfWork"],
    clock: { now: () => at },
    boot: {
      capabilities: {
        engine: "stub",
        approximateDistinct: false,
        partitioning: "declarative",
        serverVersion: "17",
        timescale: false,
        timeZone: "UTC",
      },
      bucketContract: { ok: true, checked: 48 },
    } as Dependencies["boot"],
    config,
    shutdown: async () => {},
  };
  return createApp(deps);
};

const call = (method: string, path: string, payload?: unknown, w?: World) =>
  app(w ?? world()).request(path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });

describe("reads are resource-shaped and consistent", () => {
  test("a workspace comes back with members, projects and limits", async () => {
    const res = await call("GET", `/v1/workspaces/${WS}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(WorkspaceViewSchema.safeParse(body).success).toBe(true);
    expect(body.members[0]).toMatchObject({ accountId: ACC, role: "owner" });
  });

  test("a project lists its credentials as metadata", async () => {
    const res = await call("GET", `/v1/projects/${PRJ}`);
    const body = await res.json();
    expect(ProjectViewSchema.safeParse(body).success).toBe(true);
    expect(body.credentials[0]).toMatchObject({ prefix: "ck_aBc123", kind: "ingest", status: "active" });
  });

  test("every list uses the same envelope", async () => {
    // v1 returned bare arrays from some endpoints and `{data, meta}` from
    // others, so a client could not write one helper.
    for (const path of [
      `/v1/workspaces/${WS}/projects`,
      `/v1/workspaces/${WS}/dashboards`,
      `/v1/projects/${PRJ}/credentials`,
      `/v1/projects/${PRJ}/monitors`,
    ]) {
      const body = await (await call("GET", path)).json();
      expect(Array.isArray(body.items)).toBe(true);
    }
  });

  test("each list validates against its published schema", async () => {
    expect(ProjectListSchema.safeParse(await (await call("GET", `/v1/workspaces/${WS}/projects`)).json()).success).toBe(true);
    expect(DashboardListSchema.safeParse(await (await call("GET", `/v1/workspaces/${WS}/dashboards`)).json()).success).toBe(true);
    expect(CredentialListSchema.safeParse(await (await call("GET", `/v1/projects/${PRJ}/credentials`)).json()).success).toBe(true);
    expect(MonitorListSchema.safeParse(await (await call("GET", `/v1/projects/${PRJ}/monitors`)).json()).success).toBe(true);
  });

  test("a dashboard reports whether it is shared, not how", async () => {
    const body = await (await call("GET", `/v1/dashboards/${DASH}`)).json();
    expect(DashboardViewSchema.safeParse(body).success).toBe(true);
    expect(body.share).toEqual({ active: false, expiresAt: null });
  });
});

describe("writes go through the aggregate", () => {
  test("creating a project returns its first secret exactly once", async () => {
    const w = world();
    const res = await call("POST", `/v1/workspaces/${WS}/projects`, { name: "Docs" }, w);
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toContain("/v1/projects/");

    const body = await res.json();
    expect(body.credential.secret).toBe(SECRET);

    // And never again: the project read has metadata only.
    const again = await (await call("GET", `/v1/projects/${PRJ}`, undefined, w)).text();
    expect(again).not.toContain(SECRET);
  });

  test("a project is named at creation, not afterwards", async () => {
    // v1 created projects called "My Project" and left renaming to a settings
    // page most people never opened.
    expect((await call("POST", `/v1/workspaces/${WS}/projects`, {})).status).toBe(422);
    expect((await call("POST", `/v1/workspaces/${WS}/projects`, { name: "" })).status).toBe(422);
  });

  test("renaming persists through the repository", async () => {
    const w = world();
    await call("PATCH", `/v1/projects/${PRJ}`, { name: "Renamed" }, w);
    const body = await (await call("GET", `/v1/projects/${PRJ}`, undefined, w)).json();
    expect(body.name).toBe("Renamed");
  });

  test("the last ingest credential cannot be revoked", async () => {
    // The aggregate refuses to leave a project unable to ingest, and the route
    // reports that rather than turning it into a 500.
    const res = await call("DELETE", `/v1/projects/${PRJ}/credentials/${CRED}`);
    expect(res.status).toBe(409);
    expect((await res.json()).detail).toContain("last usable ingest credential");
  });

  test("issuing then revoking works, and revocation is 204", async () => {
    const w = world();
    const issued = await call("POST", `/v1/projects/${PRJ}/credentials`, { kind: "ingest", label: "Second" }, w);
    expect(issued.status).toBe(201);
    const id = (await issued.json()).credential.id;

    const revoked = await call("DELETE", `/v1/projects/${PRJ}/credentials/${id}`, undefined, w);
    expect(revoked.status).toBe(204);

    const list = await (await call("GET", `/v1/projects/${PRJ}/credentials`, undefined, w)).json();
    // Revoked credentials stay listed: an audit needs to see what existed.
    expect(list.items.find((cred: { id: string }) => cred.id === id).status).toBe("revoked");
  });

  test("a service credential without scopes is refused with a usable message", async () => {
    // The aggregate refuses it; the route says which rule was broken rather
    // than flattening it into a generic conflict.
    const res = await call("POST", `/v1/projects/${PRJ}/credentials`, { kind: "service", label: "x" });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.detail).toContain("at least one scope");
    expect(body.fields[0].path).toBe("scopes");
  });

  test("an ingest credential gets events:write whatever scopes were asked for", async () => {
    const body = await (
      await call("POST", `/v1/projects/${PRJ}/credentials`, {
        kind: "ingest",
        label: "Sneaky",
        scopes: ["projects:write", "dashboards:write"],
      })
    ).json();
    expect(body.credential.scopes).toEqual(["events:write"]);
  });

  test("rotation returns a new secret and keeps the old one alive", async () => {
    const w = world();
    // Issue a second one first, so the aggregate will let us rotate.
    await call("POST", `/v1/projects/${PRJ}/credentials`, { kind: "ingest", label: "Second" }, w);
    const res = await call(
      "POST",
      `/v1/projects/${PRJ}/credentials/${CRED}/rotate`,
      { label: "Rotated", overlapHours: 24 },
      w,
    );
    expect(res.status).toBe(201);
    expect((await res.json()).secret).toBe(SECRET);

    const list = await (await call("GET", `/v1/projects/${PRJ}/credentials`, undefined, w)).json();
    // The old one is expiring, not gone. v1 overwrote in place and broke every
    // deployed client at the instant of the click.
    expect(list.items.find((cred: { id: string }) => cred.id === String(CRED)).status).toBe("expiring");
  });

  test("a dashboard is created empty", async () => {
    // v1 auto-populated four insights nobody asked for.
    const body = await (await call("POST", `/v1/workspaces/${WS}/dashboards`, { name: "New" })).json();
    expect(body.tiles).toEqual([]);
  });

  test("deleting a dashboard is 204, and then 404", async () => {
    const w = world();
    expect((await call("DELETE", `/v1/dashboards/${DASH}`, undefined, w)).status).toBe(204);
    expect((await call("GET", `/v1/dashboards/${DASH}`, undefined, w)).status).toBe(404);
  });

  test("disabling a monitor persists, and disabling twice is not an error", async () => {
    const w = world();
    expect((await (await call("PATCH", `/v1/monitors/${MON}`, { enabled: false }, w)).json()).enabled).toBe(false);
    // The outcome the caller asked for is the outcome.
    expect((await call("PATCH", `/v1/monitors/${MON}`, { enabled: false }, w)).status).toBe(200);
  });
});

describe("authorization", () => {
  test("every management route refuses an anonymous caller", async () => {
    for (const [method, path] of [
      ["GET", `/v1/workspaces/${WS}`],
      ["GET", `/v1/workspaces/${WS}/projects`],
      ["GET", `/v1/projects/${PRJ}`],
      ["GET", `/v1/projects/${PRJ}/credentials`],
      ["GET", `/v1/workspaces/${WS}/dashboards`],
      ["GET", `/v1/dashboards/${DASH}`],
      ["GET", `/v1/projects/${PRJ}/monitors`],
      ["GET", `/v1/monitors/${MON}`],
    ] as const) {
      const res = await app().request(path, { method });
      expect({ path, status: res.status }).toMatchObject({ status: 401 });
    }
  });

  test("a credential without the scope is refused", async () => {
    // Reading a project needs `projects:read`; listing its credentials needs
    // `credentials:read`. A key with only the first gets one and not the other.
    const narrow: Principal = { ...principal, scopes: ["projects:read"] } as Principal;
    const application = app(world(), narrow);
    const headers = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };

    expect((await application.request(`/v1/projects/${PRJ}`, { headers })).status).toBe(200);
    expect((await application.request(`/v1/projects/${PRJ}/credentials`, { headers })).status).toBe(403);
  });
});

describe("no response ever carries a secret", () => {
  /**
   * The headline bug, asserted over every management response at once.
   *
   * v1's `GET /projects` returned the whole row — `serverKey`, `apiKey`,
   * `claimToken` — to any member of the workspace. This walks the bytes of
   * every read and asserts nothing secret-shaped is in them.
   */
  const READS = [
    `/v1/workspaces/${WS}`,
    `/v1/workspaces/${WS}/projects`,
    `/v1/workspaces/${WS}/dashboards`,
    `/v1/projects/${PRJ}`,
    `/v1/projects/${PRJ}/credentials`,
    `/v1/projects/${PRJ}/monitors`,
    `/v1/dashboards/${DASH}`,
    `/v1/monitors/${MON}`,
  ];

  test("no read leaks a secret, a digest or a claim token", async () => {
    for (const path of READS) {
      const text = await (await call("GET", path)).text();
      expect({ path, leaked: text.includes(SECRET) }).toMatchObject({ leaked: false });
      expect({ path, leaked: text.includes(DIGEST) }).toMatchObject({ leaked: false });
      expect({ path, leaked: text.includes(CLAIM) }).toMatchObject({ leaked: false });
    }
  });

  test("no read leaks anything shaped like a credential at all", async () => {
    // Broader than the known strings: catches a key we have never seen
    // arriving through a field nobody thought about.
    const CREDENTIAL_SHAPE = /\b(?:ck|sk|st|ct|svc)_[A-Za-z0-9_-]{16,}/;
    for (const path of READS) {
      const text = await (await call("GET", path)).text();
      expect({ path, match: CREDENTIAL_SHAPE.exec(text)?.[0] ?? null }).toMatchObject({ match: null });
    }
  });

  test("a monitor's webhook path is not disclosed, only its host", async () => {
    // A webhook URL routinely carries a token in its path.
    const text = await (await call("GET", `/v1/monitors/${MON}`)).text();
    expect(text).not.toContain("verySecretPath");
    expect(text).toContain("hooks.example.com");
  });

  test("a monitor's notification address is masked", async () => {
    // An email address is personal data about a colleague, and the product's
    // promise is that it stores none.
    const text = await (await call("GET", `/v1/monitors/${MON}`)).text();
    expect(text).not.toContain(EMAIL);
    expect(text).toContain("example.com");
  });

  test("the leak detector has teeth", async () => {
    // A guard that cannot fail is not a guard. The issue endpoint genuinely
    // returns the secret, and the same check catches it there.
    const CREDENTIAL_SHAPE = /\b(?:ck|sk|st|ct|svc)_[A-Za-z0-9_-]{16,}/;
    const text = await (
      await call("POST", `/v1/projects/${PRJ}/credentials`, {
        kind: "service",
        label: "x",
        scopes: ["queries:run"],
      })
    ).text();
    expect(CREDENTIAL_SHAPE.test(text)).toBe(true);
  });
});
