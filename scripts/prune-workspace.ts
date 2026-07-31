/**
 * Trim the workspace to one app's dependency closure.
 *
 * Bun installs every workspace the root manifest declares, so an API image
 * built from the repo root installs Next.js, four language SDKs and the
 * conformance harness — which is slow, large, and on a modest builder gets
 * OOM-killed.
 *
 * The obvious alternative is to list each service's workspaces in its
 * Dockerfile. That is three lists that have to agree with `workspaces` in
 * package.json, and the way they go stale is a new package breaking a deploy
 * with "Workspace not found". So the closure is *computed* from the manifests
 * that already exist, and adding a package needs no edit here.
 *
 *   bun scripts/prune-workspace.ts apps/api
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Manifest = {
  name?: string;
  workspaces?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const ROOT = process.cwd();
const target = process.argv[2];
if (target === undefined) {
  console.error("usage: bun scripts/prune-workspace.ts <app-dir>");
  process.exit(1);
}

const read = (dir: string): Manifest | null => {
  const path = join(ROOT, dir, "package.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Manifest) : null;
};

const root = read(".")!;

/** Every workspace directory, expanded from the globs the root declares. */
const directories = (): readonly string[] => {
  const found: string[] = [];
  for (const pattern of root.workspaces ?? []) {
    if (!pattern.endsWith("/*")) {
      if (read(pattern) !== null) found.push(pattern);
      continue;
    }
    const parent = pattern.slice(0, -2);
    for (const child of readdirSync(join(ROOT, parent), { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      const dir = `${parent}/${child.name}`;
      if (read(dir) !== null) found.push(dir);
    }
  }
  return found;
};

const all = directories();
const byName = new Map<string, string>();
for (const dir of all) {
  const manifest = read(dir);
  if (manifest?.name !== undefined) byName.set(manifest.name, dir);
}

/**
 * The closure: the app, plus every workspace it depends on, transitively.
 *
 * Dev dependencies are followed too — `apps/web` needs its own build tooling —
 * but only for workspace packages, which is what the map contains.
 */
const closure = new Set<string>();
const visit = (dir: string): void => {
  if (closure.has(dir)) return;
  closure.add(dir);
  const manifest = read(dir);
  if (manifest === null) return;
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const dependency = byName.get(name);
    if (dependency !== undefined) visit(dependency);
  }
};
visit(target);

/**
 * Drop root dependencies that point at a workspace we just removed.
 *
 * The root manifest is still the v1 app's, and it depends on `@counted/api`
 * and `@counted/sdk` — workspaces outside every v2 service's closure. Leaving
 * them in a pruned manifest makes `bun install` fail to resolve a package that
 * is no longer declared, which reads as a broken lockfile rather than as the
 * pruning it actually is.
 */
const withoutMissing = (deps: Record<string, string> | undefined): Record<string, string> | undefined => {
  if (deps === undefined) return undefined;
  const kept = Object.entries(deps).filter(([name]) => {
    const dir = byName.get(name);
    return dir === undefined || closure.has(dir);
  });
  return Object.fromEntries(kept);
};

const pruned = {
  ...root,
  workspaces: [...closure].sort(),
  dependencies: withoutMissing(root.dependencies),
  devDependencies: withoutMissing(root.devDependencies),
};
writeFileSync(join(ROOT, "package.json"), `${JSON.stringify(pruned, null, 2)}\n`);

console.log(`pruned to ${closure.size} workspaces for ${target}: ${[...closure].sort().join(", ")}`);
