/**
 * Release metadata for the four SDKs.
 *
 * None of this is behaviour. All of it is the class of mistake that only shows
 * up after publishing, when the fix is a new version number rather than a
 * commit — a package reporting a version it is not, or a module path a
 * `go get` cannot resolve.
 *
 * It lives beside the other structural gates rather than in each package,
 * because the point of every check here is a comparison *between* packages.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const read = (relative: string): string => readFileSync(join(ROOT, relative), "utf8");

/** What each SDK reports about itself at runtime, and where it says it. */
const RUNTIME_VERSION: readonly { language: string; file: string; pattern: RegExp }[] = [
  { language: "js", file: "packages/sdk-js/src/client.ts", pattern: /SDK_VERSION = "counted-js\/([\d.]+)"/ },
  { language: "python", file: "packages/python/counted/platform.py", pattern: /SDK_VERSION = "counted-python\/([\d.]+)"/ },
  { language: "go", file: "packages/go/platform.go", pattern: /SDKVersion = "counted-go\/([\d.]+)"/ },
  { language: "rust", file: "packages/rust/src/platform.rs", pattern: /SDK_VERSION: &str = "counted-rust\/([\d.]+)"/ },
];

/** What each package *manifest* claims, which is what a registry publishes. */
const MANIFEST_VERSION: readonly { language: string; read: () => string }[] = [
  { language: "js", read: () => (JSON.parse(read("packages/sdk-js/package.json")) as { version: string }).version },
  { language: "python", read: () => /^version = "([^"]+)"/m.exec(read("packages/python/pyproject.toml"))?.[1] ?? "" },
  { language: "go", read: () => read("packages/go/VERSION").trim() },
  { language: "rust", read: () => /^version = "([^"]+)"/m.exec(read("packages/rust/Cargo.toml"))?.[1] ?? "" },
];

const runtimeVersion = (entry: (typeof RUNTIME_VERSION)[number]): string =>
  entry.pattern.exec(read(entry.file))?.[1] ?? "";

describe("a published SDK reports the version it was published as", () => {
  /**
   * The version lives in two places per language — the manifest a registry
   * reads, and the constant stamped on every event — and they had drifted:
   * every manifest said `0.1.1` while every source said `2.0.0`. Publishing
   * that would put `counted-go/2.0.0` in the data for a package resolvable
   * only as `v0.1.1`, and a registry version cannot be corrected, only
   * superseded.
   */
  test("every SDK's manifest and its runtime constant agree", () => {
    const mismatched = RUNTIME_VERSION.map((entry) => {
      const manifest = MANIFEST_VERSION.find((m) => m.language === entry.language);
      return { language: entry.language, runtime: runtimeVersion(entry), manifest: manifest?.read() ?? "" };
    }).filter((v) => v.runtime !== v.manifest);
    expect(mismatched).toEqual([]);
  });

  test("all four SDKs are on the same version", () => {
    // They ship one contract and are asserted against one conformance suite.
    // Letting them drift apart makes "which SDK version has the fix" a
    // question with four answers.
    const versions = new Set(RUNTIME_VERSION.map(runtimeVersion));
    expect({ versions: [...versions] }).toMatchObject({ versions: expect.arrayContaining([]) });
    expect(versions.size).toBe(1);
  });

  test("the check is not vacuous", () => {
    for (const entry of RUNTIME_VERSION) {
      expect({ language: entry.language, version: runtimeVersion(entry) }).toMatchObject({
        version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      });
    }
  });
});

describe("the Go module can actually be fetched", () => {
  const modulePath = (): string => /^module\s+(\S+)/m.exec(read("packages/go/go.mod"))?.[1] ?? "";

  const major = (): number => Number(read("packages/go/VERSION").trim().split(".")[0] ?? "0");

  test("a v2 or later module path carries its major version suffix", () => {
    // Go's rule, not a convention: for major version 2 and above the module
    // path must end in `/vN`. Without it, `go get …@v2.0.0` fails outright —
    // and this is only discoverable after tagging, because the module proxy
    // is what enforces it. A pushed tag cannot be withdrawn.
    const path = modulePath();
    expect({ path, major: major() }).toMatchObject({ major: expect.any(Number) });
    if (major() >= 2) {
      expect({ path, expectedSuffix: `/v${major()}` }).toMatchObject({
        path: expect.stringMatching(new RegExp(`/v${major()}$`)),
      });
    } else {
      expect(path).not.toMatch(/\/v\d+$/);
    }
  });

  test("every import of the module uses the same path it declares", () => {
    // An import of the un-suffixed path resolves locally, inside the module,
    // and fails for everybody else.
    const path = modulePath();
    for (const file of ["packages/go/cmd/conformance/main.go", "packages/go/README.md"]) {
      if (!existsSync(join(ROOT, file))) continue;
      const source = read(file);
      const references = [...source.matchAll(/github\.com\/iceglober\/counted\/packages\/go[\w/.]*/g)].map((m) => m[0]);
      for (const reference of new Set(references)) {
        expect({ file, reference, declared: path }).toMatchObject({ reference: path });
      }
    }
  });

  test("the tag the release workflow pushes matches the module path", () => {
    // A submodule's tag is `<dir>/v<version>`, and for a v2 module the path's
    // own suffix must line up with it. Two strings built in different files
    // that have to agree.
    const workflow = read(".github/workflows/publish-sdks.yml");
    expect(workflow).toContain('TAG="packages/go/v$VERSION"');
    expect(modulePath()).toBe(`github.com/iceglober/counted/packages/go/v${major()}`);
  });
});

describe("the README a registry shows is the API the package has", () => {
  /**
   * A registry page *is* the README. All three documented the v1 API —
   * `counted.init`, `Analytics::new`, `counted.Init` — none of which the
   * packages still export, and none of which anybody would have noticed until
   * a user pasted the quick start and it did not compile.
   *
   * Checked by naming the symbols that were removed, rather than by parsing
   * the examples: a removed name appearing in a README is unambiguous, and a
   * partial parse that silently matched nothing would be worse than no check.
   */
  const REMOVED: readonly { readme: string; symbols: readonly string[] }[] = [
    { readme: "packages/python/README.md", symbols: ["counted.init(", "from counted import Analytics", "Analytics("] },
    { readme: "packages/go/README.md", symbols: ["counted.Init(", "TrackEvent(", "ProjectKey:", "DestroyGlobal"] },
    { readme: "packages/rust/README.md", symbols: ["Analytics::new", "use counted::Analytics"] },
  ];

  test("no README documents a symbol the package removed", () => {
    const stale: { readme: string; symbol: string }[] = [];
    for (const entry of REMOVED) {
      const content = read(entry.readme);
      for (const symbol of entry.symbols) {
        if (content.includes(symbol)) stale.push({ readme: entry.readme, symbol });
      }
    }
    expect(stale).toEqual([]);
  });

  test("each README shows the constructor the package actually exports", () => {
    // The other direction, so "delete every example" would not pass.
    expect(read("packages/python/README.md")).toContain("from counted import Counted");
    expect(read("packages/go/README.md")).toContain("counted.New(counted.Options{");
    expect(read("packages/rust/README.md")).toContain("counted::Counted::new");
  });

  test("those constructors exist in the source", () => {
    expect(read("packages/python/counted/__init__.py")).toContain("Counted");
    expect(read("packages/go/counted.go")).toMatch(/func New\(options Options\) \*Client/);
    expect(read("packages/rust/src/lib.rs")).toMatch(/impl Counted \{[\s\S]*pub fn new/);
  });

  test("the v1 implementations are gone, not merely undocumented", () => {
    // They shipped alongside the v2 client: `Analytics` posting to
    // `/api/v0/event` with a raw `os_name`, reintroducing the one-OS-four-names
    // bug inside the API that looked like the default.
    expect(existsSync(join(ROOT, "packages/rust/examples/conformance.rs"))).toBe(false);
    for (const file of ["packages/go/counted.go", "packages/rust/src/lib.rs"]) {
      expect({ file, source: read(file) }).toMatchObject({
        source: expect.not.stringContaining("/api/v0/event"),
      });
    }
  });
});

describe("each package would publish something installable", () => {
  test("python declares the package it ships", () => {
    const pyproject = read("packages/python/pyproject.toml");
    expect(pyproject).toContain('name = "counted"');
    expect(existsSync(join(ROOT, "packages/python/counted/__init__.py"))).toBe(true);
    expect(existsSync(join(ROOT, "packages/python/README.md"))).toBe(true);
  });

  test("rust publishes under a name crates.io will accept", () => {
    // crates.io has no scopes and `counted` belongs to an unrelated crate, so
    // the package is `counted-sdk` while the library stays `counted` — which
    // is why both names are asserted rather than assumed equal.
    const cargo = read("packages/rust/Cargo.toml");
    expect(cargo).toContain('name = "counted-sdk"');
    expect(cargo).toMatch(/\[lib\][\s\S]*name = "counted"/);
    expect(cargo).toContain("license =");
  });

  test("the workflow publishes exactly the names the manifests declare", () => {
    // The registry name appears in the workflow's own "already published?"
    // probe. If it drifted from the manifest, the probe would check a
    // different package and the guard would pass for the wrong reason.
    const workflow = read(".github/workflows/publish-sdks.yml");
    expect(workflow).toContain("https://pypi.org/pypi/counted/$VERSION/json");
    expect(workflow).toContain("https://crates.io/api/v1/crates/counted-sdk/$VERSION");
  });
});
