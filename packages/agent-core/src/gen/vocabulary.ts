/**
 * Generated from contract/gen/agent.json. Do not edit.
 * Run `bun run contract:generate` and commit the result.
 *
 * The agent telemetry vocabulary, and the check that enforces it.
 *
 * Both the data and the validator are generated, because two hand-written
 * validators over one list is two lists: they drift, and the drift shows up as
 * an event the SDK accepted and the server refused.
 */

export const AGENT_EVENT_PREFIX = "agent_";

export const AGENT_HOSTS = ["claude-code","opencode","codex","gemini","generic"] as const;
export type AgentHost = (typeof AGENT_HOSTS)[number];

export const SETUP_SPEC = "counted.setup/1" as const;

export const AGENT_EVENTS = ["agent_session_start","agent_session_end","agent_tool_use","agent_file_edit","agent_command_run"] as const;
export type AgentEventName = (typeof AGENT_EVENTS)[number];

export type FieldSpec =
  | { readonly type: "string"; readonly optional?: boolean; readonly maxLength?: number }
  | { readonly type: "integer"; readonly optional?: boolean; readonly min?: number }
  | { readonly type: "enum"; readonly optional?: boolean; readonly values: readonly string[] };

export const AGENT_EVENT_FIELDS: Readonly<Record<AgentEventName, Readonly<Record<string, FieldSpec>>>> =
{
  "agent_session_start": {
    "model": {
      "type": "string",
      "optional": true,
      "maxLength": 120
    },
    "mode": {
      "type": "string",
      "optional": true,
      "maxLength": 40
    },
    "host": {
      "type": "enum",
      "values": [
        "claude-code",
        "opencode",
        "codex",
        "gemini",
        "generic"
      ]
    }
  },
  "agent_session_end": {
    "durationMs": {
      "type": "integer",
      "optional": true,
      "min": 0
    },
    "toolUseCount": {
      "type": "integer",
      "optional": true,
      "min": 0
    },
    "fileEditCount": {
      "type": "integer",
      "optional": true,
      "min": 0
    }
  },
  "agent_tool_use": {
    "tool": {
      "type": "string",
      "maxLength": 80
    },
    "outcome": {
      "type": "enum",
      "values": [
        "success",
        "error",
        "denied"
      ]
    },
    "durationMs": {
      "type": "integer",
      "optional": true,
      "min": 0
    }
  },
  "agent_file_edit": {
    "path": {
      "type": "string",
      "maxLength": 400
    },
    "action": {
      "type": "enum",
      "values": [
        "create",
        "edit",
        "delete"
      ]
    },
    "language": {
      "type": "string",
      "optional": true,
      "maxLength": 40
    }
  },
  "agent_command_run": {
    "command": {
      "type": "string",
      "maxLength": 64
    },
    "exitCode": {
      "type": "integer",
      "optional": true
    }
  }
};

/** Session context, registered once and stamped on every event. */
export const AGENT_CONTEXT_FIELDS: Readonly<Record<string, FieldSpec>> =
{
  "setupHash": {
    "type": "string",
    "maxLength": 64
  },
  "setupSpec": {
    "type": "string",
    "maxLength": 40
  },
  "setupHostSpec": {
    "type": "string",
    "maxLength": 60
  },
  "model": {
    "type": "string",
    "optional": true,
    "maxLength": 120
  },
  "setupLabel": {
    "type": "string",
    "optional": true,
    "maxLength": 80
  }
};

/** A property value as it may appear on the wire. */
export type VocabularyValue = string | number | boolean | null;

const checkField = (name: string, spec: FieldSpec, value: VocabularyValue | undefined): string | null => {
  if (value === undefined || value === null) {
    return spec.optional === true ? null : `${name} is required`;
  }
  if (spec.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) return `${name} must be an integer`;
    if (spec.min !== undefined && value < spec.min) return `${name} must be at least ${spec.min}`;
    return null;
  }
  if (typeof value !== "string") return `${name} must be a string`;
  if (spec.type === "enum") {
    return spec.values.includes(value) ? null : `${name} must be one of ${spec.values.join(", ")}`;
  }
  if (spec.maxLength !== undefined && value.length > spec.maxLength) {
    return `${name} must be at most ${spec.maxLength} characters`;
  }
  return null;
};

const checkAgainst = (
  spec: Readonly<Record<string, FieldSpec>>,
  properties: Readonly<Record<string, VocabularyValue>>,
): readonly string[] => {
  const problems: string[] = [];
  for (const [name, field] of Object.entries(spec)) {
    const problem = checkField(name, field, properties[name]);
    if (problem !== null) problems.push(problem);
  }
  // Unknown properties are refused rather than dropped. A typo that silently
  // vanishes is a metric that silently reads zero.
  for (const name of Object.keys(properties)) {
    if (!(name in spec)) problems.push(`${name} is not a property of this event`);
  }
  return problems;
};

export const isAgentEventName = (name: string): name is AgentEventName =>
  (AGENT_EVENTS as readonly string[]).includes(name);

/**
 * Whether a name claims to be agent telemetry.
 *
 * Anything with the prefix is held to the vocabulary; anything without it is a
 * customer's own event and none of our business. The prefix exists so that a
 * customer's `session_start` and an agent's are never the same series.
 */
export const claimsAgentVocabulary = (name: string): boolean => name.startsWith(AGENT_EVENT_PREFIX);

export type VocabularyProblem = { readonly event: string; readonly problems: readonly string[] };

/**
 * Validate one agent event's properties.
 *
 * Returns `null` when the name is not agent telemetry at all — the caller
 * decides what that means, which differs between the SDK and the server.
 */
export const validateAgentEvent = (
  name: string,
  properties: Readonly<Record<string, VocabularyValue>> = {},
): VocabularyProblem | null => {
  if (!claimsAgentVocabulary(name)) return null;
  if (!isAgentEventName(name)) {
    return { event: name, problems: [`${name} is not in the agent vocabulary`] };
  }
  const problems = checkAgainst(AGENT_EVENT_FIELDS[name], properties);
  return problems.length === 0 ? null : { event: name, problems };
};

/** Validate the per-session context before it is registered. */
export const validateAgentContext = (
  context: Readonly<Record<string, VocabularyValue>>,
): VocabularyProblem | null => {
  const problems = checkAgainst(AGENT_CONTEXT_FIELDS, context);
  return problems.length === 0 ? null : { event: "context", problems };
};
