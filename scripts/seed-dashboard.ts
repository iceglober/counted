#!/usr/bin/env bun
/**
 * Add a repeatable, richer demo to an existing dashboard through the public API.
 * Requires COUNTED_SEED_KEY, or COUNTED_SEED_EMAIL and COUNTED_SEED_PASSWORD.
 * bun scripts/seed-dashboard.ts --workspace ID --project ID --dashboard ID
 * Defaults to the local API. Reruns update the named demo Insights and retain
 * every other Insight. Events are added only on first setup; --events adds
 * another synthetic batch explicitly.
 */
import type { RouterContractClient } from "@orpc/contract";
import type { RawEvent } from "../packages/ingestion/domain/src/batch";
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { contract, type ContractInputs } from "../packages/contract/src";

const arg = (name: string, fallback = "") => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
};
const api = arg("api", "http://localhost:8080");
const workspaceId = arg("workspace");
const projectId = arg("project");
const dashboardId = arg("dashboard");
const email = process.env.COUNTED_SEED_EMAIL;
const password = process.env.COUNTED_SEED_PASSWORD;
const serviceKey = process.env.COUNTED_SEED_KEY;
if (
  !workspaceId ||
  !projectId ||
  !dashboardId ||
  (!serviceKey && (!email || !password))
)
  throw new Error(
    "Supply --workspace, --project, --dashboard and COUNTED_SEED_KEY (or COUNTED_SEED_EMAIL and COUNTED_SEED_PASSWORD).",
  );
let authority: Record<string, string>;
if (serviceKey) authority = { authorization: `Bearer ${serviceKey}` };
else {
  const signedIn = await fetch(`${api}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: api },
    body: JSON.stringify({ email, password }),
  });
  if (!signedIn.ok) throw new Error(`Sign-in failed (${signedIn.status}).`);
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("Sign-in did not return a session.");
  authority = { cookie };
}
const client = createORPCClient<RouterContractClient<typeof contract>>(
  new OpenAPILink(contract, { origin: api, url: "/", headers: authority }),
);
const initial = (await client.dashboards.get({ dashboardId })).dashboard;
const project = (await client.projects.get({ projectId })).project;
if (initial.workspace !== workspaceId || project.workspace !== workspaceId)
  throw new Error(
    "The project and dashboard must belong to the supplied workspace.",
  );

if (
  !initial.tiles.some((tile) => tile.title === "Acquisition activity") ||
  process.argv.includes("--events")
) {
  const { issued } = await client.credentials.issue({
    projectId,
    kind: "ingest",
    name: "Dashboard demo seed",
  });
  try {
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    const events: RawEvent[] = [];
    for (let i = 0; i < 240; i++) {
      const day = Math.floor((i / 240) ** 1.4 * 14);
      const base = now - day * 86_400_000 - (2 + (i % 10)) * 3_600_000;
      const visitId = `grid-demo-v2-${date}-${i}`;
      const browser = ["Chrome", "Safari", "Firefox", "Edge"][i % 4]!;
      const plan = i % 2 === 0 ? "pro" : "starter";
      const emit = (
        name: string,
        offset: number,
        properties: Record<string, string | number>,
      ) =>
        events.push({
          name,
          visitId,
          idempotencyKey: `${visitId}-${name}-${offset}`,
          occurredAt: new Date(base + offset * 1000).toISOString(),
          properties: { browser, plan, ...properties },
          systemProperties: {
            os_name: i % 3 === 0 ? "iOS" : "macOS",
            locale: i % 5 === 0 ? "fr-FR" : "en-US",
          },
        });
      emit("page_view", 0, {
        path: ["/", "/pricing", "/docs", "/docs/api", "/blog"][i % 5]!,
      });
      emit("page_view", 20, { path: i % 3 === 0 ? "/pricing" : "/docs" });
      if (i % 3 !== 0) emit("signup_started", 60, { path: "/sign-up" });
      if (i % 3 !== 0 && i % 4 !== 0)
        emit("signup_completed", 120, { path: "/welcome" });
      if (i % 3 !== 0 && i % 4 !== 0 && i % 5 !== 0)
        emit("checkout_completed", 180, {
          revenue: plan === "pro" ? 49 : 19,
          path: "/checkout/success",
        });
    }
    for (let offset = 0; offset < events.length; offset += 100) {
      const response = await fetch(`${api}/v1/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${issued.secret}`,
        },
        body: JSON.stringify({ events: events.slice(offset, offset + 100) }),
      });
      const result = await response.json();
      if (!response.ok || result.rejected?.length)
        throw new Error(`Seed events refused: ${JSON.stringify(result)}`);
    }
    console.log(`Submitted ${events.length} synthetic demo events.`);
  } finally {
    await client.credentials.revoke({
      projectId,
      credentialId: issued.credential.id,
    });
  }
}

const window = { kind: "relative", amount: 14, unit: "day" } as const;
const eq = (key: string, value: string) =>
  ({ op: "eq", field: { source: "dimension", key }, value }) as const;
const event = (name: string) => eq("event_type", name);
type AddInsight = ContractInputs["tiles"]["add"];
const demos: (Omit<AddInsight, "dashboardId" | "project"> & {
  height: number;
})[] = [
  {
    title: "Active visits",
    view: "number",
    width: 3,
    height: 3,
    analysis: {
      shape: "scalar",
      measure: { kind: "unique", basis: "visit" },
      window,
      summary: "total",
      where: event("page_view"),
    },
  },
  {
    title: "Acquisition activity",
    view: "line",
    width: 8,
    height: 7,
    analysis: {
      shape: "series",
      measure: { kind: "count" },
      window,
      grain: "day",
      where: {
        op: "in",
        field: { source: "dimension", key: "event_type" },
        values: ["page_view", "signup_started", "signup_completed"],
      },
      by: { source: "dimension", key: "event_type" },
      limit: 3,
    },
  },
  {
    title: "Page views by OS and locale",
    view: "table",
    width: 6,
    height: 8,
    analysis: {
      shape: "breakdown",
      measure: { kind: "count" },
      window,
      where: event("page_view"),
      by: [
        { source: "dimension", key: "os_name" },
        { source: "dimension", key: "locale" },
      ],
      limit: 8,
      order: "desc",
    },
  },
  {
    title: "Signup to checkout",
    view: "funnel",
    width: 6,
    height: 6,
    analysis: {
      shape: "funnel",
      funnel: {
        window,
        basis: "visit",
        conversionWindowMs: 1_800_000,
        steps: ["page_view", "signup_completed", "checkout_completed"].map(
          (name) => ({ label: name, events: [name] }),
        ),
      },
    },
  },
  {
    title: "Visits by OS",
    view: "bar",
    width: 4,
    height: 7,
    analysis: {
      shape: "breakdown",
      measure: { kind: "unique", basis: "visit" },
      window,
      where: event("page_view"),
      by: { source: "dimension", key: "os_name" },
      limit: 5,
      order: "desc",
    },
  },
  {
    title: "Completed checkouts",
    view: "number",
    width: 3,
    height: 3,
    analysis: {
      shape: "scalar",
      measure: { kind: "count" },
      window,
      summary: "total",
      where: event("checkout_completed"),
    },
  },
  {
    title: "Checkouts by locale",
    view: "bar",
    width: 6,
    height: 5,
    analysis: {
      shape: "breakdown",
      measure: { kind: "count" },
      window,
      where: event("checkout_completed"),
      by: { source: "dimension", key: "locale" },
      limit: 5,
      order: "desc",
    },
  },
];
// Validate each analysis against the real project before putting it on the dashboard.
for (const { analysis, title } of demos) {
  const { readout } = await client.queries.run({ projectId, analysis });
  console.log(`Validated ${title}: ${readout.value.shape}`);
}
for (const { height, ...demo } of demos) {
  const existing = initial.tiles.find((tile) => tile.title === demo.title);
  if (existing)
    await client.tiles.update({
      dashboardId,
      tileId: existing.id,
      title: demo.title,
      analysis: demo.analysis,
      view: demo.view,
    });
  else await client.tiles.add({ ...demo, dashboardId, project: projectId });
}
const updated = (await client.dashboards.get({ dashboardId })).dashboard;
const demoByTitle = new Map(demos.map((demo) => [demo.title, demo]));
const featured = [
  "Acquisition activity",
  "Visits by OS",
  "Page views by OS and locale",
  "Signup to checkout",
];
const rank = (tile: (typeof updated.tiles)[number]) =>
  tile.view === "number"
    ? -1
    : featured.includes(tile.title)
      ? featured.indexOf(tile.title)
      : 100;
const ordered = [...updated.tiles].sort((a, b) => rank(a) - rank(b));
let x = 0,
  y = 0,
  height = 0;
const placements = ordered.map((tile) => {
  const demo = demoByTitle.get(tile.title);
  const width = demo?.width ?? (tile.view === "number" ? 3 : tile.width);
  const h = demo?.height ?? (tile.view === "number" ? 3 : 6);
  if (x + width > 12) {
    y += height;
    x = 0;
    height = 0;
  }
  const placed = { id: tile.id, x, y, width, height: h };
  x += width;
  height = Math.max(height, h);
  return placed;
});
await client.dashboards.layout({ dashboardId, placements });
console.log(
  `Updated ${demos.length} advanced Insights; ${updated.tiles.length} total. Layout saved.`,
);
console.log(
  `${api.replace(/:8080$/, ":3000")}/w/${workspaceId}/dashboards/${dashboardId}`,
);
