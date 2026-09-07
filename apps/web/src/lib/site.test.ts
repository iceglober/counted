import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isSiteHost, PUBLIC_PATHS, siteOrigin, docsOrigin } from "./site";
import { PUBLIC_PLANS } from "./public-content";
import { overviewMarkdown, authMarkdown, pricingMarkdown } from "./site-markdown";
import { GET as legacyDocs } from "../app/docs/[[...path]]/route";

describe("public site and console share a service", () => {
  test("only known public hosts render the homepage", () => {
    for (const host of ["counted.dev", "COUNTED.DEV", "counted.dev.", "www.counted.dev"]) expect(isSiteHost(host, {})).toBe(true);
    for (const host of [null, "app.counted.dev", "localhost:3000", "127.0.0.1:3000", "counted.dev.evil.example", "evil.example, counted.dev", "evil.example@counted.dev", "counted.dev/path"]) expect(isSiteHost(host, {})).toBe(false);
  });
  test("custom site origins are explicit and do not move the console", () => {
    const env = { COUNTED_SITE_URL: "https://analytics.example.test", COUNTED_CONSOLE_URL: "https://console.example.test" };
    expect(isSiteHost("analytics.example.test", env)).toBe(true);
    expect(isSiteHost("counted.dev", env)).toBe(false);
    expect(isSiteHost("console.example.test", env)).toBe(false);
    expect(isSiteHost("localhost:3103", { COUNTED_SITE_URL: "http://localhost:3103" })).toBe(true);
    expect(siteOrigin({})).toBe("https://counted.dev");
    expect(docsOrigin({})).toBe("https://docs.counted.dev");
  });
  test("all previously published public page paths remain present", () => {
    expect(PUBLIC_PATHS).toEqual(["/", "/pricing", "/about", "/contact", "/privacy", "/terms", "/blog", "/for/agents", "/vs", "/vs/aptabase", "/vs/counter", "/vs/plausible", "/vs/posthog"]);
    for (const path of PUBLIC_PATHS) {
      expect(existsSync(join(import.meta.dir, "../app", path === "/" ? "page.tsx" : `(marketing)${path}/page.tsx`))).toBe(true);
    }
  });
  test("public requests bypass the account API and do not trust forwarded hosts", () => {
    const source = readFileSync(join(import.meta.dir, "../app/page.tsx"), "utf8");
    expect(source.indexOf("return <SiteHome />")).toBeLessThan(source.indexOf("const client = await clientForCaller"));
    expect(source).toContain('headers()).get("host")');
    expect(source).not.toContain("x-forwarded-host");
  });
});

describe("public documentation stays usable", () => {
  test("published allowances match the domain catalog without a privileged web import", () => {
    const source = readFileSync(join(import.meta.dir, "../../../../packages/tenancy/domain/src/plan.ts"), "utf8");
    for (const plan of PUBLIC_PLANS) {
      const block = source.match(new RegExp(`const ${plan.id.toUpperCase()}: Plan = \\{([\\s\\S]*?)\\n\\};`))?.[1];
      expect(block).toBeDefined();
      for (const key of ["eventsPerMonth", "projects", "retentionDays"] as const) {
        const value = block?.match(new RegExp(`${key}: (null|[0-9_]+)`))?.[1];
        expect(value === "null" ? null : Number(value?.replaceAll("_", ""))).toBe(plan[key]);
      }
    }
  });
  test("markdown uses the current SDK, routes, and receipt semantics", () => {
    expect(overviewMarkdown()).toContain('new Counted({ key: "YOUR_INGEST_KEY" })');
    expect(overviewMarkdown()).toContain("/v1/projects/provision");
    expect(overviewMarkdown()).not.toContain("/v1/provision");
    expect(authMarkdown()).toContain("accepted, deduplicated, and rejected");
    expect(authMarkdown()).toContain("Email-link sign-in requires configured transactional email");
    expect(pricingMarkdown()).toContain("Both plans include SDKs, API access");
    expect(pricingMarkdown()).toContain("180 days");
    expect(pricingMarkdown()).toContain("730 days");
  });
  test("legacy docs links redirect and old machine-readable paths remain readable", async () => {
    for (const path of [[], ["api"], ["old-section"], ["api", "anything"]]) {
      const response = await legacyDocs(new Request("https://counted.dev/docs"), { params: Promise.resolve({ path }) });
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(docsOrigin());
    }
    for (const path of [["llms.txt"], ["api", "llms.txt"]]) {
      const response = await legacyDocs(new Request("https://counted.dev/docs/llms.txt"), { params: Promise.resolve({ path }) });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");
      expect(await response.text()).toContain("/v1/projects/provision");
    }
  });
});
