/**
 * POST /v1/events — the endpoint everything else exists to serve.
 *
 * Four promises, each one a v1 defect turned inside out:
 *
 *   **202 means committed.** The response is written after the rows are, so
 *   the status is a fact. v1 returned 202 from an in-memory array and flushed
 *   on a timer; a deploy in between lost the events.
 *
 *   **Every event gets a disposition.** One malformed event does not reject
 *   the batch, and no event is discarded silently.
 *
 *   **Over quota has its own signal.** v1 returned a byte-identical 202 and
 *   threw the events away, so a customer could be losing everything and see
 *   nothing but success. Here they are `dropped`, counted, and the quota state
 *   is named in the body.
 *
 *   **A failure is a failure.** If the write does not commit, the answer is
 *   503 with `Retry-After`. Delivery is at-least-once with a dedup key, so
 *   resending is safe and the SDK's on-device queue absorbs the outage.
 */

import {
  Instant,
  admit,
  explainRefusal,
  tally,
  type QuotaDecision,
  type Principal,
  type SubmittedEvent,
} from "@counted/domain";
import { IngestEventSchema, IngestRequestSchema, fieldsFrom, validationDetail, z } from "@counted/contracts";
import type { WritableEvent } from "@counted/ports";
import type { Dependencies } from "../composition";
import { ownProject, requires, type RouteDefinition } from "../http/route";
import { sendProblem } from "../http/respond";
import { QueueFullError } from "../ingest/coalescer";
import { dedupIdentity } from "../ingest/coalescer";

/** 1 MiB. A batch of 250 events with 50 properties each fits comfortably. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** How long a client should wait before resending after a write failure. */
const RETRY_AFTER_SECONDS = 5;

/**
 * Wire shape to domain shape.
 *
 * Written out rather than cast. `occurredAt` arrives as an ISO string and the
 * domain's `Instant` is epoch milliseconds — an `as` here compiled fine and
 * was wrong twice over: dedup identities never matched (so every event on a
 * first request was reported as a duplicate), and the clock-skew checks
 * compared `NaN`, which is false against everything, so they silently passed
 * whatever they were given. Converting at the boundary is the rule the domain
 * states about itself; this is what enforcing it looks like.
 */
const toSubmitted = (e: z.infer<typeof IngestEventSchema>): SubmittedEvent => ({
  name: e.name,
  visitId: e.visitId,
  userId: e.userId,
  occurredAt: e.occurredAt === undefined ? undefined : Instant.fromDate(new Date(e.occurredAt)),
  idempotencyKey: e.idempotencyKey,
  properties: e.properties,
  systemProperties: e.systemProperties,
});

const toWritable = (e: ReturnType<typeof admit>["admitted"][number]): WritableEvent => ({
  project: e.project,
  name: e.name,
  occurredAt: e.occurredAt,
  visit: e.subject.visit,
  person: e.subject.basis === "person" ? e.subject.person : null,
  idempotencyKey: e.idempotencyKey,
  properties: e.properties,
  system: e.system,
});

export const ingestRoutes = (deps: Dependencies): readonly RouteDefinition[] => [
  {
    method: "post",
    path: "/v1/events",
    /**
     * The resource comes from the credential, not from the URL.
     *
     * An ingest key names exactly one project and there is no project id in
     * the path, so a caller cannot name a project its key does not cover. The
     * guard still runs `decide` — same scope check, same binding check, same
     * placement lookup, so a deleted or unclaimed project stops ingesting.
     */
    security: requires("events:write", ownProject()),
    handler: async (c) => {
      const log = c.get("log");
      // The guard has already established this: it authorized `events:write`
      // on the project this credential is bound to, and only an ingest
      // principal can produce that resource.
      const principal = c.get("principal") as Extract<Principal, { kind: "ingest" }>;

      const declared = c.req.header("content-length");
      if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) {
        return sendProblem(c, "request.too_large", {
          detail: `The body is ${declared} bytes; the maximum is ${MAX_BODY_BYTES}.`,
        });
      }

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return sendProblem(c, "request.malformed", { detail: "The body is not valid JSON." });
      }

      const parsed = IngestRequestSchema.safeParse(raw);
      if (!parsed.success) {
        // Every invalid field, not the first. Derived from the schema, so it
        // exists here and on every other endpoint without anyone writing it.
        const fields = fieldsFrom(parsed.error);
        return sendProblem(c, "request.validation_failed", {
          detail: validationDetail(fields),
          fields,
        });
      }

      const quota = await deps.quota.decide(principal.project);
      const admission = admit({
        project: principal.project,
        events: parsed.data.events.map(toSubmitted),
        receivedAt: deps.clock.now(),
        quota,
      });

      let written: ReadonlySet<string>;
      let committedAt: Instant;
      try {
        const rows = admission.admitted.map(toWritable);
        const result = await deps.ingest.submit(rows);
        written = result.written;
        committedAt = result.committedAt;
      } catch (error) {
        // The write did not commit, so the answer must not say it did.
        const full = error instanceof QueueFullError;
        log.warn("ingest.unavailable", {
          projectId: principal.project,
          rows: admission.admitted.length,
          reason: full ? "queue_full" : "write_failed",
          error: error instanceof Error ? error.message : "unknown",
        });
        return sendProblem(c, "internal.unavailable", {
          retryAfter: RETRY_AFTER_SECONDS,
          detail: full
            ? "Ingestion is saturated. Resend — events carry a dedup key, so a retry cannot double-count."
            : "The write did not commit. Resend — events carry a dedup key, so a retry cannot double-count.",
        });
      }

      const counts = tally(admission.dispositions);
      const admittedByIndex = new Map(admission.admitted.map((e) => [e.index, e]));

      const outcomes = admission.dispositions.map((d) => {
        if (d.kind === "accepted") {
          const event = admittedByIndex.get(d.index)!;
          return {
            index: d.index,
            accepted: true as const,
            // A fact from the RETURNING set, not arithmetic on a count.
            deduplicated: !written.has(dedupIdentity(toWritable(event))),
          };
        }
        if (d.kind === "dropped") {
          return {
            index: d.index,
            accepted: false as const,
            reason: "Dropped: this workspace is past its monthly event allowance.",
          };
        }
        return { index: d.index, accepted: false as const, reason: explainRefusal(d.reason) };
      });

      const deduplicated = outcomes.filter((o) => o.accepted && o.deduplicated).length;

      log.info("ingest.receipt", {
        projectId: principal.project,
        accepted: counts.accepted,
        deduplicated,
        dropped: counts.dropped,
        rejected: counts.rejected,
        quota: quotaLabel(quota),
      });

      return c.json(
        {
          accepted: counts.accepted - deduplicated,
          deduplicated,
          rejected: counts.rejected + counts.dropped,
          outcomes,
          quota: {
            state: quotaLabel(quota),
            used: quota.used,
            limit: quota.kind === "accept" ? quota.limit : quota.limit,
          },
          ...(admission.warnings.length === 0 ? {} : { warnings: admission.warnings }),
          committedAt: Instant.toISO(committedAt),
        },
        202,
      );
    },
  },
];

const quotaLabel = (q: QuotaDecision): "ok" | "overage" | "rejected" => {
  switch (q.kind) {
    case "accept":
      return "ok";
    case "overage":
      return "overage";
    case "reject":
      return "rejected";
  }
};
