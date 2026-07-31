/**
 * How each host's event JSON becomes agent telemetry.
 *
 * One file, one shape per host. This is the part that genuinely differs
 * between hosts — everything else (the vocabulary, the redaction, the
 * fingerprint) is shared, which is why `codex-cli` and `gemini-cli` were
 * byte-identical packages: they contained none of this.
 *
 * A host mapper returns *what to do*, not what to send. It never calls the
 * tracker, so every mapping is testable as a pure function against a captured
 * event payload.
 */

import { emptyProjection, type AgentHost, type SetupProjection } from "@counted/agent-core";

/** A tracker call, described rather than made. */
export type Action =
  | { readonly kind: "session_start"; readonly model?: string | undefined; readonly mode?: string | undefined }
  | {
      readonly kind: "session_end";
      readonly durationMs?: number | undefined;
      readonly toolUseCount?: number | undefined;
      readonly fileEditCount?: number | undefined;
    }
  | {
      readonly kind: "tool_use";
      readonly tool: string;
      readonly outcome: "success" | "error" | "denied";
      readonly durationMs?: number | undefined;
    }
  | {
      readonly kind: "file_edit";
      readonly filePath: string;
      readonly action: "create" | "edit" | "delete";
    }
  | { readonly kind: "command_run"; readonly command: string; readonly exitCode?: number | undefined };

export type HostEvent = Readonly<Record<string, unknown>>;

export type Reading = {
  /** What the host called this session. Becomes the visit, so events group. */
  readonly sessionId: string | undefined;
  readonly cwd: string | undefined;
  /** Only some events carry it; the caller caches it for the rest. */
  readonly model: string | undefined;
  readonly actions: readonly Action[];
  /** Present only on the event that can see the configuration. */
  readonly setup: SetupProjection | null;
};

const str = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const obj = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const empty = (host: AgentHost): Reading => ({
  sessionId: undefined,
  cwd: undefined,
  model: undefined,
  actions: [],
  setup: null,
});

/**
 * Claude Code.
 *
 * Hooks run as a separate process per event, so the model — which only appears
 * on `SessionStart` — has to be cached by the caller for later events. That is
 * why `Reading` reports it rather than folding it into the actions.
 */
const claudeCode = (input: HostEvent): Reading => {
  const event = str(input["hook_event_name"]);
  const sessionId = str(input["session_id"]);
  const cwd = str(input["cwd"]);
  const model = str(input["model"]);
  const base = { sessionId, cwd, model, setup: null } as const;

  if (event === "SessionStart") {
    return { ...base, actions: [{ kind: "session_start", model, mode: str(input["source"]) }] };
  }
  if (event === "SessionEnd") {
    return { ...base, actions: [{ kind: "session_end" }] };
  }
  // `PostToolUse` fires only on success and `PostToolUseFailure` only on
  // failure. Reading one of them alone reported success forever, which made
  // the tool-outcome breakdown a constant.
  if (event === "PostToolUse" || event === "PostToolUseFailure") {
    const failed = event === "PostToolUseFailure";
    const tool = str(input["tool_name"]) ?? "unknown";
    const toolInput = obj(input["tool_input"]);
    const actions: Action[] = [{ kind: "tool_use", tool, outcome: failed ? "error" : "success" }];

    const filePath = str(toolInput["file_path"]);
    if (filePath !== undefined && (tool === "Write" || tool === "Edit" || tool === "MultiEdit")) {
      actions.push({ kind: "file_edit", filePath, action: tool === "Write" ? "create" : "edit" });
    }
    const command = str(toolInput["command"]);
    if (command !== undefined && tool === "Bash") {
      // Claude Code does not surface a real exit code to a hook, so a failure
      // is reported as "nonzero" and a success leaves it unset rather than
      // asserting a 0 nobody observed.
      actions.push({ kind: "command_run", command, ...(failed ? { exitCode: 1 } : {}) });
    }
    return { ...base, actions };
  }
  return { ...empty("claude-code"), sessionId, cwd, model };
};

/**
 * OpenCode's config, projected.
 *
 * Exported because the in-process plugin builds the same projection from the
 * config object it is handed — the mapping must not exist twice.
 */
export const openCodeProjection = (config: Readonly<Record<string, unknown>>): SetupProjection => {
  const permission = obj(config["permission"]);
  const base = emptyProjection("opencode");
  return {
    ...base,
    model: str(config["model"]) ?? null,
    prompts: Object.keys(obj(config["agent"] ?? config["agents"]))
      .sort()
      .map((id) => ({ id, sha256: "" })),
    tools: {
      allow: strings(permission["allow"] ?? config["tools"]),
      deny: strings(permission["deny"]),
      mode: str(permission["mode"]) ?? null,
    },
    sampling: {
      temperature: num(config["temperature"]) ?? null,
      topP: num(config["top_p"]) ?? null,
      reasoningEffort: str(config["reasoningEffort"] ?? config["reasoning_effort"]) ?? null,
    },
  };
};

/**
 * Codex CLI and Gemini CLI.
 *
 * Both hosts invoke a command with the event on stdin, in the same shape: a
 * `type`, a tool name, and the tool's arguments. They previously had a package
 * each, containing nothing but a copy of the SDK wrapper and no hook at all —
 * `md5 48ab6ab2…`, identical, and doing nothing when installed.
 */
const stdinShaped =
  (host: AgentHost) =>
  (input: HostEvent): Reading => {
    const sessionId = str(input["session_id"] ?? input["sessionId"] ?? input["conversation_id"]);
    const cwd = str(input["cwd"] ?? input["workspace"]);
    const model = str(input["model"]);
    const type = str(input["type"] ?? input["event"] ?? input["hook_event_name"]);
    const base = { sessionId, cwd, model, setup: null } as const;

    if (type === "session_start" || type === "SessionStart" || type === "start") {
      return { ...base, actions: [{ kind: "session_start", model, mode: str(input["mode"]) }] };
    }
    if (type === "session_end" || type === "SessionEnd" || type === "stop") {
      return { ...base, actions: [{ kind: "session_end", durationMs: num(input["duration_ms"]) }] };
    }
    if (type === "tool_use" || type === "tool_call" || type === "PostToolUse") {
      const tool = str(input["tool"] ?? input["tool_name"]) ?? "unknown";
      const args = obj(input["args"] ?? input["tool_input"] ?? input["arguments"]);
      const failed = input["success"] === false || num(input["exit_code"]) === 1 || str(input["outcome"]) === "error";
      const denied = str(input["outcome"]) === "denied" || input["permission_denied"] === true;
      const actions: Action[] = [
        { kind: "tool_use", tool, outcome: denied ? "denied" : failed ? "error" : "success" },
      ];

      const filePath = str(args["file_path"] ?? args["filePath"] ?? args["path"]);
      if (filePath !== undefined) {
        const action = str(args["action"]);
        actions.push({
          kind: "file_edit",
          filePath,
          action: action === "create" || action === "delete" ? action : "edit",
        });
      }
      const command = str(args["command"] ?? args["cmd"]);
      if (command !== undefined) {
        actions.push({ kind: "command_run", command, exitCode: num(input["exit_code"]) });
      }
      return { ...base, actions };
    }
    return { ...empty(host), sessionId, cwd, model };
  };

export const HOSTS: Readonly<Record<AgentHost, (input: HostEvent) => Reading>> = {
  "claude-code": claudeCode,
  codex: stdinShaped("codex"),
  gemini: stdinShaped("gemini"),
  generic: stdinShaped("generic"),
  // OpenCode does not run a hook process; it loads an in-process plugin, which
  // is why it has a package and these hosts do not. Reading a stdin event for
  // it would be answering a question nobody asks.
  opencode: () => empty("opencode"),
};
