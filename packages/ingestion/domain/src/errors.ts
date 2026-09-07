/**
 * Every way an event or a batch is refused.
 *
 * The `kind` strings and their fields are pinned by V3-SPEC §6 — the table
 * that maps each one to an oRPC error code, so the contract can declare
 * `data: z.object({ reason: z.literal("ClockSkew"), … })` and have it match
 * what a handler actually throws. Renaming a kind here is a wire change.
 *
 * Two of these are worth reading twice. `PlanExceeded` is 402 and
 * `RateLimited` is 429 because the instruction differs: upgrade versus back
 * off. v1 answered both with 429 and the support thread that produced was a
 * customer retrying for two days against a quota that was never going to move.
 */

/** Refuses the whole batch. Nothing in it was written. */
export type BatchAdmissionError =
  | { readonly kind: "BatchTooLarge"; readonly count: number; readonly max: number }
  | { readonly kind: "PayloadTooLarge"; readonly bytes: number; readonly max: number }
  | { readonly kind: "PlanExceeded"; readonly limit: number; readonly used: number }
  | { readonly kind: "RateLimited"; readonly retryAfterMs: number }
  | { readonly kind: "SinkUnavailable"; readonly detail: string };

/** Refuses one event. The rest of the batch still lands. */
export type EventAdmissionError =
  | { readonly kind: "MalformedEvent"; readonly index: number; readonly detail: string }
  | { readonly kind: "UnknownEventName"; readonly name: string }
  | { readonly kind: "ClockSkew"; readonly skewMs: number; readonly max: number }
  | { readonly kind: "PersonIdRequired" }
  | { readonly kind: "PersonIdTooLong"; readonly length: number; readonly max: number }
  | { readonly kind: "PersonIdLooksLikeEmail" };

export type AdmissionError = BatchAdmissionError | EventAdmissionError;

/**
 * A refused event, and where it sat in the batch the client sent.
 *
 * The index is carried here rather than on every error kind because it is a
 * fact about the request, not about the rule that was broken — and the client
 * needs it for all six of them, not just `MalformedEvent`. (`MalformedEvent`
 * keeps its own copy because V3-SPEC §6 puts it in that error's `data`, where
 * it is the only thing identifying an event too broken to name.)
 */
export type RejectedEvent = {
  readonly index: number;
  readonly error: EventAdmissionError;
};
