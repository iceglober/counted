/**
 * Compile every code example in the SDK READMEs.
 *
 * A README is a second description of an API the code already describes, and
 * two descriptions of one thing go stale — so this compares them mechanically
 * rather than asking anyone to keep them in step.
 *
 * The reason it is worth a script rather than a review habit: these READMEs are
 * **published**. PyPI, crates.io and pkg.go.dev each render one on the package
 * page, and a registry version cannot be withdrawn or corrected — only
 * superseded. An example that does not compile is permanent.
 *
 * It found one on its first run. The Rust quick start called
 * `serde_json::json!` while the install block listed only `counted-sdk`, so the
 * very first thing a reader copied did not build.
 *
 * **Fragments are compiled too.** Most examples are fragments — they carry on
 * from the quick start rather than repeating it — so each language declares the
 * preamble a reader would already have, and a fragment is compiled with it
 * prepended. The alternative, checking only the self-contained blocks, would
 * have missed the `identify` examples entirely, which are the ones documenting
 * the part of the product nothing else covers.
 *
 * Nothing is executed. Every example constructs a client with a real-looking
 * key, and running them would send events from CI.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..");
const SCRATCH = join(ROOT, ".readme-check");

type Block = { readonly index: number; readonly line: number; readonly code: string };

/**
 * Fenced blocks in the given language.
 *
 * The info string is split on `,` so ```` ```rust,no_run ```` counts as rust —
 * rustdoc's own convention, and one somebody may reasonably reach for later.
 */
const blocksOf = (markdown: string, language: string): readonly Block[] => {
  const found: Block[] = [];
  const lines = markdown.split("\n");
  let open: { line: number; code: string[] } | null = null;

  for (const [n, text] of lines.entries()) {
    const fence = /^```(.*)$/.exec(text);
    if (fence === null) {
      open?.code.push(text);
      continue;
    }
    if (open !== null) {
      found.push({ index: found.length + 1, line: open.line, code: open.code.join("\n") });
      open = null;
      continue;
    }
    const info = (fence[1] ?? "").trim().split(",")[0]?.trim();
    if (info === language) open = { line: n + 1, code: [] };
  }
  return found;
};

type Language = {
  readonly name: string;
  readonly readme: string;
  readonly fence: string;
  /** The tool that must be present. Absent means this check cannot run. */
  readonly tool: readonly string[];
  /** True when the block stands alone and needs no preamble. */
  readonly selfContained: (code: string) => boolean;
  /** Lay out a scratch project containing every block. */
  readonly prepare: (dir: string, blocks: readonly Block[]) => void;
  readonly compile: (dir: string) => readonly string[];
};

/**
 * The dependencies the README's own install block tells a reader to add.
 *
 * This is the part that makes the Rust check mean something. The bug it was
 * written for was not a wrong method name — every symbol in the examples
 * existed. It was that the examples used `serde_json` while the install block
 * listed only `counted-sdk`, so following the README produced code that did not
 * build. Compiling the examples against dependencies *this script* chose would
 * have missed it entirely; compiling them against the ones the README names is
 * what catches it.
 *
 * `counted-sdk` is redirected to the local path — the point is to check against
 * the source about to be published, not against whatever is already on
 * crates.io.
 */
const declaredDependencies = (markdown: string): readonly string[] => {
  const toml = blocksOf(markdown, "toml").find((b) => b.code.includes("[dependencies]"));
  if (toml === undefined) return [];
  const after = toml.code.slice(toml.code.indexOf("[dependencies]") + "[dependencies]".length);
  return after
    .split("\n")
    .map((line) => line.trim())
    // Stop at the next table header; take only `name = …` lines.
    .filter((line) => line.length > 0 && !line.startsWith("[") && !line.startsWith("#"))
    .map((line) =>
      /^counted-sdk\s*=/.test(line)
        ? `counted-sdk = { path = ${JSON.stringify(join(ROOT, "packages/rust"))} }`
        : line,
    );
};

const RUST: Language = {
  name: "rust",
  readme: "packages/rust/README.md",
  fence: "rust",
  tool: ["cargo", "--version"],
  selfContained: (code) => /\bfn\s+main\s*\(/.test(code),
  prepare: (dir, blocks) => {
    mkdirSync(join(dir, "src", "bin"), { recursive: true });
    const declared = declaredDependencies(readFileSync(join(ROOT, RUST.readme), "utf8"));
    if (!declared.some((line) => line.startsWith("counted-sdk"))) {
      throw new Error("the Rust README's install block does not mention counted-sdk");
    }
    writeFileSync(
      join(dir, "Cargo.toml"),
      [
        "[package]",
        'name = "readme-check"',
        'version = "0.0.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        ...declared,
        "",
        // Its own lockfile, so this never disturbs the workspace's.
        "[workspace]",
      ].join("\n"),
    );
    for (const block of blocks) {
      const body = RUST.selfContained(block.code)
        ? block.code
        : `fn main() {\n${PREAMBLE.rust}\n${block.code}\n}`;
      // `#[allow(unused)]` because a fragment legitimately builds a client it
      // then only calls two methods on.
      writeFileSync(join(dir, "src", "bin", `block_${block.index}.rs`), `#![allow(unused)]\n${body}\n`);
    }
  },
  compile: (dir) => ["cargo", "build", "--bins", "--manifest-path", join(dir, "Cargo.toml")],
};

const GO: Language = {
  name: "go",
  readme: "packages/go/README.md",
  fence: "go",
  tool: ["go", "version"],
  selfContained: (code) => /^package\s+\w+/m.test(code),
  prepare: (dir, blocks) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "go.mod"),
      [
        "module readmecheck",
        "",
        "go 1.22",
        "",
        "require github.com/iceglober/counted/packages/go/v2 v2.0.0",
        "",
        `replace github.com/iceglober/counted/packages/go/v2 => ${join(ROOT, "packages/go")}`,
        "",
      ].join("\n"),
    );
    for (const block of blocks) {
      const sub = join(dir, `block${block.index}`);
      mkdirSync(sub, { recursive: true });
      const body = GO.selfContained(block.code)
        ? block.code
        : [
            "package main",
            "",
            'import counted "github.com/iceglober/counted/packages/go/v2"',
            "",
            "func main() {",
            PREAMBLE.go,
            block.code,
            "}",
          ].join("\n");
      // Go rejects an unused import, and a self-contained block already has
      // its own. Renaming main to avoid duplicate-main is unnecessary: each
      // block gets its own package directory.
      writeFileSync(join(sub, "main.go"), `${body}\n`);
    }
  },
  compile: (dir) => ["go", "build", "./..."],
};

const PYTHON: Language = {
  name: "python",
  readme: "packages/python/README.md",
  fence: "python",
  // Python has no separate compile step that resolves attributes, so this one
  // checks that every block parses and that every name it uses exists. See
  // `pythonCheck` — it imports rather than runs.
  tool: ["python3", "--version"],
  selfContained: (code) => /^from counted import|^import counted/m.test(code),
  prepare: (dir, blocks) => {
    mkdirSync(dir, { recursive: true });
    for (const block of blocks) {
      const body = PYTHON.selfContained(block.code) ? block.code : `${PREAMBLE.python}\n${block.code}`;
      writeFileSync(join(dir, `block_${block.index}.py`), `${body}\n`);
    }
  },
  compile: (dir) => ["python3", join(ROOT, "scripts/check-readme-python.py"), dir, join(ROOT, "packages/python")],
};

/**
 * What a reader of a fragment already has on screen.
 *
 * An empty key on purpose: every SDK documents that one starts no thread and
 * performs no I/O, so a fragment that *is* executed cannot send anything. The
 * Python check executes; the other two only compile.
 */
const PREAMBLE = {
  rust: '    let counted = counted::Counted::new("");',
  go: "\tc := counted.New(counted.Options{Key: \"\"})\n\t_ = c",
  python: "from counted import Counted\n\ncounted = Counted(key=\"\")",
} as const;

const LANGUAGES: readonly Language[] = [RUST, GO, PYTHON];

const have = (tool: readonly string[]): boolean =>
  spawnSync(tool[0] ?? "", tool.slice(1), { stdio: "ignore" }).status === 0;

const run = (): number => {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const allowMissing = process.argv.includes("--allow-missing-toolchains");
  const selected = wanted.length === 0 ? LANGUAGES : LANGUAGES.filter((l) => wanted.includes(l.name));

  if (selected.length === 0) {
    console.error(`No such SDK. Known: ${LANGUAGES.map((l) => l.name).join(", ")}`);
    return 2;
  }

  rmSync(SCRATCH, { recursive: true, force: true });
  let failed = 0;

  for (const language of selected) {
    const readme = join(ROOT, language.readme);
    if (!existsSync(readme)) {
      console.error(`✗ ${language.name}: ${language.readme} is missing`);
      failed += 1;
      continue;
    }

    const blocks = blocksOf(readFileSync(readme, "utf8"), language.fence);
    if (blocks.length === 0) {
      // A README whose examples all vanished is a change worth noticing, and
      // silently passing on zero blocks is how this check would stop meaning
      // anything.
      console.error(`✗ ${language.name}: no ${language.fence} examples found in ${language.readme}`);
      failed += 1;
      continue;
    }

    if (!have(language.tool)) {
      const message = `${language.name}: ${language.tool[0]} is not installed, so its ${blocks.length} examples were not checked`;
      if (allowMissing) {
        console.warn(`⚠ ${message}`);
        continue;
      }
      // Not a clean skip by default. An unchecked language that reports
      // success is how a broken example reaches a registry.
      console.error(`✗ ${message} (pass --allow-missing-toolchains to downgrade this to a warning)`);
      failed += 1;
      continue;
    }

    const dir = join(SCRATCH, language.name);
    language.prepare(dir, blocks);
    const [command, ...args] = language.compile(dir);
    const result = spawnSync(command ?? "", args, { cwd: dir, encoding: "utf8" });

    if (result.status === 0) {
      console.log(`✓ ${language.name}: ${blocks.length} examples compile`);
      continue;
    }

    failed += 1;
    console.error(`✗ ${language.name}: an example in ${language.readme} does not compile`);
    console.error(`  blocks, in order, start at lines: ${blocks.map((b) => b.line).join(", ")}`);
    console.error((result.stderr || result.stdout || "").trimEnd());
  }

  if (failed === 0) rmSync(SCRATCH, { recursive: true, force: true });
  return failed === 0 ? 0 : 1;
};

process.exit(run());
