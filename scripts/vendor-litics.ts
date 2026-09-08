/**
 * Vendor `@litics/core` into this repository as a workspace package.
 *
 * Why a copy and not a dependency. litics is a private sibling repository,
 * `packages/core` is a subdirectory of it, and the production image is built
 * by `COPY . .` on a machine with no credentials for anything else. A git
 * dependency installs a repository root, not a subdirectory, and needs a
 * token at build time; a private registry needs the same token plus a publish
 * step in litics' CI on every change while the two move together; a submodule
 * is not fetched for private repositories by the builder. A copy checked into
 * this tree works everywhere `COPY . .` works, and `VENDORED.json` records
 * exactly which litics commit it is so the copy can never be mistaken for the
 * source of truth.
 *
 * What the copy looks like. litics' own `package.json` points `main` at a
 * `dist/` that is gitignored, so a copy of the source alone does not resolve.
 * This script rewrites the package so Bun runs the TypeScript source directly
 * (`exports["."].bun`) and `tsc` reads generated declarations
 * (`exports["."].types`). The declarations exist so Counted's type checker
 * never sees litics' source under Counted's stricter compiler flags —
 * `skipLibCheck` applies to `.d.ts`, and litics type-checks its own source in
 * its own CI.
 *
 * Refuses to run against a dirty litics tree: a vendored copy must be
 * reproducible from the recorded commit.
 *
 *   bun scripts/vendor-litics.ts                  # from ../litics
 *   LITICS_PATH=/path/to/litics bun scripts/vendor-litics.ts
 */

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LITICS = resolve(process.env["LITICS_PATH"] ?? join(ROOT, "..", "litics"));

/** litics packages Counted consumes, in dependency order (core's types are read by compactor's tsc). */
const PACKAGES = ["core", "compactor"] as const;
const fail = (message: string): never => {
  console.error(`vendor-litics: ${message}`);
  process.exit(1);
};

const git = (args: string): string =>
  execSync(`git -C ${JSON.stringify(LITICS)} ${args}`, { encoding: "utf8" }).trim();

if (!existsSync(join(LITICS, "packages", "core", "src", "index.ts"))) {
  fail(`no litics checkout at ${LITICS} — set LITICS_PATH`);
}
if (git("status --porcelain") !== "") {
  fail("the litics working tree is dirty; commit or stash it so the vendored copy is reproducible");
}
const commit = git("rev-parse HEAD");

type Manifest = {
  name: string;
  version: string;
  description?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

for (const pkg of PACKAGES) {
  const SOURCE = join(LITICS, "packages", pkg);
  const TARGET = join(ROOT, "vendor", `litics-${pkg}`);
  const upstream = JSON.parse(readFileSync(join(SOURCE, "package.json"), "utf8")) as Manifest;

  rmSync(TARGET, { recursive: true, force: true });
  mkdirSync(TARGET, { recursive: true });
  cpSync(join(SOURCE, "src"), join(TARGET, "src"), { recursive: true });

  const manifest = {
    name: upstream.name,
    version: upstream.version,
    description: `${upstream.description ?? upstream.name} (vendored from iceglober/litics@${commit.slice(0, 12)})`,
    private: true,
    type: "module",
    types: "./types/index.d.ts",
    exports: {
      ".": {
        bun: "./src/index.ts",
        types: "./types/index.d.ts",
        import: "./src/index.ts",
      },
    },
    ...(upstream.dependencies !== undefined ? { dependencies: upstream.dependencies } : {}),
    ...(upstream.peerDependencies !== undefined ? { peerDependencies: upstream.peerDependencies } : {}),
  };
  writeFileSync(join(TARGET, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // A self-contained compiler config: not extending Counted's, so litics'
  // source is checked under litics' assumptions (NodeNext, `.js` specifiers)
  // and only its declarations reach Counted's stricter project.
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      declaration: true,
      emitDeclarationOnly: true,
      rootDir: "src",
      outDir: "types",
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      types: ["node"],
    },
    include: ["src"],
  };
  writeFileSync(join(TARGET, "tsconfig.json"), `${JSON.stringify(tsconfig, null, 2)}\n`);

  writeFileSync(
    join(TARGET, "VENDORED.json"),
    `${JSON.stringify({ source: "iceglober/litics", path: `packages/${pkg}`, commit, vendoredAt: new Date().toISOString() }, null, 2)}\n`,
  );

  writeFileSync(
    join(TARGET, "README.md"),
    [
      `# ${upstream.name} (vendored)`,
      "",
      `A copy of \`packages/${pkg}\` from \`iceglober/litics\` at \`${commit}\`.`,
      "",
      "**Do not edit.** Change litics, commit there, and run `bun scripts/vendor-litics.ts`.",
      "`VENDORED.json` records the commit; `types/` is generated from `src/` by the same script.",
      "",
    ].join("\n"),
  );
}

// Link the workspaces before emitting declarations: compactor's tsc resolves
// `@litics/core` through node_modules to vendor/litics-core.
execSync("bun install", { cwd: ROOT, stdio: "inherit" });
for (const pkg of PACKAGES) {
  execSync(`bun x tsc -p ${JSON.stringify(join(ROOT, "vendor", `litics-${pkg}`, "tsconfig.json"))}`, {
    cwd: ROOT,
    stdio: "inherit",
  });
}

console.log(`vendored ${PACKAGES.map((p) => `@litics/${p}`).join(", ")} from ${commit.slice(0, 12)} into vendor/`);
