#!/usr/bin/env bun
/**
 * Seed a project with realistic events, through the public API only.
 *
 * `scripts/seed.ts` is v1's: it imports `lib/db/schema`, runs `drizzle-kit
 * push`, and writes v1 tables directly. Pointed at a v2 database it recreates
 * exactly the contamination that broke a deploy — `schema statement 2/11
 * failed: "events" is not partitioned` — because the v2 migration correctly
 * refuses to run against a non-partitioned `events` table. Do not run it.
 *
 * This one touches no schema and holds no credential. It provisions a project
 * the way any caller would, then sends events through `/v1/events`, so it
 * exercises the same path a customer's SDK does and cannot drift from it. It
 * works against production, a preview, or a local API.
 *
 *   bun scripts/seed-events.ts                      # against api.counted.dev
 *   bun scripts/seed-events.ts --days 30 --visits 400
 *   bun scripts/seed-events.ts --api http://localhost:8080
 *   bun scripts/seed-events.ts --key ck_live_…      # into an existing project
 *
 * Deterministic by default: the same `--seed` produces the same data, so a
 * screenshot can be reproduced rather than being a one-off.
 */
export {}; // a module, so the top-level await below is legal

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const API = arg("api", "https://api.counted.dev").replace(/\/$/, "");
const DAYS = Number(arg("days", "30"));
const VISITS = Number(arg("visits", "350"));
const EXISTING_KEY = arg("key", "");

/** Mulberry32 — small, seeded, and good enough for shaped test data. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = rng(Number(arg("seed", "20260801")));

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
const chance = (p: number): boolean => rand() < p;

const PATHS = ["/", "/pricing", "/docs", "/docs/api", "/vs/plausible", "/vs/posthog", "/blog", "/for/agents"];
const REFERRERS = ["", "", "", "news.ycombinator.com", "reddit.com", "google.com", "x.com", "github.com"];
const PLANS = ["free", "pro"];
const BROWSERS = ["Chrome", "Safari", "Firefox", "Edge"];
const OSES = ["macOS", "Windows", "Linux", "iOS", "Android"];

type SeedEvent = {
  name: string;
  visitId: string;
  userId?: string;
  occurredAt: string;
  properties?: Record<string, unknown>;
};

/**
 * A visit is a session of activity, not a person — which is the product's whole
 * identity model. Only visits that sign up get a `userId`, and it arrives on
 * the signup event onward, exactly as `identify()` would deliver it.
 */
const visit = (index: number, now: number): SeedEvent[] => {
  const id = crypto.randomUUID();
  // Weight recent days more heavily so the chart has a visible trend rather
  // than a flat band.
  const dayBack = Math.floor(DAYS * rand() * rand());
  const start = now - dayBack * 86_400_000 - Math.floor(rand() * 10 * 3_600_000);
  const at = (offsetMs: number) => new Date(start + offsetMs).toISOString();

  const base = {
    referrer: pick(REFERRERS),
    browser: pick(BROWSERS),
    os: pick(OSES),
  };

  const events: SeedEvent[] = [];
  let t = 0;

  // Landing.
  events.push({ name: "page_view", visitId: id, occurredAt: at(t), properties: { path: "/", ...base } });

  // A few more pages, most visits bouncing early.
  const depth = chance(0.45) ? 1 : chance(0.6) ? 2 : Math.floor(2 + rand() * 4);
  for (let i = 0; i < depth; i += 1) {
    t += 8_000 + Math.floor(rand() * 90_000);
    events.push({
      name: "page_view",
      visitId: id,
      occurredAt: at(t),
      properties: { path: pick(PATHS), ...base },
    });
  }

  // Funnel: pricing -> signup_started -> signup_completed, narrowing at each
  // step so the funnel chart shows real drop-off.
  if (chance(0.34)) {
    t += 20_000 + Math.floor(rand() * 120_000);
    events.push({ name: "pricing_viewed", visitId: id, occurredAt: at(t), properties: { ...base } });

    if (chance(0.42)) {
      t += 15_000 + Math.floor(rand() * 90_000);
      events.push({
        name: "signup_started",
        visitId: id,
        occurredAt: at(t),
        properties: { plan: pick(PLANS), ...base },
      });

      if (chance(0.55)) {
        // From here the visit has an identity, supplied by us — never derived.
        const userId = `user_${1000 + (index % 140)}`;
        t += 25_000 + Math.floor(rand() * 60_000);
        const plan = chance(0.22) ? "pro" : "free";
        events.push({
          name: "signup_completed",
          visitId: id,
          userId,
          occurredAt: at(t),
          properties: { plan, ...base },
        });

        if (plan === "pro") {
          t += 40_000 + Math.floor(rand() * 200_000);
          events.push({
            name: "plan_upgraded",
            visitId: id,
            userId,
            occurredAt: at(t),
            properties: { plan: "pro", interval: chance(0.3) ? "annual" : "monthly", ...base },
          });
        }

        if (chance(0.5)) {
          t += 30_000 + Math.floor(rand() * 400_000);
          events.push({
            name: "event_ingested",
            visitId: id,
            userId,
            occurredAt: at(t),
            properties: { sdk: pick(["js", "python", "go", "rust"]), ...base },
          });
        }
      }
    }
  }

  return events;
};

const post = async (path: string, body: unknown, key?: string): Promise<Response> =>
  fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
    },
    body: JSON.stringify(body),
  });

const main = async (): Promise<void> => {
  let key = EXISTING_KEY;
  let claimUrl: string | undefined;

  if (key === "") {
    const res = await post("/v1/provision", {});
    if (!res.ok) throw new Error(`provision failed: ${res.status} ${await res.text()}`);
    const p = (await res.json()) as { ingestKey: string; claimUrl: string; project: { id: string } };
    key = p.ingestKey;
    claimUrl = p.claimUrl;
    console.log(`project   ${p.project.id}`);
  }

  const now = Date.now();
  const events: SeedEvent[] = [];
  for (let i = 0; i < VISITS; i += 1) events.push(...visit(i, now));
  // Oldest first, so the ingest order matches the occurrence order.
  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  let accepted = 0;
  let rejected = 0;
  const BATCH = 100;
  for (let i = 0; i < events.length; i += BATCH) {
    const res = await post("/v1/events", { events: events.slice(i, i + BATCH) }, key);
    if (!res.ok) throw new Error(`ingest failed at ${i}: ${res.status} ${await res.text()}`);
    const out = (await res.json()) as { accepted: number; rejected: number };
    accepted += out.accepted;
    rejected += out.rejected;
    process.stdout.write(`\r  ${accepted}/${events.length} events`);
  }

  console.log(`\n\n${accepted} accepted, ${rejected} rejected over ${DAYS} days from ${VISITS} visits`);
  if (claimUrl !== undefined) {
    console.log(`\nClaim it to see the dashboard:\n  ${claimUrl}`);
  }
};

await main();
