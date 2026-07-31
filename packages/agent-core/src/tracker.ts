/**
 * The tracker every host adapter drives.
 *
 * Thin on purpose: the SDK already handles batching, retries and the queue, so
 * this adds exactly the two things an agent integration needs on top —
 * validation against the vocabulary before an event is sent, and the setup
 * context stamped on every event without each adapter remembering to.
 *
 * It also decides what happens when an integration is not configured, which is
 * the common case: no key, no client, no network, no error. An analytics hook
 * that breaks somebody's agent session is worse than one that reports nothing.
 */

import { Counted, type CountedOptions } from "@counted/sdk-js";
import {
  validateAgentContext,
  validateAgentEvent,
  type AgentEventName,
  type AgentHost,
  type VocabularyValue,
} from "./gen/vocabulary";
import { setupFingerprint, type SetupProjection } from "./fingerprint";
import { cmdName, langOf, relPath, scrubSecrets, truncate } from "./redaction";

export type AgentTrackerOptions = {
  readonly key: string | undefined;
  readonly host: AgentHost;
  readonly endpoint?: string | undefined;
  /** The host's own session id, so events group the way the host groups them. */
  readonly sessionId?: string | undefined;
  /** A human label for this setup, from `COUNTED_SETUP_LABEL`. */
  readonly label?: string | undefined;
  readonly flushIntervalMs?: number | undefined;
  /**
   * What to do with an event that fails the vocabulary.
   *
   * `throw` on a developer's machine, so a wrong event fails where it was
   * written. `drop` in production, because a telemetry hook must never be the
   * reason a session dies. Defaults to `throw` when `NODE_ENV` is not
   * `production` — the environment where somebody is looking.
   */
  readonly onInvalid?: "throw" | "drop" | undefined;
  readonly fetch?: typeof fetch | undefined;
  readonly onWarning?: ((message: string) => void) | undefined;
};

export type AgentTracker = {
  /** False when no key was configured. Every method is then a no-op. */
  readonly enabled: boolean;
  readonly track: (name: AgentEventName, properties: Readonly<Record<string, VocabularyValue>>) => void;
  /** Fingerprint a projection and stamp it on every subsequent event. */
  readonly registerSetup: (projection: SetupProjection, hostSpecVersion?: number) => void;
  readonly sessionStart: (props: { model?: string | undefined; mode?: string | undefined }) => void;
  readonly sessionEnd: (props: {
    durationMs?: number | undefined;
    toolUseCount?: number | undefined;
    fileEditCount?: number | undefined;
  }) => void;
  readonly toolUse: (props: {
    tool: string;
    outcome: "success" | "error" | "denied";
    durationMs?: number | undefined;
  }) => void;
  readonly fileEdit: (props: {
    filePath: string;
    action: "create" | "edit" | "delete";
    cwd?: string | undefined;
  }) => void;
  readonly commandRun: (props: { command: string; exitCode?: number | undefined }) => void;
  readonly flush: () => Promise<void>;
  readonly shutdown: () => Promise<void>;
};

const NOOP_PROMISE = async (): Promise<void> => {};

/** The no-op tracker. Returned when nothing is configured, so callers branch once. */
const disabled: AgentTracker = {
  enabled: false,
  track: () => {},
  registerSetup: () => {},
  sessionStart: () => {},
  sessionEnd: () => {},
  toolUse: () => {},
  fileEdit: () => {},
  commandRun: () => {},
  flush: NOOP_PROMISE,
  shutdown: NOOP_PROMISE,
};

/**
 * Drops keys whose value is `undefined`, in the type as well as at runtime.
 *
 * The vocabulary distinguishes "absent" from "present and wrong", so an
 * optional field that was not supplied must not arrive as an explicit
 * `undefined` — that would be refused as the wrong type rather than accepted
 * as missing.
 */
const defined = <T extends Record<string, unknown>>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

export const createAgentTracker = (options: AgentTrackerOptions): AgentTracker => {
  if (options.key === undefined || options.key.trim().length === 0) return disabled;

  const strict = options.onInvalid ?? (process.env["NODE_ENV"] === "production" ? "drop" : "throw");
  const warn = options.onWarning ?? ((message: string) => void process.stderr.write(`counted: ${message}\n`));
  // One warning per event name, not per event: a hook firing on every tool call
  // would otherwise write a line per call for the rest of the session.
  const warned = new Set<string>();

  const client = new Counted(
    defined({
      key: options.key,
      endpoint: options.endpoint,
      // An agent session is explicit — it starts and ends when the host says
      // so — and can idle for an hour mid-task. Rolling the visit on idle
      // would split one session into several.
      visitId: options.sessionId,
      flushIntervalMs: options.flushIntervalMs ?? 10_000,
      fetch: options.fetch,
    }) as CountedOptions,
  );

  let context: Record<string, VocabularyValue> = {};

  const track = (name: AgentEventName, properties: Readonly<Record<string, VocabularyValue>>): void => {
    const cleaned = defined(properties as Record<string, VocabularyValue>);
    const problem = validateAgentEvent(name, cleaned);
    if (problem !== null) {
      const message = `${problem.event}: ${problem.problems.join("; ")}`;
      if (strict === "throw") throw new Error(`invalid agent event — ${message}`);
      if (!warned.has(name)) {
        warned.add(name);
        warn(`dropped ${message}`);
      }
      return;
    }
    // The setup context rides along rather than being registered on the client,
    // because a hook process that is re-created per event would lose it.
    client.track(name, { ...context, ...cleaned });
  };

  return {
    enabled: true,
    track,

    registerSetup: (projection, hostSpecVersion) => {
      const fingerprint = setupFingerprint(projection, hostSpecVersion);
      const next: Record<string, VocabularyValue> = {
        setupHash: fingerprint.setupHash,
        setupSpec: fingerprint.setupSpec,
        setupHostSpec: fingerprint.setupHostSpec,
        ...(projection.model === null ? {} : { model: projection.model }),
        ...(options.label === undefined ? {} : { setupLabel: truncate(options.label, 80) }),
      };
      const problem = validateAgentContext(next);
      if (problem !== null) {
        if (strict === "throw") throw new Error(`invalid agent context — ${problem.problems.join("; ")}`);
        warn(`ignored setup context — ${problem.problems.join("; ")}`);
        return;
      }
      context = next;
    },

    sessionStart: (props) =>
      track("agent_session_start", defined({ ...props, host: options.host })),

    sessionEnd: (props) => track("agent_session_end", defined({ ...props })),

    toolUse: (props) =>
      track(
        "agent_tool_use",
        defined({ ...props, tool: truncate(scrubSecrets(props.tool), 80) }),
      ),

    fileEdit: (props) => {
      const path = truncate(relPath(props.filePath, props.cwd), 400);
      const language = langOf(props.filePath);
      track("agent_file_edit", defined({ path, action: props.action, language }));
    },

    commandRun: (props) =>
      track(
        "agent_command_run",
        defined({ command: truncate(cmdName(props.command), 64), exitCode: props.exitCode }),
      ),

    flush: () => client.flush(),
    shutdown: () => client.shutdown(),
  };
};
