/**
 * `counted-agent` — one hook binary for every host that speaks stdin.
 *
 * Reads a host's event JSON on stdin, maps it to agent telemetry, sends it,
 * exits. The rules it must never break, in order of how badly breaking them
 * would go:
 *
 * 1. **Never break the session.** Every error is swallowed, the exit code is
 *    always 0, and there is a hard self-timeout — a hook that hangs is a hook
 *    that stalls somebody's agent.
 * 2. **No key means do nothing.** Not an error, not a warning on every event.
 *    Said once, on the first event of a session, so the silence is diagnosable
 *    without being noise.
 * 3. **Nothing but shape leaves.** Enforced in `@counted/agent-core`, not here.
 */

import {
  createAgentTracker,
  type AgentHost,
  AGENT_HOSTS,
} from "@counted/agent-core";
import { HOSTS, type Action, type HostEvent } from "./hosts";
import { resolveSetup } from "./setup";

/** Longer than this and the hook is the problem, whatever it was waiting for. */
export const SELF_KILL_MS = 4_000;

export const DEFAULT_ENDPOINT = "https://api.counted.dev/v1/events";

export const isAgentHost = (value: string): value is AgentHost =>
  (AGENT_HOSTS as readonly string[]).includes(value);

export const parseHost = (argv: readonly string[]): AgentHost => {
  const index = argv.indexOf("--host");
  const value = index === -1 ? undefined : argv[index + 1];
  return value !== undefined && isAgentHost(value) ? value : "generic";
};

export type Environment = Readonly<Record<string, string | undefined>>;

/**
 * The key, from whichever of the several places a host puts it.
 *
 * `CLAUDE_PLUGIN_OPTION_API_KEY` is how Claude Code exports a plugin's own
 * configuration to a hook process — the `env` mapping in `hooks.json` is not
 * supported, which is not obvious and was found the hard way.
 */
export const readKey = (env: Environment): string | undefined =>
  env["COUNTED_AGENT_KEY"] ?? env["CLAUDE_PLUGIN_OPTION_API_KEY"];

export const readEndpoint = (env: Environment): string =>
  env["COUNTED_AGENT_ENDPOINT"] ?? env["CLAUDE_PLUGIN_OPTION_ENDPOINT"] ?? DEFAULT_ENDPOINT;

export type RunDeps = {
  readonly env: Environment;
  readonly argv: readonly string[];
  readonly cwd: () => string;
  readonly warn: (message: string) => void;
  readonly fetch?: typeof fetch | undefined;
};

/**
 * Handle one host event.
 *
 * Separated from the process plumbing so the whole thing is testable: give it
 * an environment, an event, and a fetch, and every decision it makes is
 * observable in what was sent.
 */
export const handle = async (input: HostEvent, deps: RunDeps): Promise<void> => {
  const host = parseHost(deps.argv);
  const reading = HOSTS[host](input);
  const key = readKey(deps.env);

  if (key === undefined || key.trim().length === 0) {
    // Only when this is plainly the start of a session. Saying it on every
    // event would put a line in the user's terminal per tool call.
    if (reading.actions.some((a) => a.kind === "session_start")) {
      deps.warn("no project key found (set the plugin's api_key, or COUNTED_AGENT_KEY) — analytics disabled");
    }
    return;
  }

  if (reading.actions.length === 0) return;

  const tracker = createAgentTracker({
    key,
    host,
    endpoint: readEndpoint(deps.env),
    sessionId: reading.sessionId,
    label: deps.env["COUNTED_SETUP_LABEL"],
    // A hook process lives for one event, so buffering to batch would mean
    // discarding on exit. Flushed explicitly below instead.
    flushIntervalMs: 60_000,
    // Never throw into a host, whatever NODE_ENV happens to say here: this
    // process is inside somebody's agent session.
    onInvalid: "drop",
    onWarning: deps.warn,
    fetch: deps.fetch,
  });
  if (!tracker.enabled) return;

  const startsSession = reading.actions.some((a) => a.kind === "session_start");
  const setup = resolveSetup(
    host,
    reading.sessionId,
    reading.cwd ?? deps.cwd(),
    reading.model,
    typeof input["permission_mode"] === "string" ? input["permission_mode"] : undefined,
    startsSession,
  );
  tracker.registerSetup(setup.projection);

  const cwd = reading.cwd ?? deps.cwd();
  for (const action of reading.actions) apply(tracker, action, cwd);

  await tracker.shutdown();
};

/**
 * `cwd` is threaded in rather than read from the action, because only the
 * caller knows which directory the host meant — and without it every path
 * falls back to a bare filename, which is safe but throws away the repo
 * structure the file-edit breakdown is built on.
 */
const apply = (tracker: ReturnType<typeof createAgentTracker>, action: Action, cwd: string): void => {
  switch (action.kind) {
    case "session_start":
      tracker.sessionStart({ model: action.model, mode: action.mode });
      return;
    case "session_end":
      tracker.sessionEnd({
        durationMs: action.durationMs,
        toolUseCount: action.toolUseCount,
        fileEditCount: action.fileEditCount,
      });
      return;
    case "tool_use":
      tracker.toolUse({ tool: action.tool, outcome: action.outcome, durationMs: action.durationMs });
      return;
    case "file_edit":
      tracker.fileEdit({ filePath: action.filePath, action: action.action, cwd });
      return;
    case "command_run":
      tracker.commandRun({ command: action.command, exitCode: action.exitCode });
  }
};

/** Read stdin to the end. A host that sends nothing gets nothing back. */
export const readStdin = async (stream: AsyncIterable<Buffer | string>): Promise<string> => {
  let raw = "";
  for await (const chunk of stream) raw += chunk;
  return raw;
};

/**
 * The process entry point.
 *
 * Everything after this line is arranged so that no failure reaches the host:
 * a self-killing timer, a swallowed rejection, and an unconditional `exit(0)`.
 */
export const main = async (deps: RunDeps, stdin: AsyncIterable<Buffer | string>): Promise<void> => {
  const raw = await readStdin(stdin);
  let input: HostEvent;
  try {
    input = JSON.parse(raw) as HostEvent;
  } catch {
    // Not JSON. A host that invoked us for something else, or an empty pipe.
    return;
  }
  await handle(input, deps);
};
