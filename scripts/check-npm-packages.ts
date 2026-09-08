/** Verify the artifacts npm consumers install, outside the workspace. Builds must run first. */
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const scratch = await mkdtemp(join(tmpdir(), "counted-npm-check-"));
const names = ["sdk-js", "react", "agent-telemetry", "agent-claude-code", "agent-opencode"];
async function run(cmd: string[], cwd: string) {
  const child = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${cmd[0]} ${cmd[1]} failed: ${stderr || stdout}`);
  return stdout;
}
try {
  for (const name of names) {
    const directory = join(root, "packages", name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    if (manifest.private) throw new Error(`${manifest.name} is private`);
    // Changesets publishes this Bun workspace with npm. Exercise npm's actual
    // tarballs: Bun's pack command rewrites workspace: dependencies and could
    // hide an artifact that npm itself publishes unchanged.
    await run(["npm", "pack", "--ignore-scripts", "--workspaces=false", "--pack-destination", scratch, "--json"], directory);
  }
  const packages = (await readdir(scratch)).filter(name => name.endsWith(".tgz")).map(name => join(scratch, name));
  await writeFile(join(scratch, "package.json"), JSON.stringify({ name: "counted-clean-consumer", private: true, type: "module" }));
  await run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", ...packages, "react@19", "react-dom@19"], scratch);
  await writeFile(join(scratch, "check.mjs"), `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { Counted } from "@counted/sdk";
import { AnalyticsProvider, useAnalytics } from "@counted/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
const require = createRequire(import.meta.url);
assert.equal(typeof require("@counted/sdk").Counted, "function");
assert.equal(typeof require("@counted/react").AnalyticsProvider, "function");
let request;
const counted = new Counted({ key: "fixture_ingest_key", fetch: async (url, init) => {
  request = { url, body: JSON.parse(init.body) };
  return Response.json({ accepted: 1, deduplicated: 0, rejected: 0 }, { status: 202 });
}});
counted.track("page_view", { path: "/welcome" });
await counted.shutdown();
assert.equal(request.url, "https://api.counted.dev/v1/events");
assert.equal(request.body.events[0].name, "page_view");
assert.equal(request.body.events[0].systemProperties.sdk_version, "counted-js/2.0.0");
assert.equal(request.body.events[0].userId, undefined);
assert.ok(request.body.events[0].visitId);
function Consumer() { assert.equal(typeof useAnalytics().track, "function"); return createElement("span", null, "ready"); }
assert.match(renderToString(createElement(AnalyticsProvider, { projectKey: "fixture_ingest_key" }, createElement(Consumer))), /ready/);
const telemetry = await import("@counted/agent-telemetry");
assert.equal(typeof telemetry.createAgentTracker, "function");
assert.equal(typeof telemetry.handle, "function");
assert.equal(typeof telemetry.openCodeProjection, "function");
assert.equal(typeof require("@counted/agent-telemetry").createAgentTracker, "function");
assert.equal(typeof (await import("@counted/claude-code")).handle, "function");
assert.equal(typeof (await import("@counted/opencode")).CountedPlugin, "function");
for (const retired of ["agent", "agent-core", "migrate"]) {
  assert.equal(existsSync(new URL("./node_modules/@counted/" + retired, import.meta.url)), false);
}
console.log("Clean npm install: SDK ESM/CJS, default endpoint, wire event, React SSR and agent dependency graph passed.");
`);
  console.log((await run(["node", "check.mjs"], scratch)).trim());
} finally {
  await rm(scratch, { recursive: true, force: true });
}
