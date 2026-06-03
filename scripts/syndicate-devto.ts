#!/usr/bin/env bun
/**
 * Syndicate the markdown posts in content/syndication/ to dev.to, each with a
 * canonical_url back to counted.dev (so the site stays the SEO-authoritative
 * version). Idempotent: matches existing articles by canonical_url and updates
 * them, otherwise creates. Articles are created with `published: false` from the
 * frontmatter — review on dev.to, then publish.
 *
 *   DEV_TO_API_KEY=... bun scripts/syndicate-devto.ts
 *   DEV_TO_API_KEY=... bun scripts/syndicate-devto.ts --dry-run
 *
 * Get a key: dev.to → Settings → Extensions → API Keys.
 */
export {};

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://dev.to/api";
const DIR = fileURLToPath(new URL("../content/syndication", import.meta.url));
const dryRun = process.argv.includes("--dry-run");

const key = process.env.DEV_TO_API_KEY;
if (!key && !dryRun) {
  console.error("Set DEV_TO_API_KEY (dev.to → Settings → Extensions → API Keys).");
  process.exit(1);
}

function parseFrontmatter(src: string): { data: Record<string, string>; body: string } {
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { data: {}, body: src };
  const data: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { data, body: m[2].trim() };
}

type Article = {
  title: string;
  body_markdown: string;
  published: boolean;
  canonical_url: string;
  description: string;
  tags: string[];
};

function toArticle(data: Record<string, string>, body: string): Article {
  return {
    title: data.title,
    body_markdown: body,
    published: data.published === "true",
    canonical_url: data.canonical_url,
    description: data.description,
    tags: (data.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 4),
  };
}

async function devto(path: string, method: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "api-key": key!, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`dev.to ${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const files = (await readdir(DIR)).filter((f) => f.endsWith(".md"));
console.log(`Syndicating ${files.length} post(s) to dev.to${dryRun ? " [dry-run]" : ""}\n`);

// Map existing articles by canonical_url for idempotent updates.
const existing = dryRun ? [] : ((await devto("/articles/me/all?per_page=1000", "GET")) as { id: number; canonical_url: string | null }[]);
const byCanonical = new Map(existing.filter((a) => a.canonical_url).map((a) => [a.canonical_url, a.id]));

for (const file of files) {
  const { data, body } = parseFrontmatter(await readFile(join(DIR, file), "utf-8"));
  const article = toArticle(data, body);
  const existingId = byCanonical.get(article.canonical_url);

  if (dryRun) {
    console.log(`  ${existingId ? "update" : "create"}: "${article.title}" (published=${article.published}, tags=${article.tags.join(",")})`);
    continue;
  }

  const result = existingId
    ? ((await devto(`/articles/${existingId}`, "PUT", { article })) as { url: string })
    : ((await devto("/articles", "POST", { article })) as { url: string });
  console.log(`  ${existingId ? "updated" : "created"}: ${result.url}`);
}

console.log("\nDone. Review the drafts on dev.to, then publish.");
