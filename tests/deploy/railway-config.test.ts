import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nativeServiceSettings, nativeSettingsProblems, verifyRailwayConfig } from "../../scripts/verify-railway-config";

const root = resolve(import.meta.dir, "../..");
const project = "fixture-project";
const environment = "fixture-environment";
const credential = "fixture-token-not-for-logs";
const env = { RAILWAY_TOKEN: credential, RAILWAY_PROJECT_ID: project, RAILWAY_ENVIRONMENT_ID: environment };
const names = Object.keys(nativeServiceSettings);
type Service = Record<string, unknown> & { build: Record<string, unknown>; deploy: Record<string, unknown> };
function metadata() {
  return { data: { projectToken: {
    project: { id: project, services: { edges: Object.entries(nativeServiceSettings).map(([name, settings]) => ({ node: {
      name, id: name + "-id", serviceInstances: { edges: [{ node: {
        serviceId: name + "-id", environmentId: environment, ...structuredClone(settings.build), ...structuredClone(settings.deploy),
      } }] },
    } })) } },
    environment: { id: environment, name: "production", config: {
      services: Object.fromEntries(Object.entries(nativeServiceSettings).map(([name, settings]) => [name + "-id", {
        build: structuredClone(settings.build), deploy: structuredClone(settings.deploy),
        variables: { SECRET: { value: "confidential-provider-value" } },
      }])) as Record<string, Service>,
    } },
  } } };
}
type Metadata = ReturnType<typeof metadata>;
const service = (data: Metadata, name = "counted-docs") => data.data.projectToken.environment.config.services[name + "-id"]!;
const effective = (data: Metadata, name = "counted-docs"): Record<string, unknown> =>
  data.data.projectToken.project.services.edges.find((edge) => edge.node.name === name)!.node.serviceInstances.edges[0]!.node;

describe("native Railway configuration release gate", () => {
  test("uses the exact checked-out docs/MCP manifests", async () => {
    expect(nativeSettingsProblems(metadata(), project, environment)).toEqual([]);
    expect(names).toEqual(["counted-docs", "counted-mcp"]);
    for (const [name, expected] of Object.entries(nativeServiceSettings)) {
      expect(expected).toEqual(JSON.parse(await readFile(join(root, "deploy", name.replace("counted-", "") + ".railway.json"), "utf8")));
    }
  });

  for (const name of names) {
    for (const group of ["build", "deploy"] as const) {
      const fields = group === "build" ? ["builder", "dockerfilePath"] : Object.keys(nativeServiceSettings["counted-docs"].deploy);
      for (const field of fields) {
        test(`${name} requires matching ${group}.${field}`, () => {
          for (const value of [undefined, "confidential-unexpected-value"]) {
            const data = metadata();
            service(data, name)[group][field] = value;
            effective(data, name)[field] = value;
            const problems = nativeSettingsProblems(data, project, environment);
            expect(problems).toContain(`${name}: ${group}.${field} differs from this release.`);
            expect(problems.join(" ")).not.toContain("confidential");
          }
        });
      }
    }
  }

  const overrides: Array<[string, (value: Service) => void]> = [
    ["configFile", (v) => { v.configFile = "deploy/docs.railway.json"; }],
    ["rootDirectory", (v) => { v.source = { rootDirectory: "apps/docs" }; }],
    ["source.image", (v) => { v.source = { image: "private-registry:secret" }; }],
    ["buildCommand", (v) => { v.build.buildCommand = "unexpected"; }],
    ["watchPatterns", (v) => { v.build.watchPatterns = ["apps/docs/**"]; }],
    ["startCommand", (v) => { v.deploy.startCommand = "unexpected"; }],
    ["preDeployCommand", (v) => { v.deploy.preDeployCommand = ["unexpected"]; }],
    ["cronSchedule", (v) => { v.deploy.cronSchedule = "0 * * * *"; }],
    ["sleepApplication", (v) => { v.deploy.sleepApplication = true; }],
    ["multiRegionConfig", (v) => { v.deploy.multiRegionConfig = { first: { numReplicas: 1 }, second: { numReplicas: 1 } }; }],
  ];
  test.each(overrides)("refuses overriding %s", (field, change) => {
    const data = metadata(); change(service(data));
    expect(nativeSettingsProblems(data, project, environment).join(" ")).toContain(field);
  });

  test("allows explicit defaults and matching regional replicas", () => {
    const data = metadata();
    Object.assign(service(data), { configFile: null, source: { rootDirectory: "/" } });
    Object.assign(service(data).build, { watchPatterns: [], buildCommand: null });
    Object.assign(service(data).deploy, { startCommand: null, sleepApplication: false, multiRegionConfig: { region: { numReplicas: 1 } } });
    expect(nativeSettingsProblems(data, project, environment)).toEqual([]);
  });

  test("normalized defaults require authoritative effective values, not raw-field presence or guessed defaults", () => {
    const data = metadata();
    for (const name of names) {
      delete service(data, name).deploy.numReplicas;
      delete service(data, name).deploy.restartPolicyType;
    }
    expect(nativeSettingsProblems(data, project, environment)).toEqual([]);
    delete effective(data).numReplicas;
    expect(nativeSettingsProblems(data, project, environment)).toEqual(["counted-docs: deploy.numReplicas differs from this release."]);
    effective(data).numReplicas = 2;
    expect(nativeSettingsProblems(data, project, environment)).toEqual(["counted-docs: deploy.numReplicas differs from this release."]);
  });

  test("an explicit regional count proves one replica when Railway's legacy count is null", () => {
    const data = metadata();
    for (const name of names) {
      delete service(data, name).deploy.numReplicas;
      delete service(data, name).deploy.restartPolicyType;
      service(data, name).deploy.multiRegionConfig = { "fixture-region": { numReplicas: 1 }, "removed-region": null };
      effective(data, name).numReplicas = null;
    }
    expect(nativeSettingsProblems(data, project, environment)).toEqual([]);
    effective(data).numReplicas = 2;
    expect(nativeSettingsProblems(data, project, environment)).toContain("counted-docs: deploy.numReplicas conflicts with its regional configuration.");
    effective(data).numReplicas = null;
    service(data).deploy.numReplicas = 2;
    expect(nativeSettingsProblems(data, project, environment)).toContain("counted-docs: deploy.numReplicas differs from this release.");
  });

  test("null legacy counts never turn absent, empty, zero or malformed regional settings into a default", () => {
    for (const map of [undefined, null, {}, [], { "": { numReplicas: 1 } }, { region: null },
      { region: {} }, { region: { numReplicas: 0 } }, { region: { numReplicas: -1 } },
      { region: { numReplicas: 0.5 } }, { region: { numReplicas: "1" } }, { region: "unknown" }]) {
      const data = metadata();
      delete service(data).deploy.numReplicas;
      effective(data).numReplicas = null;
      if (map !== undefined) service(data).deploy.multiRegionConfig = map;
      expect(nativeSettingsProblems(data, project, environment).length).toBeGreaterThan(0);
    }
  });

  test("requires exactly one effective instance bound to the target service and environment", () => {
    for (const field of ["serviceId", "environmentId"]) {
      const data = metadata(); effective(data)[field] = "different-id";
      expect(nativeSettingsProblems(data, project, environment)).toEqual(["counted-docs: effective service settings are missing or ambiguous."]);
    }
    const data = metadata();
    const edges = data.data.projectToken.project.services.edges[0]!.node.serviceInstances.edges;
    edges.push(edges[0]!);
    expect(nativeSettingsProblems(data, project, environment)).toEqual(["counted-docs: effective service settings are missing or ambiguous."]);
  });

  test("missing, deleted or duplicate targets fail; grandfathered services remain untouched", () => {
    for (const change of [
      (data: Metadata) => { delete data.data.projectToken.environment.config.services["counted-docs-id"]; },
      (data: Metadata) => { service(data).isDeleted = true; },
      (data: Metadata) => { data.data.projectToken.project.services.edges.push(data.data.projectToken.project.services.edges[0]!); },
    ]) {
      const data = metadata(); change(data);
      expect(nativeSettingsProblems(data, project, environment)).toEqual(["counted-docs: applied service configuration is missing or ambiguous."]);
    }
    const data = metadata();
    data.data.projectToken.environment.config.services["legacy-api"] = { configFile: "deploy/api.railway.json", build: {}, deploy: {} };
    expect(nativeSettingsProblems(data, project, environment)).toEqual([]);
  });

  test("rejects another project/environment, missing metadata and GraphQL errors", () => {
    expect(nativeSettingsProblems(metadata(), "another-project", environment)).toEqual(["Railway token does not target the configured project."]);
    const other = metadata(); other.data.projectToken.environment.name = "preview";
    expect(nativeSettingsProblems(other, project, environment)).toEqual(["Railway token does not target the production environment."]);
    const sameName = metadata(); sameName.data.projectToken.environment.id = "another-production-id";
    expect(nativeSettingsProblems(sameName, project, environment)).toEqual(["Railway token does not target the production environment."]);
    for (const data of [null, {}, { data: null }, { ...metadata(), errors: [{ message: credential }] }]) {
      const problems = nativeSettingsProblems(data, project, environment);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join(" ")).not.toContain(credential);
    }
  });

  test("uses read-only metadata, disabled decryption and scoped project-token authentication", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    expect(await verifyRailwayConfig(env, async (url, init) => {
      calls.push({ url, init }); return Response.json(metadata());
    })).toEqual([]);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://backboard.railway.com/graphql/v2");
    expect(call.init.method).toBe("POST");
    expect(new Headers(call.init.headers).get("project-access-token")).toBe(credential);
    expect(call.init.redirect).toBe("error");
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(call.init.body)) as { query: string };
    expect(body.query).toContain("config(decryptVariables: false)");
    expect(body.query).toContain("projectToken");
    expect(body.query).not.toContain("mutation");
    expect(body.query).not.toContain(credential);
  });

  test("missing credentials fail without a request", async () => {
    for (const incomplete of [{}, { RAILWAY_TOKEN: credential }, { RAILWAY_PROJECT_ID: project }, { RAILWAY_TOKEN: credential, RAILWAY_PROJECT_ID: project }]) {
      let called = false;
      expect(await verifyRailwayConfig(incomplete, async () => { called = true; return Response.json(metadata()); }))
        .toEqual(["A production project token, project ID and environment ID are required."]);
      expect(called).toBe(false);
    }
  });

  test("HTTP, transport, malformed and oversized failures expose no provider payload", async () => {
    for (const fetcher of [
      async () => new Response(credential, { status: 503 }),
      async () => { throw new Error(credential); },
      async () => new Response(credential),
      async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
    ]) {
      const problems = await verifyRailwayConfig(env, fetcher);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join(" ")).not.toContain(credential);
    }
  });
});

test("actual preflight command fails before release mutations or uploads", async () => {
  const workflow = Bun.YAML.parse(await readFile(join(root, ".github/workflows/deploy.yml"), "utf8")) as {
    jobs: { deploy: { steps: Array<{ name?: string; run?: string }> } };
  };
  const steps = workflow.jobs.deploy.steps;
  const index = steps.findIndex((step) => step.name === "Verify native Railway settings");
  expect(index).toBeGreaterThan(-1);
  expect(index).toBeLessThan(steps.findIndex((step) => step.name === "Deploy"));
  for (const step of steps.slice(0, index + 1)) expect(step.run ?? "").not.toMatch(/railway (?:variable set|up|environment edit)/);

  const dir = await mkdtemp(join(tmpdir(), "counted-native-config-"));
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  try {
    const preload = join(dir, "fetch.ts");
    await writeFile(preload, `globalThis.fetch = async () => Response.json(JSON.parse(await Bun.file(process.env.FIXTURE_RESPONSE!).text()));`);
    await writeFile(join(dir, "bun"), `#!/bin/sh\nexec ${quote(process.execPath)} --preload ${quote(preload)} "$@"\n`);
    await chmod(join(dir, "bun"), 0o700);
    for (const healthy of [false, true]) {
      const data = metadata();
      if (!healthy) delete effective(data, "counted-mcp").healthcheckPath;
      await writeFile(join(dir, "response.json"), JSON.stringify(data));
      const child = Bun.spawn(["/bin/bash", "-e", "-c", `${steps[index]!.run}\nprintf 'UPLOAD_REACHED\\n'`], {
        cwd: root, env: { PATH: dir, ...env, FIXTURE_RESPONSE: join(dir, "response.json") },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      expect(code === 0).toBe(healthy);
      expect(stdout.includes("UPLOAD_REACHED")).toBe(healthy);
      if (!healthy) expect(stderr).toContain("counted-mcp: deploy.healthcheckPath differs from this release.");
      expect(stdout + stderr).not.toContain(credential);
      expect(stdout + stderr).not.toContain("confidential-provider-value");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
