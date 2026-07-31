/**
 * Two structural gates over the agent packages.
 *
 * Neither checks behaviour. Both check the class of bug that behaviour tests
 * cannot see: code that got copied, and files that got published — or didn't.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");

const packageDirs = (): readonly string[] =>
  readdirSync(join(ROOT, "packages"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, "packages", e.name, "package.json")))
    .map((e) => `packages/${e.name}`);

const sourceFiles = (dir: string): readonly string[] => {
  const found: string[] = [];
  const walk = (current: string): void => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|mjs)$/.test(entry.name)) found.push(path);
    }
  };
  walk(join(ROOT, dir));
  return found;
};

describe("the redaction rules exist once", () => {
  /**
   * They were pasted into four packages, so a fix to one left the others
   * leaking. Now `agent-core/src/redaction.ts` is the only declaration and
   * every adapter imports it — which is only true for as long as something
   * checks.
   */
  const REDACTORS = ["relPath", "cmdName", "langOf", "scrubSecrets"];

  test("no package outside agent-core declares one", () => {
    const declarations: { file: string; name: string }[] = [];
    for (const dir of packageDirs()) {
      if (dir === "packages/agent-core") continue;
      for (const file of sourceFiles(dir)) {
        const source = readFileSync(file, "utf8");
        for (const name of REDACTORS) {
          // A declaration, not a call or an import.
          if (new RegExp(`(?:function|const|let)\\s+${name}\\b`).test(source)) {
            declarations.push({ file: file.slice(ROOT.length + 1), name });
          }
        }
      }
    }
    expect(declarations).toEqual([]);
  });

  test("agent-core does declare them, so the check is not vacuous", () => {
    const source = readFileSync(join(ROOT, "packages/agent-core/src/redaction.ts"), "utf8");
    for (const name of REDACTORS) expect(source).toContain(`const ${name}`);
  });
});

describe("every published package contains what it promises", () => {
  /**
   * `@counted/claude-code` declared `files: ["dist"]`, so the published
   * tarball had no `bin/`, no `hooks/` and no `.claude-plugin/` — a Claude
   * Code plugin package with no plugin in it. Nothing failed: the build was
   * green, the package installed, and it silently did nothing.
   *
   * This is caught by comparing the two lists that describe one set — what a
   * manifest points at, and what npm would actually ship — or it is not caught
   * at all.
   */
  const publishable = (): readonly { dir: string; manifest: Record<string, unknown> }[] =>
    packageDirs()
      .map((dir) => ({
        dir,
        manifest: JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as Record<string, unknown>,
      }))
      .filter((p) => p.manifest["private"] !== true && Array.isArray(p.manifest["files"]));

  /** Every path a manifest claims a consumer can reach. */
  const referencedPaths = (manifest: Record<string, unknown>): readonly string[] => {
    const paths: string[] = [];
    const push = (value: unknown): void => {
      if (typeof value === "string" && value.startsWith("./")) paths.push(value.slice(2));
      else if (typeof value === "string" && /^[\w.]/.test(value) && value.includes("/")) paths.push(value);
      else if (Array.isArray(value)) value.forEach(push);
      else if (typeof value === "object" && value !== null) Object.values(value).forEach(push);
    };
    push(manifest["exports"]);
    push(manifest["bin"]);
    for (const field of ["main", "module", "types"]) push(manifest[field]);
    return [...new Set(paths)];
  };

  /** Which top-level directories `files` would actually ship. */
  const shipped = (manifest: Record<string, unknown>): readonly string[] =>
    (manifest["files"] as string[]).map((f) => f.replace(/^\.?\//, "").split("/")[0] ?? f);

  test("every path a manifest points at is inside its files list", () => {
    const missing: { package: string; path: string }[] = [];
    for (const { dir, manifest } of publishable()) {
      const included = new Set(shipped(manifest));
      for (const path of referencedPaths(manifest)) {
        const top = path.split("/")[0];
        // package.json and the readme ship regardless of `files`.
        if (top === undefined || top === "package.json" || /^readme/i.test(top)) continue;
        if (!included.has(top)) missing.push({ package: String(manifest["name"]), path });
      }
    }
    expect(missing).toEqual([]);
  });

  test("a Claude Code plugin ships its plugin", () => {
    // The specific instance, named — the general rule above would still pass
    // if somebody removed the manifest from `exports` instead of fixing
    // `files`.
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "packages/agent-claude-code/package.json"), "utf8"),
    ) as { files: string[] };
    for (const required of ["bin", "hooks", ".claude-plugin"]) {
      expect({ required, files: manifest.files }).toMatchObject({
        files: expect.arrayContaining([required]),
      });
    }
  });

  test("the plugin manifest's own hook path exists on disk", () => {
    const plugin = JSON.parse(
      readFileSync(join(ROOT, "packages/agent-claude-code/.claude-plugin/plugin.json"), "utf8"),
    ) as { hooks: string };
    const hooks = join(ROOT, "packages/agent-claude-code", plugin.hooks);
    expect({ hooks: plugin.hooks, exists: existsSync(hooks) }).toMatchObject({ exists: true });

    // And every command it registers points at a file this package ships.
    const registered = readFileSync(hooks, "utf8");
    const commands = [...registered.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)]
      .map((m) => m[1])
      .filter((c): c is string => c !== undefined);
    expect(commands.length).toBeGreaterThan(0);

    const files = (JSON.parse(
      readFileSync(join(ROOT, "packages/agent-claude-code/package.json"), "utf8"),
    ) as { files: string[] }).files;
    for (const command of new Set(commands)) {
      const top = command.split("/")[0] ?? command;
      expect({ command, listed: files.includes(top) }).toMatchObject({ listed: true });
    }
  });

  test("the plugin marketplace points at a directory that exists", () => {
    // It pointed at `./packages/claude-code` after the directory was renamed.
    // Nothing in the build reads this file, so nothing would have failed —
    // the marketplace would simply have stopped installing.
    const marketplace = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8")) as {
      plugins: { name: string; source: string }[];
    };
    expect(marketplace.plugins.length).toBeGreaterThan(0);
    for (const plugin of marketplace.plugins) {
      const manifest = join(ROOT, plugin.source, ".claude-plugin/plugin.json");
      expect({ plugin: plugin.name, source: plugin.source, hasManifest: existsSync(manifest) }).toMatchObject({
        hasManifest: true,
      });
    }
  });

  test("the check is not vacuous", () => {
    expect(publishable().length).toBeGreaterThan(2);
  });
});

describe("the two byte-identical packages are gone", () => {
  test("codex-cli and gemini-cli no longer ship an integration", () => {
    // They were `md5 48ab6ab2…` identical: a copy of the SDK wrapper and no
    // hook, so installing either produced no events. Kept as deprecation
    // stubs, because unpublishing breaks existing installs and explains
    // nothing.
    for (const name of ["codex-cli", "gemini-cli"]) {
      const manifest = JSON.parse(readFileSync(join(ROOT, `packages/${name}/package.json`), "utf8")) as Record<
        string,
        unknown
      >;
      expect({ name, deprecated: typeof manifest["deprecated"] }).toMatchObject({ deprecated: "string" });
      const source = readFileSync(join(ROOT, `packages/${name}/src/index.ts`), "utf8");
      expect(source).toContain("@counted/agent");
      // No SDK, so it cannot pretend to send anything.
      expect(source).not.toContain("@counted/sdk");
    }
  });

  test("the real host packages are the ones with an integration point", () => {
    // The rule the design applies: a package exists where a host has
    // something installable. Everything else is documentation.
    for (const dir of ["packages/agent-claude-code", "packages/agent-opencode"]) {
      const manifest = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as Record<string, unknown>;
      expect({ dir, deprecated: manifest["deprecated"] }).toMatchObject({ deprecated: undefined });
    }
  });
});

describe("the hook binaries actually run", () => {
  /**
   * The manifest tests above check what ships. They cannot check whether it
   * works — and it did not: `src/hook.ts` began with a shebang and tsup adds
   * one via `banner`, so the bundle carried two. The second landed on line 2,
   * where it is not a shebang but a syntax error. Every build was green, the
   * file was in the tarball, and running it failed instantly.
   *
   * A hook is a process. The only honest test of one is to start it.
   */
  const BINARIES = [
    "packages/agent-cli/bin/counted-agent.mjs",
    "packages/agent-claude-code/bin/counted-hook.mjs",
  ];

  const built = (path: string): boolean => existsSync(join(ROOT, path));

  /** Spawn without blocking this event loop. */
  const run = (binary: string, options: { input: string; env: NodeJS.ProcessEnv }): Promise<{ status: number | null; stderr: string }> =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [binary], { env: options.env });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += String(chunk)));
      child.stdin.end(options.input);
      child.on("close", (status) => resolve({ status, stderr }));
    });

  test("they are built before this suite runs", () => {
    // Deliberately a failure rather than a skip: a skipped test reads as a
    // passing suite, which is how the shebang survived in the first place.
    for (const binary of BINARIES) {
      expect({ binary, built: built(binary), hint: "run `bun run agents:build`" }).toMatchObject({ built: true });
    }
  });

  test("each parses and exits 0 on an empty stdin", () => {
    for (const binary of BINARIES) {
      const result = spawnSync(process.execPath, [join(ROOT, binary)], {
        input: "",
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, COUNTED_AGENT_KEY: "" },
      });
      expect({ binary, status: result.status, stderr: result.stderr }).toMatchObject({ status: 0, stderr: "" });
    }
  });

  test("each exits 0 on garbage, because a hook must never break a session", () => {
    for (const binary of BINARIES) {
      const result = spawnSync(process.execPath, [join(ROOT, binary)], {
        input: "not json at all {{{",
        encoding: "utf8",
        timeout: 15_000,
      });
      expect({ binary, status: result.status }).toMatchObject({ status: 0 });
    }
  });

  test("the Claude Code hook sends a real event to a real socket", async () => {
    // The full path, as a process: stdin in, HTTP out. Nothing is stubbed —
    // this is the arrangement Claude Code itself uses.
    const received: { name: string; properties: Record<string, unknown> }[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        received.push(...(JSON.parse(body) as { events: typeof received }).events);
        response.writeHead(202, { "content-type": "application/json" });
        response.end(JSON.stringify({ accepted: received.length, deduplicated: 0, rejected: 0 }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    try {
      // `spawn`, not `spawnSync`: the capture server runs on this event loop,
      // so blocking it would leave the hook's connection unanswered until its
      // own self-kill fired — a deadlock that looks exactly like a hook that
      // sends nothing.
      const result = await run(join(ROOT, "packages/agent-claude-code/bin/counted-hook.mjs"), {
        input: JSON.stringify({
          hook_event_name: "PostToolUseFailure",
          session_id: `pack-${process.pid}`,
          cwd: ROOT,
          tool_name: "Bash",
          // A credential in the command, which must not survive the trip.
          tool_input: { command: "/usr/bin/git push --token=sk_live_abcdefghijklmno" },
        }),
        env: {
          ...process.env,
          COUNTED_AGENT_KEY: "ck_live_test",
          COUNTED_AGENT_ENDPOINT: `http://127.0.0.1:${port}/v1/events`,
        },
      });

      expect({ status: result.status, stderr: result.stderr }).toMatchObject({ status: 0 });
      expect(received.map((e) => e.name)).toEqual(["agent_tool_use", "agent_command_run"]);
      // The command is a binary name, and the token is nowhere in the payload.
      expect(received[1]?.properties).toMatchObject({ command: "git", exitCode: 1 });
      expect(JSON.stringify(received)).not.toContain("sk_live");
      // And the setup fingerprint rode along, from a cold process.
      expect(received[0]?.properties).toMatchObject({ setupSpec: "counted.setup/1" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
