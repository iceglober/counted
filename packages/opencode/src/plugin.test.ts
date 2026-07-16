import { test, expect, beforeEach, afterEach } from "bun:test";

// Integration test: drive CountedPlugin with OpenCode's EXACT hook call shapes
// so signature drift (single-param tool hooks, missing session ids) is caught.
// We stub global.fetch to capture the batches the SDK would POST.

const KEY = "ck_test_opencode_plugin";
const originalFetch = globalThis.fetch;
let captured: any[] = [];

beforeEach(() => {
  captured = [];
  process.env.COUNTED_AGENT_KEY = KEY;
  process.env.COUNTED_AGENT_HOST = "https://capture.local";
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    for (const e of body) captured.push(e);
    return new Response("{}", { status: 200 });
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.COUNTED_AGENT_KEY;
  delete process.env.COUNTED_AGENT_HOST;
});

async function loadPlugin() {
  // Fresh module each run so the internal singletons reset.
  const mod = await import("./plugin?t=" + Math.random());
  return mod.CountedPlugin as (input: any) => Promise<Record<string, any>>;
}

test("tool.execute.(before|after) with (input, output) shape fires file_edit and command_run", async () => {
  const CountedPlugin = await loadPlugin();
  const hooks = await CountedPlugin({ directory: "/repo" });

  await hooks.config?.({ model: "anthropic/claude" });
  await hooks.event?.({ event: { type: "session.created", properties: { info: { id: "sess-1" } } } });

  // Edit tool: OpenCode passes args on the SECOND parameter (output.args).
  await hooks["tool.execute.before"](
    { tool: "edit", sessionID: "sess-1", callID: "call-1" },
    { args: { filePath: "/repo/src/a.ts" } },
  );
  await hooks["tool.execute.after"](
    { tool: "edit", sessionID: "sess-1", callID: "call-1" },
    { args: { filePath: "/repo/src/a.ts" } },
  );

  // Bash tool.
  await hooks["tool.execute.before"](
    { tool: "bash", sessionID: "sess-1", callID: "call-2" },
    { args: { command: "/usr/bin/git status" } },
  );
  await hooks["tool.execute.after"](
    { tool: "bash", sessionID: "sess-1", callID: "call-2" },
    { args: { command: "/usr/bin/git status" } },
  );

  await hooks.event?.({ event: { type: "session.deleted", properties: { info: { id: "sess-1" } } } });
  await hooks.dispose?.();

  const names = captured.map((e) => e.eventName);
  expect(names).toContain("session_start");
  expect(names).toContain("tool_use");
  expect(names).toContain("file_edit");
  expect(names).toContain("command_run");
  expect(names).toContain("session_end");

  const fileEdit = captured.find((e) => e.eventName === "file_edit");
  expect(fileEdit.props.filePath).toBe("src/a.ts"); // repo-relative
  const cmd = captured.find((e) => e.eventName === "command_run");
  expect(cmd.props.command).toBe("git"); // binary name only

  // All events keyed to the OpenCode session id.
  expect(captured.every((e) => e.sessionId === "sess-1")).toBe(true);
});
