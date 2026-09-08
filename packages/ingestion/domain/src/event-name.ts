/**
 * What may be called an event.
 *
 * Two different questions, and conflating them is why they are two functions.
 *
 * **Is it a usable name at all?** Non-empty, short enough to be a dictionary
 * value, no whitespace or control characters. A name gets dictionary-encoded
 * and then appears in a legend, a filter and a URL; `"  checkout \n"` and
 * `"checkout"` showing up as two rows in a breakdown is the same class of bug
 * as the four spellings of macOS.
 *
 * **Does it belong to a closed vocabulary?** Only agent telemetry does. A
 * customer's own events are theirs — `checkout_completed` needs no permission
 * from us and is never refused for not being on a list. Anything with the
 * `agent_` prefix is Counted's own product telemetry, generated from
 * `contract/gen/agent.json` into both the client that sends it and this
 * module, so a name the SDK accepted is not one the server refuses. The prefix
 * exists so a customer's `session_start` and an agent's are not one series.
 */

import {
  AGENT_CONTEXT_FIELDS,
  claimsAgentVocabulary,
  isAgentEventName,
  validateAgentEvent,
} from "./gen/vocabulary";
import type { VocabularyValue } from "./gen/vocabulary";

import type { EventAdmissionError } from "./errors";

/** Long enough for anything readable, short enough to index as a dictionary key. */
export const MAX_EVENT_NAME_LENGTH = 128;

/** Whitespace of any kind, plus C0 and DEL. */
const UNUSABLE_IN_A_NAME = /[\s\u0000-\u001f\u007f]/;

/**
 * The envelope the agent tracker stamps on every event.
 *
 * `agent-telemetry` sends `{ ...context, ...eventProperties }` on the wire
 * (`packages/agent-telemetry/src/tracker.ts`), so by the time an event reaches
 * admission the two are one flat object again. The generated validator refuses
 * unknown properties — correctly, since a typo that vanishes is a metric that
 * reads zero — which means validating the flat object against the event's own
 * field list would refuse every agent event ever sent. Splitting the context
 * back out is what makes the client-side and server-side checks agree.
 */
const CONTEXT_KEYS: ReadonlySet<string> = new Set(Object.keys(AGENT_CONTEXT_FIELDS));

/** Whether a name is a name. Answered before any vocabulary lookup, because a name that is not a name cannot be looked up in one. */
export const checkEventName = (name: string, index: number): EventAdmissionError | null => {
  if (name.length === 0) return { kind: "MalformedEvent", index, detail: "name is required" };
  if (name.length > MAX_EVENT_NAME_LENGTH) {
    return { kind: "MalformedEvent", index, detail: `name must be at most ${MAX_EVENT_NAME_LENGTH} characters` };
  }
  if (UNUSABLE_IN_A_NAME.test(name)) {
    return { kind: "MalformedEvent", index, detail: "name must not contain whitespace or control characters" };
  }
  return null;
};

/**
 * Hold agent telemetry to the generated vocabulary. Returns `null` for
 * anything that is not agent telemetry — that is a customer's event and none
 * of our business.
 *
 * The session context is split out and **not** validated here. It is
 * enrichment, and an older agent that omits a context field is still sending
 * usable telemetry; refusing the event would lose the data rather than fix the
 * agent. The event's own properties are strict, because those are what a chart
 * is built from.
 */
export const checkAgentVocabulary = (
  name: string,
  properties: Readonly<Record<string, VocabularyValue>>,
  index: number,
): EventAdmissionError | null => {
  if (!claimsAgentVocabulary(name)) return null;

  // A well-formed name that is simply not one of ours. Its own error, because
  // "fix your JSON" and "upgrade your agent" are different instructions.
  if (!isAgentEventName(name)) return { kind: "UnknownEventName", name };

  const own: Record<string, VocabularyValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!CONTEXT_KEYS.has(key)) own[key] = value;
  }

  const problem = validateAgentEvent(name, own);
  return problem === null ? null : { kind: "MalformedEvent", index, detail: problem.problems.join("; ") };
};
