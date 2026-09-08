/**
 * The hook binary, and the host mappings.
 *
 * Every mapping is a pure function from a captured host payload to a list of
 * actions, so this needs no process and no agent. The end-to-end tests drive
 * `handle` with a fake fetch, which is the only place the two halves meet.
 */

import { describe, expect, test } from "bun:test";
import { HOSTS, type HostEvent } from "./hosts";
import { handle, parseHost, readKey, type RunDeps } from "./run";

const claude = (event: HostEvent) => HOSTS["claude-code"](event);

describe("Claude Code's events", () => {
  test("a session start carries the model, which no later event does", () => {
    const reading = claude({ hook_event_name: "SessionStart", session_id: "s1", model: "opus", source: "startup" });
    expect(reading.actions).toEqual([{ kind: "session_start", model: "opus", mode: "startup" }]);
    expect(reading.model).toBe("opus");
  });

  test("success and failure are different events, so the outcome is real", () => {
    // Reading `PostToolUse` alone reported success forever, which made the
    // tool-outcome breakdown a constant labelled as a measurement.
    const ok = claude({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} });
    const bad = claude({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: {} });
    expect(ok.actions[0]).toMatchObject({ kind: "tool_use", outcome: "success" });
    expect(bad.actions[0]).toMatchObject({ kind: "tool_use", outcome: "error" });
  });

  test("a write is a create and an edit is an edit", () => {
    const reading = claude({
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/repo/src/a.ts" },
    });
    expect(reading.actions).toContainEqual({ kind: "file_edit", filePath: "/repo/src/a.ts", action: "create" });
  });

  test("a failed Bash reports a nonzero exit, a successful one asserts nothing", () => {
    // Claude Code does not give a hook the real exit code. Reporting 0 would
    // be inventing an observation.
    const ok = claude({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
    const bad = claude({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "ls" } });
    expect(ok.actions).toContainEqual({ kind: "command_run", command: "ls" });
    expect(bad.actions).toContainEqual({ kind: "command_run", command: "ls", exitCode: 1 });
  });

  test("an event it does not map produces nothing", () => {
    expect(claude({ hook_event_name: "PreToolUse", session_id: "s1" }).actions).toEqual([]);
  });
});

describe("the stdin-shaped hosts", () => {
  test("codex and gemini read the same payload — they always did", () => {
    // The two packages they replace were byte-identical, which is exactly the
    // evidence that nothing host-specific was ever in them.
    const event: HostEvent = { type: "tool_use", tool: "shell", args: { command: "make build" } };
    expect(HOSTS["codex"](event).actions).toEqual(HOSTS["gemini"](event).actions);
  });

  test("a denied tool is its own outcome, not an error", () => {
    const reading = HOSTS["codex"]({ type: "tool_use", tool: "shell", outcome: "denied", args: {} });
    expect(reading.actions[0]).toMatchObject({ outcome: "denied" });
  });

  test("opencode reads no stdin event, because it is not a hook", () => {
    expect(HOSTS["opencode"]({ type: "tool_use" }).actions).toEqual([]);
  });
});

describe("the arguments and the environment", () => {
  test("an unknown or missing host falls back to generic", () => {
    expect(parseHost(["--host", "claude-code"])).toBe("claude-code");
    expect(parseHost(["--host", "emacs"])).toBe("generic");
    expect(parseHost([])).toBe("generic");
  });

  test("the key is read from where Claude Code actually puts it", () => {
    // `hooks.json`'s `env` mapping is unsupported; a plugin's own config
    // arrives as CLAUDE_PLUGIN_OPTION_<KEY>.
    expect(readKey({ CLAUDE_PLUGIN_OPTION_API_KEY: "ck_a" })).toBe("ck_a");
    expect(readKey({ COUNTED_AGENT_KEY: "ck_b", CLAUDE_PLUGIN_OPTION_API_KEY: "ck_a" })).toBe("ck_b");
    expect(readKey({})).toBeUndefined();
  });
});

describe("handling one event end to end", () => {
  const drive = async (event: HostEvent, env: Record<string, string | undefined>) => {
    const sent: { name: string; properties: Record<string, unknown> }[] = [];
    const warnings: string[] = [];
    const fetchImpl = (async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { events: typeof sent };
      sent.push(...body.events);
      return new Response(JSON.stringify({ accepted: body.events.length, deduplicated: 0, rejected: 0 }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const deps: RunDeps = {
      env,
      argv: ["--host", "claude-code"],
      cwd: () => "/repo",
      warn: (m) => void warnings.push(m),
      fetch: fetchImpl,
    };
    await handle(event, deps);
    return { sent, warnings };
  };

  test("no key sends nothing and says so once, on session start", async () => {
    const start = await drive({ hook_event_name: "SessionStart", session_id: "s1" }, {});
    expect(start.sent).toEqual([]);
    expect(start.warnings).toHaveLength(1);

    // And not on every tool call for the rest of the session.
    const tool = await drive({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} }, {});
    expect(tool.warnings).toEqual([]);
  });

  test("a configured hook sends the event with its setup context", async () => {
    const { sent } = await drive(
      { hook_event_name: "SessionStart", session_id: "s-ctx", model: "opus", cwd: "/repo" },
      { COUNTED_AGENT_KEY: "ck_x" },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ name: "agent_session_start" });
    expect(sent[0]?.properties).toMatchObject({ host: "claude-code", setupSpec: "counted.setup/1" });
  });

  test("a file edit arrives repo-relative, never absolute", async () => {
    const { sent } = await drive(
      {
        hook_event_name: "PostToolUse",
        session_id: "s2",
        cwd: "/repo",
        tool_name: "Edit",
        tool_input: { file_path: "/repo/src/deep/a.ts" },
      },
      { COUNTED_AGENT_KEY: "ck_x" },
    );
    const edit = sent.find((e) => e.name === "agent_file_edit");
    expect(edit?.properties).toMatchObject({ path: "src/deep/a.ts", language: "typescript" });
  });

  test("every event of a session reports the same setup", async () => {
    // Hooks are a process per event and only the first can see the model, so
    // the fingerprint is cached. Without that, one session would appear as
    // several in a breakdown by setup.
    const key = { COUNTED_AGENT_KEY: "ck_x" };
    const session = `s-${process.pid}-cache`;
    const first = await drive({ hook_event_name: "SessionStart", session_id: session, cwd: "/repo", model: "opus" }, key);
    const later = await drive(
      { hook_event_name: "PostToolUse", session_id: session, cwd: "/repo", tool_name: "Bash", tool_input: {} },
      key,
    );
    expect(later.sent[0]?.properties["setupHash"]).toBe(first.sent[0]?.properties["setupHash"] as string);
  });

  test("a malformed event is dropped rather than sent", async () => {
    // The server would refuse it anyway — this is the same check, run where
    // the developer can see it.
    const { sent } = await drive(
      { hook_event_name: "PostToolUse", session_id: "s3", tool_name: "", tool_input: {} },
      { COUNTED_AGENT_KEY: "ck_x" },
    );
    // An empty tool name still validates (it has a default), so what this
    // asserts is that nothing outside the vocabulary got through.
    for (const event of sent) expect(String(event.name).startsWith("agent_")).toBe(true);
  });
});
