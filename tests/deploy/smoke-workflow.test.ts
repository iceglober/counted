import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Step = { name?: string; id?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
const workflow = Bun.YAML.parse(await readFile(new URL("../../.github/workflows/smoke.yml", import.meta.url), "utf8")) as {
  jobs: { smoke: { if: string; steps: Step[] } };
};
const steps = workflow.jobs.smoke.steps;
const selection = steps.find((step) => step.name === "Select the live production release")!;
type Scenario = { release?: "rollback" | "main" | "unrelated" | "unknown" | "missing" | "short" | "branch" | "uppercase" | "newline"; ready?: boolean; unavailable?: boolean; malformed?: boolean };

// Run the workflow's actual shell against a real, disposable Git history.
// Only curl is stubbed; the closed PATH cannot make any provider calls.
async function select(scenario: Scenario = {}) {
  const directory = await mkdtemp(join(tmpdir(), "counted-smoke-workflow-"));
  const git = Bun.which("git");
  const jq = Bun.which("jq");
  if (!git || !jq) throw new Error("git and jq are required, as on the Actions runner");
  const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  const runGit = async (...args: string[]) => {
    const process = Bun.spawn([git, ...args], { cwd: directory, env: environment, stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    if (code) throw new Error(err);
    return out.trim();
  };
  try {
    const template = join(directory, "empty-template");
    await mkdir(template);
    await runGit("init", "--initial-branch=main", `--template=${template}`);
    await runGit("config", "user.name", "Smoke fixture");
    await runGit("config", "user.email", "smoke@example.invalid");
    await runGit("-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "First main revision");
    const rollback = await runGit("rev-parse", "HEAD");
    await runGit("-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "Current main revision");
    const main = await runGit("rev-parse", "HEAD");
    await runGit("update-ref", "refs/remotes/origin/main", main);
    const unrelated = await runGit("commit-tree", "HEAD^{tree}", "-p", rollback, "-m", "Not merged to main");
    const releases = { rollback, main, unrelated, unknown: "f".repeat(40), missing: undefined, short: rollback.slice(0, 7), branch: "main", uppercase: "A".repeat(40), newline: rollback + "\n" };
    const release = releases[scenario.release ?? "rollback"];
    const body = scenario.malformed ? "invalid json" : JSON.stringify({ status: scenario.ready === false ? "not_ready" : "ready", release });
    await writeFile(join(directory, "readiness.txt"), body);
    const bin = join(directory, "bin");
    await mkdir(bin);
    await symlink(git, join(bin, "git"));
    await symlink(jq, join(bin, "jq"));
    await writeFile(join(directory, "curl.ts"), `
      if (process.argv.at(-1) !== "https://api.counted.dev/health/ready") process.exit(90);
      if (process.env.FIXTURE_HTTP_ERROR === "1") process.exit(22);
      process.stdout.write(await Bun.file(process.env.FIXTURE_BODY!).text());
    `);
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const curl = join(bin, "curl");
    await writeFile(curl, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(directory, "curl.ts"))} "$@"\n`);
    await chmod(curl, 0o700);
    const output = join(directory, "github-output");
    await writeFile(output, "");
    if (!selection.run) throw new Error("Missing release selection shell");
    const child = Bun.spawn(["/bin/bash", "-c", selection.run], {
      cwd: directory,
      env: { ...environment, PATH: bin, SMOKE_API_URL: "https://api.counted.dev", GITHUB_OUTPUT: output, FIXTURE_BODY: join(directory, "readiness.txt"), FIXTURE_HTTP_ERROR: scenario.unavailable ? "1" : "0" },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr, output: await readFile(output, "utf8"), head: await runGit("rev-parse", "HEAD"), rollback, main, release };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("standalone smoke release selection", () => {
  test("trusted main workflow selects source before passing an expected SHA to release smoke", () => {
    expect(workflow.jobs.smoke.if).toContain("github.ref == 'refs/heads/main'");
    expect(workflow.jobs.smoke.if).toContain("github.event.workflow_run.head_repository.full_name == github.repository");
    const checkout = steps.find((step) => step.uses === "actions/checkout@v4");
    expect(checkout?.with).toEqual({ ref: "main", "fetch-depth": 0, "persist-credentials": false });
    const smoke = steps.find((step) => step.name === "Run smoke checks")!;
    expect(steps.indexOf(selection)).toBeLessThan(steps.indexOf(smoke));
    expect(selection.env?.SMOKE_CLIENT_KEY).toBeUndefined();
    expect(selection.env?.SMOKE_SERVICE_KEY).toBeUndefined();
    expect(smoke.env?.SMOKE_MODE).toBe("release");
    expect(smoke.env?.SMOKE_EXPECTED_RELEASE).toBe("${{ steps.release.outputs.sha }}");
    expect(smoke.run).toBe("bun scripts/smoke.ts");
  });

  test.each(["main", "rollback"] as const)("checks out the actual %s release instead of a drifting branch", async (release) => {
    const result = await select({ release });
    expect(result.code).toBe(0);
    if (!result.release) throw new Error("Expected selected release");
    expect(result.head).toBe(result.release);
    expect(result.output).toBe(`sha=${result.release}\n`);
    if (release === "rollback") expect(result.head).not.toBe(result.main);
  });

  const refusals: [string, Scenario][] = [
    ["unavailable API", { unavailable: true }], ["not ready API", { ready: false }], ["malformed readiness", { malformed: true }],
    ["missing SHA", { release: "missing" }], ["short SHA", { release: "short" }], ["branch name", { release: "branch" }],
    ["uppercase SHA", { release: "uppercase" }], ["trailing newline", { release: "newline" }],
    ["unknown commit", { release: "unknown" }], ["commit outside main", { release: "unrelated" }],
  ];
  test.each(refusals)("refuses %s without selecting source", async (_, scenario) => {
    const result = await select(scenario);
    expect(result.code).not.toBe(0);
    expect(result.head).toBe(result.main);
    expect(result.output).toBe("");
  });
});
