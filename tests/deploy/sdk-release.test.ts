import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = { if?: string; permissions?: Record<string, string>; concurrency?: Record<string, unknown>; steps: Step[] };
const root = resolve(import.meta.dir, "../..");
const workflow = Bun.YAML.parse(await readFile(join(root, ".github/workflows/release-sdks.yml"), "utf8")) as {
  on: Record<string, unknown>; jobs: { version: Job; publish: Job };
};
const ci = Bun.YAML.parse(await readFile(join(root, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, unknown> };
const sha = "a".repeat(40);
const other = "b".repeat(40);
const repository = "example/counted";
const run = {
  id: 123, head_sha: sha, head_branch: "main", event: "push", status: "completed", conclusion: "success",
  head_repository: { full_name: repository },
};
type Scenario = {
  existingWarnings?: Record<string, string>; olderWarningMissing?: string; retirementMetadataFailure?: boolean; missingPackage?: string; requested?: string; checkout?: string; main?: string; ancestor?: boolean;
  ci?: unknown[]; deploy?: unknown[]; ghFailure?: boolean; healthFailure?: boolean;
  health?: unknown; malformedHealth?: boolean; manifest?: unknown; artifacts?: unknown[]; malformedArchive?: boolean; archiveName?: string; archiveFailure?: boolean; changesets?: Array<{ id: string; releases: unknown[] }>;
};
type Call = { command: string; args: string[] };

// Execute the workflow's actual shell with a closed PATH. These local stubs
// provide all external state; tests cannot publish or contact GitHub/production.
const stub = `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const dir = process.env.FIXTURE_DIR;
const s = JSON.parse(readFileSync(dir + "/scenario.json", "utf8"));
const [command, ...args] = process.argv.slice(2);
appendFileSync(dir + "/calls.jsonl", JSON.stringify({ command, args }) + "\\n");
const output = value => process.stdout.write(JSON.stringify(value) + "\\n");
if (command === "git") {
  if (args.join(" ") === "rev-parse HEAD") console.log(s.checkout);
  else if (args.join(" ") === "rev-parse origin/main") console.log(s.main);
  else if (args[0] === "merge-base") process.exit(s.ancestor === false ? 1 : 0);
  else process.exit(90);
} else if (command === "gh") {
  if (s.ghFailure) process.exit(91);
  const route = args.find(arg => arg.includes("/actions/workflows/"));
  if (route === "repos/example/counted/actions/workflows/ci.yml/runs") output([{workflow_runs:s.ci}]);
  else if (route === "repos/example/counted/actions/workflows/deploy.yml/runs") output([{workflow_runs:s.deploy}]);
  else if (args.some(arg => arg === "repos/example/counted/actions/runs/123/artifacts")) output([{artifacts:s.artifacts}]);
  else if (args.some(arg => arg === "repos/example/counted/actions/artifacts/456/zip")) {
    if (s.archiveFailure) process.exit(97);
    if (s.malformedArchive) console.log("not a zip");
    else {
      const script = "import io,json,sys,zipfile; v=json.load(sys.stdin); b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); z.writestr(v['name'],json.dumps(v['manifest'])); z.close(); sys.stdout.buffer.write(b.getvalue())";
      const result = spawnSync(process.env.FIXTURE_PYTHON, ["-c", script], {input:JSON.stringify({name:s.archiveName,manifest:s.manifest})});
      if (result.status !== 0) process.exit(98);
      process.stdout.write(result.stdout);
    }
  } else process.exit(92);
} else if (command === "curl") {
  if (s.healthFailure) process.exit(22);
  if (args.at(-1) !== "https://api.counted.dev/health/ready") process.exit(93);
  if (s.malformedHealth) console.log("not JSON"); else output(s.health);
} else if (command === "npm") {
  if (args[0] === "view") {
    if (args[1] === s.missingPackage) process.exit(1);
    if (args[2] === "deprecated") {
      const separator = args[1].lastIndexOf("@");
      const name = args[1].slice(0, separator);
      const version = args[1].slice(separator + 1);
      const warning = s.olderWarningMissing === name && version === "0.1.0" ? "" :
        (s.existingWarnings?.[args[1]] ?? s.existingWarnings?.[name] ?? "");
      console.log(warning);
    } else if (args[2] === "versions") {
      if (s.retirementMetadataFailure) process.exit(1);
      output(["0.1.0", "2.0.0"]);
    } else console.log(args[2] === "version" ? "2.0.0" : "^2.0.0");
  } else if (args[0] !== "deprecate") process.exit(99);
} else if (command === "bun") {
  if (args[0] === "run" && args[1] === "changeset" && args[2] === "status") {
    writeFileSync(args[args.indexOf("--output") + 1], JSON.stringify({changesets:s.changesets}));
  } else if (args[0] === "-e") {
    const result = spawnSync(process.execPath, args, {stdio:"inherit",env:process.env});
    process.exit(result.status ?? 94);
  } else process.exit(95);
} else process.exit(96);
`;

async function step(name: string, overrides: Scenario = {}) {
  const shell = [...workflow.jobs.version.steps, ...workflow.jobs.publish.steps].find(s => s.name === name)?.run;
  if (!shell) throw new Error(`No workflow shell for ${name}`);
  const dir = await mkdtemp(join(tmpdir(), "counted-sdk-release-"));
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const scenario: Scenario = {
    requested: sha, checkout: sha, main: sha, ci: [run],
    deploy: [{ ...run, event: "workflow_run" }],
    health: { status: "ready", service: "counted-api", release: sha },
    artifacts: [{ id: 456, name: "counted-production-release", expired: false, size_in_bytes: 1024 }],
    manifest: { release: sha, services: { "counted-api": "api-id", "counted-worker": "worker-id", "counted-mcp": "mcp-id", "counted-web": "web-id", "counted-docs": "docs-id" } },
    archiveName: "counted-production-release.json", changesets: [], ...overrides,
  };
  try {
    await writeFile(join(dir, "scenario.json"), JSON.stringify(scenario));
    await writeFile(join(dir, "stub.js"), stub);
    await writeFile(join(dir, "calls.jsonl"), "");
    await mkdir(join(dir, ".changeset"));
    await symlink(join(root, "node_modules"), join(dir, "node_modules"));
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "counted-release-fixture", private: true }));
    for (const change of scenario.changesets ?? []) {
      if (/^[a-zA-Z0-9_-]+$/.test(change.id)) await writeFile(join(dir, ".changeset", `${change.id}.md`),
        `---\n${change.releases.length ? '"@counted/sdk": patch\n' : ""}---\nRelease fixture.\n`);
    }
    for (const command of ["git", "gh", "curl", "bun", "npm"]) {
      const path = join(dir, command);
      await writeFile(path, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(dir, "stub.js"))} ${quote(command)} "$@"\n`);
      await chmod(path, 0o700);
    }
    const jq = Bun.which("jq");
    if (!jq) throw new Error("jq required, as on the GitHub runner");
    await symlink(jq, join(dir, "jq"));
    const python = Bun.which("python3");
    if (!python) throw new Error("Python3 required, as on the GitHub runner");
    await symlink(python, join(dir, "python3"));
    const child = Bun.spawn(["/bin/bash", "-c", shell], {
      cwd: dir,
      env: { PATH: dir, FIXTURE_DIR: dir, FIXTURE_PYTHON: python, RUNNER_TEMP: dir, REQUESTED_SHA: scenario.requested!, TESTED_SHA: scenario.requested!, GITHUB_REPOSITORY: repository, GH_TOKEN: "fixture-only" },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const calls = (await readFile(join(dir, "calls.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Call);
    const emptyNoteExists = await Bun.file(join(dir, ".changeset", "empty-note.md")).exists();
    return { code, stdout, stderr, calls, emptyNoteExists };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("SDK workflow separation", () => {
  test("CI cannot publish; only an explicit main dispatch can publish packages", () => {
    expect(ci.jobs.release).toBeUndefined();
    expect(workflow.on.workflow_dispatch).toBeDefined();
    expect(workflow.jobs.publish.if).toBe("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
    expect(workflow.jobs.publish.concurrency).toEqual({ group: "deploy-production", "cancel-in-progress": false });
    const publish = workflow.jobs.publish.steps.find(s => s.name === "Publish npm packages")!;
    expect(publish.uses).toBe("changesets/action@v1");
    expect(publish.with?.publish).toBe("bun run release");
    expect(workflow.jobs.publish.steps.findIndex(s => s.name === "Verify production release")).toBe(workflow.jobs.publish.steps.indexOf(publish) - 2);
    const journeys = workflow.jobs.publish.steps[workflow.jobs.publish.steps.indexOf(publish) - 1]!;
    expect(journeys.run).toBe("bun scripts/smoke.ts");
    expect(journeys.env?.SMOKE_MODE).toBe("release");
    expect(journeys.env?.SMOKE_EXPECTED_RELEASE).toBe("${{ inputs.sha }}");
    for (const key of ["SMOKE_CLIENT_KEY", "SMOKE_SERVICE_KEY", "SMOKE_PROJECT_ID"]) expect(journeys.env?.[key]).toBeDefined();
    expect(workflow.jobs.publish.steps[0]?.with?.["persist-credentials"]).toBe(false);
    for (const s of workflow.jobs.publish.steps.filter(s => s !== publish)) expect(s.env?.NPM_TOKEN).toBeUndefined();
  });

  test("version PRs require this repository's successful main-push CI and cannot publish", () => {
    for (const condition of ["conclusion == 'success'", "event == 'push'", "head_branch == 'main'", "head_repository.full_name == github.repository"])
      expect(workflow.jobs.version.if).toContain(condition);
    const action = workflow.jobs.version.steps.find(s => s.uses === "changesets/action@v1")!;
    expect(action.with?.version).toBe("bun run version-packages");
    expect(action.with?.publish).toBeUndefined();
    expect(action.env?.NPM_TOKEN).toBeUndefined();
  });

  test("version PR refuses stale main or checkout state", async () => {
    expect((await step("Verify version source")).code).toBe(0);
    for (const scenario of [{ main: other }, { checkout: other }, { requested: "main" }])
      expect((await step("Verify version source", scenario)).code).not.toBe(0);
  });
});

describe("SDK publication eligibility", () => {
  test("accepts only an immutable main SHA with successful matching push CI", async () => {
    const result = await step("Verify release eligibility");
    expect(result.code).toBe(0);
    expect(result.calls.find(c => c.command === "gh")?.args).toContain("repos/example/counted/actions/workflows/ci.yml/runs");
  });

  for (const [label, scenario] of [
    ["branch instead of SHA", { requested: "main" }], ["short SHA", { requested: "abc123" }],
    ["checkout mismatch", { checkout: other }], ["not on main", { ancestor: false }],
    ["missing CI", { ci: [] }], ["unavailable CI", { ghFailure: true }],
    ["other commit", { ci: [{ ...run, head_sha: other }] }],
    ["other branch", { ci: [{ ...run, head_branch: "feature" }] }],
    ["pull request CI", { ci: [{ ...run, event: "pull_request" }] }],
    ["failed CI", { ci: [{ ...run, conclusion: "failure" }] }],
    ["pending CI", { ci: [{ ...run, status: "in_progress" }] }],
    ["other repository", { ci: [{ ...run, head_repository: { full_name: "other/counted" } }] }],
  ] as const) test(`refuses ${label}`, async () => {
    expect((await step("Verify release eligibility", scenario as Scenario)).code).not.toBe(0);
  });

  test("empty notes allow existing versions; real pending changes require their version PR", async () => {
    const empty = await step("Require versioned packages", { changesets: [{ id: "empty-note", releases: [] }] });
    expect(empty.code).toBe(0);
    expect(empty.emptyNoteExists).toBe(false);
    const pending = await step("Require versioned packages", { changesets: [{ id: "empty-note", releases: [{ name: "@counted/sdk", type: "patch" }] }] });
    expect(pending.code).not.toBe(0);
    expect(pending.emptyNoteExists).toBe(true);
  });
});

test("installed Changesets reader permits empty notes without requiring a local git branch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "counted-real-changesets-"));
  const fromCli = createRequire(createRequire(join(root, "package.json")).resolve("@changesets/cli/package.json"));
  const readChangesets = fromCli("@changesets/read").default as (cwd: string) => Promise<unknown[]>;
  const shell = workflow.jobs.publish.steps.find(s => s.name === "Require versioned packages")!.run!;
  try {
    await mkdir(join(dir, ".changeset"));
    await symlink(join(root, "node_modules"), join(dir, "node_modules"));
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "counted-release-fixture", private: true }));
    await writeFile(join(dir, ".changeset/config.json"), await readFile(join(root, ".changeset/config.json")));
    await writeFile(join(dir, ".changeset/empty-note.md"), "---\n---\nNo package version change.\n");
    const child = Bun.spawn(["/bin/bash", "-c", shell], {
      cwd: dir, env: { PATH: process.env.PATH!, RUNNER_TEMP: dir }, stdout: "pipe", stderr: "pipe",
    });
    const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
    expect(error).not.toContain("error");
    expect(code).toBe(0);
    expect(await readChangesets(dir)).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

describe("SDK production gate", () => {
  test("matching completed Deploy plus live readiness permits publication", async () => {
    const result = await step("Verify production release");
    expect(result.code).toBe(0);
    expect(result.calls.find(c => c.command === "gh")?.args).toContain("repos/example/counted/actions/workflows/deploy.yml/runs");
    expect(result.calls.find(c => c.command === "curl")?.args).toContain("--max-time");
  });

  test("uses the attested resolved release even when dispatch metadata names another main SHA", async () => {
    const result = await step("Verify production release", { deploy: [{ ...run, head_sha: other, event: "workflow_dispatch" }] });
    expect(result.code).toBe(0);
    expect(result.calls.find(c => c.command === "gh")?.args.some(arg => arg.startsWith("head_sha="))).toBe(false);
  });

  for (const [label, scenario] of [
    ["missing Deploy", { deploy: [] }], ["unavailable Deploy evidence", { ghFailure: true }],
    ["missing artifact", { artifacts: [] }],
    ["expired artifact", { artifacts: [{ id: 456, name: "counted-production-release", expired: true, size_in_bytes: 1024 }] }],
    ["unrelated artifact", { artifacts: [{ id: 456, name: "other", expired: false, size_in_bytes: 1024 }] }],
    ["oversized artifact", { artifacts: [{ id: 456, name: "counted-production-release", expired: false, size_in_bytes: 999999 }] }],
    ["unavailable archive", { archiveFailure: true }], ["invalid archive", { malformedArchive: true }],
    ["unexpected archive file", { archiveName: "../counted-production-release.json" }],
    ["wrong resolved release despite matching workflow ref", { manifest: { release: other, services: { "counted-api": "api-id", "counted-worker": "worker-id", "counted-mcp": "mcp-id", "counted-web": "web-id", "counted-docs": "docs-id" } } }],
    ["partial release manifest", { manifest: { release: sha, services: { "counted-api": "api-id" } } }],
    ["repeated deployment IDs", { manifest: { release: sha, services: { "counted-api": "same", "counted-worker": "same", "counted-mcp": "same", "counted-web": "same", "counted-docs": "same" } } }],
    ["pending Deploy", { deploy: [{ ...run, status: "in_progress", event: "workflow_run" }] }],
    ["failed Deploy", { deploy: [{ ...run, conclusion: "failure", event: "workflow_run" }] }],
    ["unrelated workflow event", { deploy: [run] }],
    ["other branch", { deploy: [{ ...run, head_branch: "feature", event: "workflow_run" }] }],
    ["other repo", { deploy: [{ ...run, head_repository: { full_name: "other/counted" }, event: "workflow_run" }] }],
    ["unreachable readiness", { healthFailure: true }], ["malformed readiness", { malformedHealth: true }],
    ["not ready", { health: { status: "not_ready", service: "counted-api", release: sha } }],
    ["stale release despite successful Deploy", { health: { status: "ready", service: "counted-api", release: other } }],
    ["missing live release", { health: { status: "ready", service: "counted-api" } }],
    ["other service", { health: { status: "ready", service: "other", release: sha } }],
  ] as const) test(`refuses ${label}`, async () => {
    expect((await step("Verify production release", scenario as Scenario)).code).not.toBe(0);
  });
});


describe("retired package replacement gate", () => {
  test("retires legacy names only after all replacements are published", async () => {
    const result = await step("Retire replaced and discontinued packages");
    expect(result.code).toBe(0);
    expect(result.calls.filter(c => c.command === "npm" && c.args[0] === "deprecate").map(c => c.args[1]))
      .toEqual(["@counted/agent", "@counted/agent-core", "@counted/migrate"]);
  });

  for (const missingPackage of ["@counted/agent-telemetry@2.0.0", "@counted/claude-code@2.0.1", "@counted/opencode@2.0.1"])
    test(`leaves existing packages alone if ${missingPackage} is unavailable`, async () => {
      const result = await step("Retire replaced and discontinued packages", { missingPackage });
      expect(result.code).not.toBe(0);
      expect(result.calls.filter(c => c.args[0] === "deprecate")).toEqual([]);
    });
});


describe("idempotent npm retirement", () => {
  const warnings = {
    "@counted/sdk@0.1.2": "This version targets the retired Counted API. Upgrade to @counted/sdk@2 or later and follow https://docs.counted.dev/getting-started.",
    "@counted/agent": "Replaced by @counted/agent-telemetry. Update your package and imports; the counted-agent command is unchanged.",
    "@counted/agent-core": "Merged into @counted/agent-telemetry. Import the shared tracking APIs from @counted/agent-telemetry.",
    "@counted/migrate": "Discontinued. Counted no longer provides or maintains this migration utility.",
  };
  test("skips the SDK warning when it is already present", async () => {
    const result = await step("Warn users of the retired SDK version", { existingWarnings: warnings });
    expect(result.code).toBe(0);
    expect(result.calls.filter(c => c.args[0] === "deprecate")).toEqual([]);
    const missing = await step("Warn users of the retired SDK version");
    expect(missing.code).toBe(0);
    expect(missing.calls.filter(c => c.args[0] === "deprecate").map(c => c.args[1])).toEqual(["@counted/sdk@0.1.2"]);
  });
  test("skips legacy packages only when every version carries the warning", async () => {
    const result = await step("Retire replaced and discontinued packages", { existingWarnings: warnings });
    expect(result.code).toBe(0);
    expect(result.calls.filter(c => c.args[0] === "deprecate")).toEqual([]);
    const partial = await step("Retire replaced and discontinued packages", { existingWarnings: warnings, olderWarningMissing: "@counted/agent" });
    expect(partial.code).toBe(0);
    expect(partial.calls.filter(c => c.args[0] === "deprecate").map(c => c.args[1])).toEqual(["@counted/agent"]);
  });
  test("does not write when retirement metadata is unavailable", async () => {
    const result = await step("Retire replaced and discontinued packages", { retirementMetadataFailure: true });
    expect(result.code).not.toBe(0);
    expect(result.calls.filter(c => c.args[0] === "deprecate")).toEqual([]);
  });
});
