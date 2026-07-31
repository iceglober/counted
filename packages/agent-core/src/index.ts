/**
 * `@counted/agent-core` — the port every agent integration is built on.
 *
 * Not user-facing: install `@counted/claude-code`, `@counted/opencode`, or the
 * generic `@counted/agent` binary. This is where the parts they share live, so
 * that they cannot disagree about the vocabulary, the redaction rules, or what
 * a setup fingerprint means.
 */

export { createAgentTracker, type AgentTracker, type AgentTrackerOptions } from "./tracker";
export {
  canonicalize,
  emptyProjection,
  setupFingerprint,
  sha256,
  type Fingerprint,
  type PromptDigest,
  type SetupProjection,
} from "./fingerprint";
export { cmdName, langOf, relPath, scrubSecrets, truncate } from "./redaction";
export {
  AGENT_CONTEXT_FIELDS,
  AGENT_EVENT_FIELDS,
  AGENT_EVENT_PREFIX,
  AGENT_EVENTS,
  AGENT_HOSTS,
  SETUP_SPEC,
  claimsAgentVocabulary,
  isAgentEventName,
  validateAgentContext,
  validateAgentEvent,
  type AgentEventName,
  type AgentHost,
  type FieldSpec,
  type VocabularyProblem,
  type VocabularyValue,
} from "./gen/vocabulary";
