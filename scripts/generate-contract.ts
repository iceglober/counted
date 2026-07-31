/**
 * Generate the per-language contract constants.
 *
 * The behaviour is hand-written in each language — a retry loop is not hard,
 * and four idiomatic ones beat one awkward shared one. What rots is the
 * **data**: enum values, defaults, backoff constants, status lists. So the
 * data is generated from one file and the generated output is committed, with
 * CI failing on any difference.
 *
 * Adding a language means adding an emitter here, not remembering to update a
 * fifth list by hand.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const source = JSON.parse(readFileSync(join(ROOT, "contract/gen/contract.json"), "utf8")) as Contract;

type Contract = {
  contractVersion: string;
  osNames: string[];
  osAliases: Record<string, string>;
  defaults: Record<string, number>;
  backoff: { baseMs: number; maxMs: number; factor: number; jitter: string };
  endpoints: Record<string, string>;
  retryableStatuses: number[];
  fatalStatuses: number[];
};

const BANNER = `Generated from contract/gen/contract.json. Do not edit.\nRun \`bun run contract:generate\` and commit the result.`;

const typescript = (c: Contract): string => `/**
 * ${BANNER.split("\n").join("\n * ")}
 */

export const CONTRACT_VERSION = ${JSON.stringify(c.contractVersion)} as const;

export const OS_NAMES = ${JSON.stringify(c.osNames)} as const;
export type OsName = (typeof OS_NAMES)[number];

/** Lowercased and stripped of spaces, underscores, hyphens and dots. */
export const OS_ALIASES: Readonly<Record<string, OsName>> = ${JSON.stringify(c.osAliases, null, 2)};

export const DEFAULTS = ${JSON.stringify(c.defaults, null, 2)} as const;

export const BACKOFF = ${JSON.stringify(c.backoff, null, 2)} as const;

export const ENDPOINTS = ${JSON.stringify(c.endpoints, null, 2)} as const;

/** Retry these when the server does not say whether to. */
export const RETRYABLE_STATUSES: readonly number[] = ${JSON.stringify(c.retryableStatuses)};

/** Never retry these. They mean a credential a developer has to fix. */
export const FATAL_STATUSES: readonly number[] = ${JSON.stringify(c.fatalStatuses)};
`;

const write = (relative: string, contents: string): void => {
  const path = join(ROOT, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  console.log(`wrote ${relative} (${contents.length} bytes)`);
};

const python = (c: Contract): string => `"""${BANNER.split("\n").join("\n")}"""

CONTRACT_VERSION = ${JSON.stringify(c.contractVersion)}

OS_NAMES = ${JSON.stringify(c.osNames)}

OS_ALIASES = ${JSON.stringify(c.osAliases, null, 4)}

DEFAULTS = ${JSON.stringify(c.defaults, null, 4)}

BACKOFF = ${JSON.stringify(c.backoff, null, 4)}

ENDPOINTS = ${JSON.stringify(c.endpoints, null, 4)}

RETRYABLE_STATUSES = ${JSON.stringify(c.retryableStatuses)}

FATAL_STATUSES = ${JSON.stringify(c.fatalStatuses)}
`;

const go = (c: Contract): string => `// ${BANNER.split("\n").join("\n// ")}

package counted

const ContractVersion = ${JSON.stringify(c.contractVersion)}

var OsNames = []string{${c.osNames.map((n) => JSON.stringify(n)).join(", ")}}

var OsAliases = map[string]string{
${Object.entries(c.osAliases).map(([k, v]) => `\t${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n")}
}

const (
${Object.entries(c.defaults).map(([k, v]) => `\t${k[0]!.toUpperCase()}${k.slice(1)} = ${v}`).join("\n")}
)

const (
\tBackoffBaseMs = ${c.backoff.baseMs}
\tBackoffMaxMs  = ${c.backoff.maxMs}
\tBackoffFactor = ${c.backoff.factor}
)

var RetryableStatuses = []int{${c.retryableStatuses.join(", ")}}

var FatalStatuses = []int{${c.fatalStatuses.join(", ")}}
`;

const rust = (c: Contract): string => `// ${BANNER.split("\n").join("\n// ")}

pub const CONTRACT_VERSION: &str = ${JSON.stringify(c.contractVersion)};

pub const OS_NAMES: [&str; ${c.osNames.length}] = [${c.osNames.map((n) => JSON.stringify(n)).join(", ")}];

pub const OS_ALIASES: [(&str, &str); ${Object.keys(c.osAliases).length}] = [
${Object.entries(c.osAliases).map(([k, v]) => `    (${JSON.stringify(k)}, ${JSON.stringify(v)}),`).join("\n")}
];

${Object.entries(c.defaults).map(([k, v]) => `pub const ${k.replace(/([A-Z])/g, "_$1").toUpperCase()}: u64 = ${v};`).join("\n")}

pub const BACKOFF_BASE_MS: u64 = ${c.backoff.baseMs};
pub const BACKOFF_MAX_MS: u64 = ${c.backoff.maxMs};
pub const BACKOFF_FACTOR: u64 = ${c.backoff.factor};

pub const RETRYABLE_STATUSES: [u16; ${c.retryableStatuses.length}] = [${c.retryableStatuses.join(", ")}];

pub const FATAL_STATUSES: [u16; ${c.fatalStatuses.length}] = [${c.fatalStatuses.join(", ")}];
`;

write("packages/sdk-js/src/gen/contract.ts", typescript(source));
write("packages/python/counted/_contract.py", python(source));
write("packages/go/contract_gen.go", go(source));
write("packages/rust/src/contract.rs", rust(source));

/* ------------------------------------------------------------------ *
 * The agent telemetry vocabulary.
 *
 * Two packages have to agree about it and neither may depend on the
 * other: `agent-core` runs on a developer's machine and validates
 * before sending, so a wrong event fails where it was written; the
 * domain validates at ingest, because a client that skips the check —
 * an old version, a curl, someone's own script — must still be refused.
 *
 * A hand-written copy in each is the shape that goes stale, and the way
 * it goes stale is the two disagreeing about what is valid. So the same
 * module is emitted into both and `contract:check` fails on any drift.
 * ------------------------------------------------------------------ */

type Field =
  | { type: "string"; optional?: boolean; maxLength?: number }
  | { type: "integer"; optional?: boolean; min?: number }
  | { type: "enum"; optional?: boolean; values: string[] };

type AgentContract = {
  setupSpec: string;
  hosts: string[];
  prefix: string;
  events: Record<string, Record<string, Field>>;
  context: Record<string, Field | string>;
};

const agentSource = JSON.parse(readFileSync(join(ROOT, "contract/gen/agent.json"), "utf8")) as AgentContract;

const fields = (spec: Record<string, Field | string>): Record<string, Field> =>
  Object.fromEntries(Object.entries(spec).filter(([k, v]) => !k.startsWith("_") && typeof v === "object")) as Record<
    string,
    Field
  >;

const agentVocabulary = (c: AgentContract): string => {
  const events = Object.fromEntries(Object.entries(c.events).map(([name, spec]) => [name, fields(spec)]));
  return `/**
 * ${BANNER.replace("contract/gen/contract.json", "contract/gen/agent.json").split("\n").join("\n * ")}
 *
 * The agent telemetry vocabulary, and the check that enforces it.
 *
 * Both the data and the validator are generated, because two hand-written
 * validators over one list is two lists: they drift, and the drift shows up as
 * an event the SDK accepted and the server refused.
 */

export const AGENT_EVENT_PREFIX = ${JSON.stringify(c.prefix)};

export const AGENT_HOSTS = ${JSON.stringify(c.hosts)} as const;
export type AgentHost = (typeof AGENT_HOSTS)[number];

export const SETUP_SPEC = ${JSON.stringify(c.setupSpec)} as const;

export const AGENT_EVENTS = ${JSON.stringify(Object.keys(c.events))} as const;
export type AgentEventName = (typeof AGENT_EVENTS)[number];

export type FieldSpec =
  | { readonly type: "string"; readonly optional?: boolean; readonly maxLength?: number }
  | { readonly type: "integer"; readonly optional?: boolean; readonly min?: number }
  | { readonly type: "enum"; readonly optional?: boolean; readonly values: readonly string[] };

export const AGENT_EVENT_FIELDS: Readonly<Record<AgentEventName, Readonly<Record<string, FieldSpec>>>> =
${JSON.stringify(events, null, 2)};

/** Session context, registered once and stamped on every event. */
export const AGENT_CONTEXT_FIELDS: Readonly<Record<string, FieldSpec>> =
${JSON.stringify(fields(c.context), null, 2)};

/** A property value as it may appear on the wire. */
export type VocabularyValue = string | number | boolean | null;

const checkField = (name: string, spec: FieldSpec, value: VocabularyValue | undefined): string | null => {
  if (value === undefined || value === null) {
    return spec.optional === true ? null : \`\${name} is required\`;
  }
  if (spec.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) return \`\${name} must be an integer\`;
    if (spec.min !== undefined && value < spec.min) return \`\${name} must be at least \${spec.min}\`;
    return null;
  }
  if (typeof value !== "string") return \`\${name} must be a string\`;
  if (spec.type === "enum") {
    return spec.values.includes(value) ? null : \`\${name} must be one of \${spec.values.join(", ")}\`;
  }
  if (spec.maxLength !== undefined && value.length > spec.maxLength) {
    return \`\${name} must be at most \${spec.maxLength} characters\`;
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
    if (!(name in spec)) problems.push(\`\${name} is not a property of this event\`);
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
 * customer's \`session_start\` and an agent's are never the same series.
 */
export const claimsAgentVocabulary = (name: string): boolean => name.startsWith(AGENT_EVENT_PREFIX);

export type VocabularyProblem = { readonly event: string; readonly problems: readonly string[] };

/**
 * Validate one agent event's properties.
 *
 * Returns \`null\` when the name is not agent telemetry at all — the caller
 * decides what that means, which differs between the SDK and the server.
 */
export const validateAgentEvent = (
  name: string,
  properties: Readonly<Record<string, VocabularyValue>> = {},
): VocabularyProblem | null => {
  if (!claimsAgentVocabulary(name)) return null;
  if (!isAgentEventName(name)) {
    return { event: name, problems: [\`\${name} is not in the agent vocabulary\`] };
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
`;
};

// The same bytes in both places, so "they agree" is checkable by comparison
// rather than by reading.
write("packages/agent-core/src/gen/vocabulary.ts", agentVocabulary(agentSource));
write("packages/domain/src/ingest/gen/vocabulary.ts", agentVocabulary(agentSource));
