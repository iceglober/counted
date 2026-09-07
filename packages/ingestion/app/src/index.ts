/**
 * @counted/ingestion-app — the group-commit coalescer policy.
 *
 * The policy only: how long to wait, how many events to gather, when to flush
 * early, and when to refuse rather than buffer. The transport is a
 * hand-written Hono route in apps/api, deliberately outside oRPC — `POST
 * /v1/events` has a bespoke ack contract and a wire format four SDKs already
 * implement, and nothing about it benefits from an RPC layer.
 *
 * The seam between the two: this package holds the events and the promises and
 * exposes `nextDeadlineAt()`; the route owns the timer that reads it and the
 * status code that each `Ack` maps to.
 */

export {
  GroupCommit,
  type Ack,
  type CommitProblem,
  type CommitSummary,
  type GroupCommitDeps,
} from "./group-commit";

export {
  DEFAULT_GROUP_COMMIT_POLICY,
  deadline,
  decide,
  receive,
  type CommitState,
  type Decision,
  type FlushReason,
  type GroupCommitPolicy,
  type PendingGroup,
  type Reception,
} from "./policy";

export type { EventSink, IngestQuota, QuotaVerdict, WriteFailure, WriteReceipt } from "./ports";
