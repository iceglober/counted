/** Shared tracking, validation, redaction, and setup vocabulary for agent telemetry. */

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
