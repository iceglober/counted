import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Step = { name?: string; run?: string; uses?: string; if?: string; with?: Record<string, unknown> };
const root = resolve(import.meta.dir, "../..");
const workflow = Bun.YAML.parse(await readFile(join(root, ".github/workflows/deploy.yml"), "utf8")) as {
  jobs: { deploy: { steps: Step[] } };
};
const services = ["counted-api", "counted-worker", "counted-mcp", "counted-web", "counted-docs"] as const;
const release = "a".repeat(40);
const deploymentIds = Object.fromEntries(services.map((name, i) => [name, `00000000-0000-7000-8000-${String(i + 1).padStart(12, "0")}`]));
type Scenario = {
  failedService?: string;
  missingService?: string;
  uploadFailure?: string;
  malformedUpload?: boolean;
};

// The workflow's real Deploy shell runs with only these local executables and
// jq on PATH. Nothing can invoke GitHub, Railway, a publisher or a real sleep.
const stub = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const dir = process.env.FIXTURE_DIR;
const { scenario, ids } = JSON.parse(readFileSync(dir + "/scenario.json", "utf8"));
const [command, ...args] = process.argv.slice(2);
const fail = message => { console.error(message); process.exit(1); };
const output = value => console.log(JSON.stringify(value));
if (command === "date") {
  const file = dir + "/clock";
  const now = existsSync(file) ? Number(readFileSync(file, "utf8")) + 1000 : 1000;
  writeFileSync(file, String(now));
  console.log(now);
} else if (command === "sleep") {
  // The clock advances deterministically, so a missing deployment times out.
} else if (command === "bun") {
  if (args.join(" ") !== "scripts/verify-railway-config.ts") fail("Unexpected Bun command");
} else if (command === "railway") {
  if (existsSync(dir + "/counted-production-release.json")) fail("Release record exists before deployment verification finished");
  const service = args[args.indexOf("--service") + 1];
  if (!ids[service]) fail("Unexpected service");
  if (args[0] === "variable" && args[1] === "set") {
    if (!args.includes("--skip-deploys") || !args.includes("RELEASE=" + process.env.RELEASE)) fail("Wrong release arguments");
    output({set:true});
  } else if (args[0] === "up") {
    if (scenario.uploadFailure === service) fail("Upload failed");
    output(scenario.malformedUpload ? {} : {deploymentId:ids[service]});
  } else if (args[0] === "deployment" && args[1] === "list") {
    appendFileSync(dir + "/verified.jsonl", JSON.stringify(service) + "\\n");
    output([
      ...(scenario.missingService === service ? [] : [{id:ids[service],status:scenario.failedService === service ? "FAILED" : "SUCCESS"}]),
      {id:"unrelated-" + service,status:"SUCCESS",createdAt:"2099-09-01T00:00:00.000Z"}
    ]);
  } else fail("Unexpected Railway command");
} else fail("Unexpected executable");
`;

async function deploy(scenario: Scenario = {}) {
  const shell = workflow.jobs.deploy.steps.find(step => step.name === "Deploy")?.run;
  if (!shell) throw new Error("Deploy shell missing");
  const dir = await mkdtemp(join(tmpdir(), "counted-deployment-attestation-"));
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  try {
    await writeFile(join(dir, "stub.js"), stub);
    await writeFile(join(dir, "scenario.json"), JSON.stringify({ scenario, ids: deploymentIds }));
    await writeFile(join(dir, "verified.jsonl"), "");
    for (const command of ["railway", "date", "sleep", "bun"]) {
      const path = join(dir, command);
      await writeFile(path, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(dir, "stub.js"))} ${quote(command)} "$@"\n`);
      await chmod(path, 0o700);
    }
    const jq = Bun.which("jq");
    if (!jq) throw new Error("jq required, as on the GitHub Ubuntu runner");
    await symlink(jq, join(dir, "jq"));
    const child = Bun.spawn(["/bin/bash", "-c", shell], {
      cwd: dir,
      env: { PATH: dir, FIXTURE_DIR: dir, RUNNER_TEMP: dir, RELEASE: release, GITHUB_SHA: "b".repeat(40) },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    const file = Bun.file(join(dir, "counted-production-release.json"));
    const record = await file.exists() ? await file.json() as unknown : null;
    const verified = (await readFile(join(dir, "verified.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as string);
    return { code, stdout, stderr, record, verified };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("successful deployment release record", () => {
  test("records the resolved release and all five exact verified upload IDs", async () => {
    const result = await deploy();
    expect(result.code).toBe(0);
    expect(result.verified).toEqual([...services]);
    expect(result.record).toEqual({ release, services: deploymentIds });
    // GITHUB_SHA deliberately differs: a manual rollback or workflow_run can
    // execute workflow source from a different commit than the deployed one.
    expect(JSON.stringify(result.record)).not.toContain("b".repeat(40));
    expect(JSON.stringify(result.record)).not.toContain("unrelated-");
  });

  test.each([...services])("failure of %s cannot produce a successful release record", async (failedService) => {
    const result = await deploy({ failedService });
    expect(result.code).not.toBe(0);
    expect(result.record).toBeNull();
    expect(result.stdout).toContain("ended FAILED");
    expect(result.verified).toEqual(failedService === "counted-api" ? ["counted-api"] : [...services]);
  });

  test("missing target cannot borrow unrelated deployment success", async () => {
    const result = await deploy({ missingService: "counted-docs" });
    expect(result.code).not.toBe(0);
    expect(result.record).toBeNull();
    expect(result.stdout).toContain("did not reach SUCCESS");
  });

  test("failed and malformed uploads produce no release record", async () => {
    for (const scenario of [{ uploadFailure: "counted-docs" }, { malformedUpload: true }]) {
      const result = await deploy(scenario);
      expect(result.code).not.toBe(0);
      expect(result.record).toBeNull();
    }
  });

  test("only successful Deploy can upload the required release artifact", () => {
    const steps = workflow.jobs.deploy.steps;
    const index = steps.findIndex(step => step.name === "Deploy");
    const upload = steps[index + 1];
    expect(upload?.uses).toBe("actions/upload-artifact@v4");
    expect(upload?.if).toBe("success()");
    expect(upload?.with).toEqual({
      name: "counted-production-release",
      path: "${{ runner.temp }}/counted-production-release.json",
      "if-no-files-found": "error",
      "retention-days": 90,
    });
  });
});
