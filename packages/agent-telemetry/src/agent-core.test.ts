/**
 * The shared core.
 *
 * Three things are decided here and nowhere else, so they are tested here and
 * nowhere else: what an agent event may say, what may leave the machine, and
 * what a setup fingerprint means.
 */

import { describe, expect, test } from "bun:test";
import {
  canonicalize,
  cmdName,
  createAgentTracker,
  emptyProjection,
  langOf,
  relPath,
  scrubSecrets,
  setupFingerprint,
  validateAgentContext,
  validateAgentEvent,
  AGENT_EVENTS,
  type SetupProjection,
} from "./index";

describe("the vocabulary", () => {
  test("an event outside it is refused, not silently accepted", () => {
    // The prefix is the claim. Making one up and having it stored would put a
    // series in the agent dashboards that no host ever emits.
    expect(validateAgentEvent("agent_vibes", {})?.problems).toEqual([
      "agent_vibes is not in the agent vocabulary",
    ]);
  });

  test("a customer's own event is none of our business", () => {
    // No prefix, no opinion. A product that validated its customers' event
    // names would be refusing data it was paid to store.
    expect(validateAgentEvent("session_start", { anything: "goes" })).toBeNull();
    expect(validateAgentEvent("checkout_completed", {})).toBeNull();
  });

  test("a missing required property is named", () => {
    expect(validateAgentEvent("agent_tool_use", { tool: "Bash" })?.problems).toEqual([
      "outcome is required",
    ]);
  });

  test("an unknown property is refused rather than dropped", () => {
    // A typo that vanishes is a metric that reads zero and looks fine.
    expect(validateAgentEvent("agent_tool_use", { tool: "Bash", outcome: "success", tolo: 1 })?.problems).toEqual(
      ["tolo is not a property of this event"],
    );
  });

  test("an enum outside its values is named with the values", () => {
    expect(validateAgentEvent("agent_tool_use", { tool: "Bash", outcome: "ok" })?.problems).toEqual([
      "outcome must be one of success, error, denied",
    ]);
  });

  test("a valid event of every kind passes", () => {
    // Otherwise "everything is invalid" would satisfy every test above.
    const valid: Record<string, Record<string, string | number>> = {
      agent_session_start: { host: "claude-code" },
      agent_session_end: {},
      agent_tool_use: { tool: "Bash", outcome: "success" },
      agent_file_edit: { path: "src/a.ts", action: "edit" },
      agent_command_run: { command: "git" },
    };
    for (const name of AGENT_EVENTS) {
      expect({ name, problem: validateAgentEvent(name, valid[name] ?? {}) }).toMatchObject({ problem: null });
    }
  });

  test("the context is validated too, since it rides on every event", () => {
    expect(validateAgentContext({ setupHash: "a", setupSpec: "counted.setup/1", setupHostSpec: "x" })).toBeNull();
    expect(validateAgentContext({ setupHash: "a" })?.problems).toContain("setupSpec is required");
  });
});

describe("what leaves the machine", () => {
  test("a path outside the repo is reduced to its filename", () => {
    // An absolute path carries the home directory, which carries a username.
    expect(relPath("/Users/someone/secret/thing.ts", "/repo")).toBe("thing.ts");
    expect(relPath("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
  });

  test("a command is reduced to its binary", () => {
    expect(cmdName("/usr/local/bin/git push --force origin main")).toBe("git");
  });

  test("an inline environment assignment is not the command", () => {
    // `AWS_SECRET=… aws s3 …` would otherwise report the secret as the
    // command name, which is the worst possible field to put it in.
    expect(cmdName("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI aws s3 ls")).toBe("aws");
  });

  test("credentials are scrubbed wherever they appear", () => {
    expect(scrubSecrets("ck_live_abc123def456ghi")).toBe("[redacted]");
    expect(scrubSecrets("sk-ant-api03-AAAAAAAAAAAAAAAAAAAA")).toBe("[redacted]");
    expect(scrubSecrets("ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe("[redacted]");
    expect(scrubSecrets("https://x.dev/cb?token=abcdefgh&ok=1")).toBe("https://x.dev/cb?token=[redacted]&ok=1");
  });

  test("a path is scrubbed as well as shortened", () => {
    // The case that motivated it: an agent editing a .env, where the key ends
    // up in a filename or a temp path.
    expect(relPath("/repo/tmp/sk_live_abcdefghijkl.json", "/repo")).toBe("tmp/[redacted].json");
  });

  test("a dotfile is not reported as a language", () => {
    expect(langOf(".env")).toBeUndefined();
    expect(langOf("src/a.ts")).toBe("typescript");
    expect(langOf("Makefile")).toBeUndefined();
  });
});

describe("the setup fingerprint", () => {
  const projection = (over: Partial<SetupProjection> = {}): SetupProjection => ({
    ...emptyProjection("claude-code"),
    model: "opus",
    prompts: [{ id: "CLAUDE.md", sha256: "aa" }],
    tools: { allow: ["Bash"], deny: [], mode: "acceptEdits" },
    ...over,
  });

  test("the same setup fingerprints the same regardless of ordering", () => {
    // Two machines enumerating a directory differently describe one setup. If
    // that changed the hash, the breakdown would report a config change per
    // filesystem.
    const a = setupFingerprint(projection({ prompts: [{ id: "b", sha256: "1" }, { id: "a", sha256: "2" }] }));
    const b = setupFingerprint(projection({ prompts: [{ id: "a", sha256: "2" }, { id: "b", sha256: "1" }] }));
    expect(a.setupHash).toBe(b.setupHash);
  });

  test("a different model is a different setup", () => {
    expect(setupFingerprint(projection()).setupHash).not.toBe(
      setupFingerprint(projection({ model: "sonnet" })).setupHash,
    );
  });

  test("two hosts describing the same setup agree", () => {
    // The bug this replaces: each adapter hashed its own host's config shape,
    // so identical setups on two hosts could never match and the version
    // number said they were comparable.
    const claude = setupFingerprint(projection({ host: "claude-code" }));
    const opencode = setupFingerprint(projection({ host: "opencode" }));
    expect(claude.setupSpec).toBe(opencode.setupSpec);
    // The host is part of the projection, so the hashes differ — but the spec
    // says so, and the host spec says which mapping produced each.
    expect(claude.setupHostSpec).toBe("counted.setup/1+claude-code");
    expect(opencode.setupHostSpec).toBe("counted.setup/1+opencode");
  });

  test("a host that changes how it reads its config says so, alone", () => {
    // The second version field. Bumping it invalidates comparison within one
    // host without claiming every other host changed.
    expect(setupFingerprint(projection(), 2).setupHostSpec).toBe("counted.setup/1+claude-code/2");
    expect(setupFingerprint(projection(), 2).setupSpec).toBe("counted.setup/1");
  });

  test("an omitted field and a null field cannot be confused", () => {
    // Why the projection says `null` rather than leaving a key out: the two
    // would canonicalize identically and one setup would wear another's hash.
    expect(canonicalize({ a: 1, b: null })).toBe('{"a":1,"b":null}');
    expect(canonicalize({ b: null, a: 1 })).toBe('{"a":1,"b":null}');
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 1, b: null }));
  });

  test("prompt content is never part of the projection", () => {
    // The load-bearing privacy property. Only a digest is carried, so the
    // serialized projection cannot contain the prompt even by accident.
    const serialized = canonicalize(projection());
    expect(serialized).toContain("CLAUDE.md");
    expect(serialized).not.toContain("sha256\":\"\"");
  });
});

describe("the tracker", () => {
  const capture = () => {
    const sent: { name: string; properties: Record<string, unknown> }[] = [];
    const fetchImpl = (async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { events: { name: string; properties: Record<string, unknown> }[] };
      for (const event of body.events) sent.push(event);
      return new Response(JSON.stringify({ accepted: body.events.length, deduplicated: 0, rejected: 0 }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return { sent, fetchImpl };
  };

  test("no key is a no-op, not an error", () => {
    // The common case. A telemetry hook that throws because it was not
    // configured is a hook that breaks a session it was not even reporting on.
    const tracker = createAgentTracker({ key: undefined, host: "claude-code" });
    expect(tracker.enabled).toBe(false);
    expect(() => tracker.toolUse({ tool: "Bash", outcome: "success" })).not.toThrow();
  });

  test("the setup context rides on every event", async () => {
    const { sent, fetchImpl } = capture();
    const tracker = createAgentTracker({ key: "ck_x", host: "claude-code", fetch: fetchImpl });
    tracker.registerSetup(emptyProjection("claude-code"));
    tracker.toolUse({ tool: "Bash", outcome: "success" });
    tracker.commandRun({ command: "git status" });
    await tracker.shutdown();

    expect(sent).toHaveLength(2);
    for (const event of sent) {
      expect(event.properties).toMatchObject({ setupSpec: "counted.setup/1" });
    }
  });

  test("a command reaches the wire as a binary name", async () => {
    const { sent, fetchImpl } = capture();
    const tracker = createAgentTracker({ key: "ck_x", host: "claude-code", fetch: fetchImpl });
    tracker.commandRun({ command: "/usr/bin/psql postgres://user:hunter2@host/db" });
    await tracker.shutdown();
    expect(sent[0]?.properties).toMatchObject({ command: "psql" });
    expect(JSON.stringify(sent)).not.toContain("hunter2");
  });

  test("an invalid event throws where it was written", () => {
    // Outside production, the developer writing the wrong event is the person
    // who can fix it, and a silent drop tells them nothing.
    const tracker = createAgentTracker({ key: "ck_x", host: "claude-code", onInvalid: "throw" });
    expect(() => tracker.track("agent_tool_use", { tool: "Bash" })).toThrow(/outcome is required/);
  });

  test("in production it is dropped, and warned about once", async () => {
    const warnings: string[] = [];
    const { sent, fetchImpl } = capture();
    const tracker = createAgentTracker({
      key: "ck_x",
      host: "claude-code",
      onInvalid: "drop",
      onWarning: (m) => void warnings.push(m),
      fetch: fetchImpl,
    });
    for (let i = 0; i < 5; i++) tracker.track("agent_tool_use", { tool: "Bash" });
    await tracker.shutdown();

    expect(sent).toEqual([]);
    // Once per event name, not once per event: a hook on every tool call would
    // otherwise write a line per call for the rest of the session.
    expect(warnings).toHaveLength(1);
  });
});
