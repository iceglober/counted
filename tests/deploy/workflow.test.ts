import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const workflow = Bun.YAML.parse(await readFile(join(root, ".github/workflows/deploy.yml"), "utf8")) as {
  permissions: Record<string, string>;
  jobs: { deploy: { steps: Array<{ name?: string; run?: string }> } };
};
const sha = "a".repeat(40);
const successfulRun = {
  head_sha: sha, head_branch: "main", event: "push", status: "completed", conclusion: "success",
};
const services = ["counted-api", "counted-worker", "counted-mcp", "counted-web", "counted-docs"];
type Scenario = {
  ancestor?: boolean;
  runs?: Array<Record<string, unknown>>;
  ghFailure?: boolean;
  projectId?: string;
  listFailure?: string;
  variableFailure?: string;
  uploadFailure?: string;
  uploadResponse?: unknown;
  statuses?: Record<string, Array<string | null>>;
  unrelatedStatus?: string;
};
type Call = { command: string; args: string[] };

// The actual YAML shell runs with a closed PATH: only these local stubs and jq
// exist. No real GitHub/Railway executable, credentials, network or deploy is used.
const stub = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const dir = process.env.FIXTURE_DIR;
const scenario = JSON.parse(readFileSync(dir + "/scenario.json", "utf8"));
const [command, ...args] = process.argv.slice(2);
appendFileSync(dir + "/calls.jsonl", JSON.stringify({command,args}) + "\\n");
const output = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const fail = (message) => { process.stderr.write(message + "\\n"); process.exit(1); };
const next = (key) => {
  const path = dir + "/counter-" + key;
  const value = existsSync(path) ? Number(readFileSync(path, "utf8")) + 1 : 0;
  writeFileSync(path, String(value));
  return value;
};
if (command === "git") {
  if (args.join(" ") === "rev-parse HEAD") process.stdout.write(process.env.RELEASE + "\\n");
  else if (args[0] === "merge-base") process.exit(scenario.ancestor === false ? 1 : 0);
  else fail("Unexpected git command");
} else if (command === "gh") {
  if (scenario.ghFailure) fail("GitHub unavailable");
  output([{workflow_runs: scenario.runs}]);
} else if (command === "date") {
  process.stdout.write(String((next("clock") + 1) * 1000) + "\\n");
} else if (command === "sleep") {
  // Advancing date above makes a timeout deterministic without sleeping.
} else if (command === "railway") {
  if (args.includes("--project")) fail("CLI 4.68 requires an environment with --project");
  if (args[0] === "status") {
    output({id: scenario.projectId ?? "production-project"});
  } else {
    const service = args[args.indexOf("--service") + 1];
    if (!service?.startsWith("counted-")) fail("Missing explicit service");
    if (args[0] === "variable" && args[1] === "set") {
      if (scenario.variableFailure === service) fail("Variable update failed");
      if (!args.includes("--skip-deploys") || !args.includes("RELEASE=" + process.env.RELEASE)) fail("Wrong release variable");
      output({keys:["RELEASE"],set:true});
    } else if (args[0] === "up") {
      if (scenario.uploadFailure === service) fail("Upload failed");
      if (!args.includes("--detach") || !args.includes("--json") || args[args.indexOf("--message") + 1] !== "deploy " + process.env.RELEASE) fail("Wrong upload arguments");
      output(Object.hasOwn(scenario, "uploadResponse") ? scenario.uploadResponse : {deploymentId: "requested-" + service, logsUrl:"https://example.test/logs"});
    } else if (args[0] === "deployment" && args[1] === "list") {
      if (scenario.listFailure === service) fail("Deployment list unavailable");
      const statuses = scenario.statuses?.[service] ?? ["SUCCESS"];
      const status = statuses[Math.min(next(service), statuses.length - 1)];
      output([
        ...(status === null ? [] : [{id:"requested-" + service,status,createdAt:"2026-09-01T00:00:00.000Z"}]),
        {id:"unrelated-" + service,status:scenario.unrelatedStatus ?? "SUCCESS",createdAt:"2099-09-01T00:00:00.000Z"}
      ]);
    } else fail("Unexpected railway command");
  }
} else fail("Unexpected command");
`;

async function runStep(name: string, scenario: Scenario = {}) {
  const shell = workflow.jobs.deploy.steps.find((step) => step.name === name)?.run;
  if (!shell) throw new Error(`Workflow step missing: ${name}`);
  const dir = await mkdtemp(join(tmpdir(), "counted-deploy-workflow-"));
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  try {
    await writeFile(join(dir, "stub.js"), stub);
    await writeFile(join(dir, "scenario.json"), JSON.stringify({ runs: [successfulRun], ...scenario }));
    await writeFile(join(dir, "calls.jsonl"), "");
    await writeFile(join(dir, "output"), "");
    for (const command of ["git", "gh", "railway", "date", "sleep"]) {
      const path = join(dir, command);
      await writeFile(path, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(dir, "stub.js"))} ${quote(command)} "$@"\n`);
      await chmod(path, 0o700);
    }
    const jq = Bun.which("jq");
    if (!jq) throw new Error("jq is required, as on the GitHub Ubuntu runner");
    await symlink(jq, join(dir, "jq"));
    const child = Bun.spawn(["/bin/bash", "-c", shell], {
      cwd: dir,
      env: {
        PATH: dir,
        FIXTURE_DIR: dir,
        GITHUB_OUTPUT: join(dir, "output"),
        GITHUB_REPOSITORY: "example/counted",
        GH_TOKEN: "fixture-only",
        RAILWAY_TOKEN: "fixture-only",
        RAILWAY_PROJECT_ID: "production-project",
        RELEASE: sha,
      },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    const calls = (await readFile(join(dir, "calls.jsonl"), "utf8"))
      .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Call);
    return { code, stdout, stderr, calls, output: await readFile(join(dir, "output"), "utf8") };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("release eligibility shell from deploy.yml", () => {
  test("queries the exact CI workflow and exports only a successful main push SHA", async () => {
    expect(workflow.permissions.actions).toBe("read");
    const result = await runStep("Resolve the release");
    expect(result.code).toBe(0);
    expect(result.output).toBe(`sha=${sha}\n`);
    expect(result.calls.find((call) => call.command === "gh")?.args).toEqual([
      "api", "--method", "GET", "--paginate", "--slurp", "repos/example/counted/actions/workflows/ci.yml/runs",
      "-f", `head_sha=${sha}`, "-f", "event=push", "-f", "branch=main", "-f", "status=success", "-f", "per_page=100",
    ]);
  });

  for (const [label, overrides] of [
    ["a different commit", { head_sha: "b".repeat(40) }],
    ["a pull request", { event: "pull_request" }],
    ["another branch", { head_branch: "feature" }],
    ["failed CI", { conclusion: "failure" }],
    ["incomplete CI", { status: "in_progress" }],
  ] as const) {
    test(`refuses ${label} even if the commit is on main`, async () => {
      const result = await runStep("Resolve the release", { runs: [{ ...successfulRun, ...overrides }] });
      expect(result.code).not.toBe(0);
      expect(result.output).toBe("");
      expect(result.stdout).toContain("No successful CI");
    });
  }

  test("missing or unavailable CI evidence cannot authorize a rollback", async () => {
    for (const scenario of [{ runs: [] }, { ghFailure: true }]) {
      const result = await runStep("Resolve the release", scenario);
      expect(result.code).not.toBe(0);
      expect(result.output).toBe("");
    }
  });

  test("refuses commits outside main before querying CI", async () => {
    const result = await runStep("Resolve the release", { ancestor: false });
    expect(result.code).not.toBe(0);
    expect(result.calls.some((call) => call.command === "gh")).toBe(false);
  });
});

describe("Railway deployment shell from deploy.yml", () => {
  test("checks the token project and access to all five services before upload", async () => {
    const result = await runStep("Check access to every required service");
    expect(result.code).toBe(0);
    expect(result.calls[0]?.args).toEqual(["status", "--json"]);
    expect(result.calls.slice(1).map((call) => call.args[3])).toEqual(services);
  });

  test("a different token project or inaccessible service stops preflight", async () => {
    for (const scenario of [{ projectId: "other-project" }, { listFailure: "counted-docs" }]) {
      expect((await runStep("Check access to every required service", scenario)).code).not.toBe(0);
    }
  });

  test("waits for the upload's ID, even when a newer unrelated deployment already succeeded", async () => {
    const result = await runStep("Deploy", { statuses: { "counted-api": ["BUILDING", "SUCCESS"] } });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("counted-api (requested-counted-api): BUILDING");
    for (const service of services) expect(result.stdout).toContain(`${service} (requested-${service}): SUCCESS`);
    const uploads = result.calls.filter((call) => call.command === "railway" && call.args[0] === "up");
    expect(uploads.map((call) => call.args[2])).toEqual(services);
    const apiPolls = result.calls.filter((call) => call.command === "railway" && call.args[0] === "deployment" && call.args[3] === "counted-api");
    expect(apiPolls).toHaveLength(2);
    expect(result.calls.indexOf(apiPolls[1]!)).toBeLessThan(result.calls.indexOf(uploads[1]!));
  });

  test("an unrelated failed deployment cannot fail the requested successful deployment", async () => {
    expect((await runStep("Deploy", { unrelatedStatus: "FAILED" })).code).toBe(0);
  });

  for (const status of ["FAILED", "CRASHED", "REMOVED", "SKIPPED", "CANCELED", "NEEDS_APPROVAL"]) {
    test(`${status} on the requested API stops downstream uploads despite unrelated success`, async () => {
      const result = await runStep("Deploy", { statuses: { "counted-api": [status] } });
      expect(result.code).not.toBe(0);
      expect(result.stdout).toContain(`requested-counted-api) ended ${status}`);
      expect(result.calls.filter((call) => call.args[0] === "up")).toHaveLength(1);
    });
  }

  test("failure in any downstream service fails the run while checking every dispatched ID", async () => {
    const result = await runStep("Deploy", { statuses: { "counted-worker": ["FAILED"] } });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("requested-counted-worker) ended FAILED");
    expect(result.stdout).toContain("counted-docs (requested-counted-docs): SUCCESS");
  });

  test("missing target and unavailable status time out rather than accepting unrelated success", async () => {
    for (const scenario of [{ statuses: { "counted-api": [null] } }, { listFailure: "counted-api" }]) {
      const result = await runStep("Deploy", scenario);
      expect(result.code).not.toBe(0);
      expect(result.stdout).toContain("requested-counted-api) did not reach SUCCESS");
    }
  });

  test("variable or upload failure stops instead of losing the command-substitution exit code", async () => {
    for (const scenario of [{ variableFailure: "counted-api" }, { uploadFailure: "counted-api" }]) {
      const result = await runStep("Deploy", scenario);
      expect(result.code).not.toBe(0);
      expect(result.calls.some((call) => call.args[0] === "deployment")).toBe(false);
      if ("variableFailure" in scenario) expect(result.calls.some((call) => call.args[0] === "up")).toBe(false);
    }
  });

  test("a missing or malformed upload ID fails before polling", async () => {
    for (const uploadResponse of [{}, { deploymentId: "" }, { deploymentId: null }, { deploymentId: 123 }]) {
      const result = await runStep("Deploy", { uploadResponse });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("upload did not return a deployment ID");
      expect(result.calls.some((call) => call.args[0] === "deployment")).toBe(false);
    }
  });
});
