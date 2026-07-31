/**
 * The client.
 *
 * The reference implementation: every other language SDK is asserted against
 * the traces this one produces, so behaviour decided here is behaviour decided
 * for all four.
 *
 * Kept from v1, because it was right: a bounded queue, a failed batch returned
 * to the head, `Retry-After` honoured, a `visibilitychange` beacon so the last
 * events of a session are not lost, unref'd timers so a Node process can still
 * exit, and detection that does not assume a browser.
 *
 * Added: `identify()`, canonical platform names, and an idempotency key minted
 * at `track()` time and never regenerated — which is what makes the server's
 * at-least-once delivery safe rather than a source of double counting.
 */

import { BACKOFF, FATAL_STATUSES } from "./gen/contract";
import { EventQueue, type QueuedEvent } from "./queue";
import { detectSystem, type SystemProperties } from "./platform";
import { sendBatch, sendBeacon, type IngestReceipt, type SendOutcome } from "./transport";
import { Visit } from "./visit";

export const SDK_VERSION = "counted-js/2.0.0";

export type PropertyValue = string | number | boolean | null;

export type CountedOptions = {
  /** A public ingest key. It ships in your bundle; that is by design. */
  readonly key: string;
  readonly endpoint?: string;
  readonly appVersion?: string;
  readonly flushIntervalMs?: number;
  readonly maxBatchSize?: number;
  readonly maxQueueSize?: number;
  /** Off by default. On, it reports what was accepted and what was not. */
  readonly debug?: boolean;
  readonly visitId?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Injected so a jittered backoff is still assertable. */
  readonly random?: () => number;
  /** Called for anything a developer should see. Defaults to console. */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
};

export type Diagnostic =
  | { readonly kind: "refused"; readonly status: number; readonly detail: string }
  /** The credential is not usable. Nothing further will be sent. */
  | { readonly kind: "disabled"; readonly status: number; readonly detail: string; readonly discarded: number }
  | { readonly kind: "dropped"; readonly events: number; readonly reason: "queue_full" }
  | { readonly kind: "rejected"; readonly events: number; readonly reasons: readonly string[] }
  | { readonly kind: "quota"; readonly state: string; readonly used: number; readonly limit: number | null };

const DEFAULTS = {
  endpoint: "https://api.counted.dev/v1/events",
  flushIntervalMs: 5_000,
  maxBatchSize: 50,
  maxQueueSize: 1_000,
};

export class Counted {
  private readonly queue: EventQueue;
  private readonly visit: Visit;
  private readonly system: SystemProperties;
  private readonly options: Required<Pick<CountedOptions, "endpoint" | "flushIntervalMs" | "maxBatchSize">> &
    CountedOptions;
  private readonly now: () => number;
  private readonly random: () => number;

  private person: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private pausedUntil = 0;
  private attempt = 0;
  private closed = false;
  private disabled = false;
  private readonly warned = new Set<number>();

  constructor(options: CountedOptions) {
    this.options = {
      ...options,
      endpoint: options.endpoint ?? DEFAULTS.endpoint,
      flushIntervalMs: options.flushIntervalMs ?? DEFAULTS.flushIntervalMs,
      maxBatchSize: Math.min(options.maxBatchSize ?? DEFAULTS.maxBatchSize, 250),
    };
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.queue = new EventQueue(options.maxQueueSize ?? DEFAULTS.maxQueueSize);
    this.visit = new Visit({ ...(options.visitId === undefined ? {} : { visitId: options.visitId }), now: this.now });
    this.system = detectSystem({
      ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
      sdkVersion: SDK_VERSION,
    });

    this.startTimer();
    this.watchLifecycle();
  }

  /**
   * Attribute subsequent events to a person.
   *
   * The only way a durable identity enters Counted, and it is always the
   * customer's own id — we never derive, infer or invent one. Pass something
   * opaque: the server refuses anything that looks like an email address,
   * because putting one in a product whose promise is that it stores no
   * personal data is a mistake worth failing loudly on.
   */
  identify(userId: string): void {
    const trimmed = userId.trim();
    this.person = trimmed.length === 0 ? null : trimmed;
  }

  /**
   * Forget the person and start a new visit.
   *
   * For sign-out. Keeping the visit would group the next person's events with
   * the last one's, which looks like a privacy incident even though no
   * identity was involved.
   */
  reset(): void {
    this.person = null;
    this.visit.restart();
  }

  track(name: string, properties?: Readonly<Record<string, PropertyValue>>): void {
    if (this.closed || this.disabled) return;

    const before = this.queue.droppedCount;
    this.queue.push({
      name,
      visitId: this.visit.current(),
      ...(this.person === null ? {} : { userId: this.person }),
      // Stamped now, and held through every retry. The server's dedup key is
      // (key, instant), so regenerating either would double-count a retry.
      occurredAt: new Date(this.now()).toISOString(),
      idempotencyKey: this.mintKey(),
      ...(properties === undefined ? {} : { properties }),
      systemProperties: this.system as unknown as Record<string, string | null>,
    });

    const dropped = this.queue.droppedCount - before;
    // Reported, never silent. A queue quietly discarding events is how a
    // customer discovers a gap in their data months later.
    if (dropped > 0) this.report({ kind: "dropped", events: dropped, reason: "queue_full" });

    if (this.queue.size >= this.options.maxBatchSize) void this.flush();
  }

  /** Send what is queued. Safe to call concurrently; overlapping calls join. */
  async flush(): Promise<void> {
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = this.drain().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Stop, after one last flush.
   *
   * Awaited in a short-lived process — a script, a serverless handler — where
   * the alternative is exiting with events still queued.
   */
  async shutdown(): Promise<void> {
    this.closed = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.unwatchLifecycle();
    await this.flush();
  }

  private async drain(): Promise<void> {
    if (this.disabled || this.queue.size === 0) return;
    // A 429 told us when to come back. Honour it rather than hammering.
    if (this.now() < this.pausedUntil) return;

    const batch = this.queue.take(this.options.maxBatchSize);
    if (batch.length === 0) return;

    const outcome = await sendBatch(batch, {
      endpoint: this.options.endpoint,
      key: this.options.key,
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
    });

    this.handle(outcome, batch);
  }

  private handle(outcome: SendOutcome, batch: readonly QueuedEvent[]): void {
    if (outcome.kind === "accepted") {
      this.attempt = 0;
      this.reportReceipt(outcome.receipt);
      return;
    }

    if (outcome.kind === "refused") {
      // A credential that is missing, revoked or unauthorised will not become
      // valid by being tried again. Everything after this would be a request
      // that cannot succeed, so the client stops: the buffer is discarded and
      // nothing further is sent or queued. v1 retried these until the buffer
      // filled, which turned one misconfiguration into a busy loop.
      if (FATAL_STATUSES.includes(outcome.status)) {
        const discarded = this.queue.size;
        this.queue.take(this.queue.size);
        this.disabled = true;
        this.warnOnce(outcome.status, outcome.detail);
        this.report({ kind: "disabled", status: outcome.status, detail: outcome.detail, discarded });
        return;
      }

      // Resending cannot help — a malformed batch. Dropped, and the developer
      // told, but the client keeps working: the next batch may be fine.
      this.warnOnce(outcome.status, outcome.detail);
      this.report({ kind: "refused", status: outcome.status, detail: outcome.detail });
      return;
    }

    // SDK-041: the server said when. Believe it. Otherwise SDK-042: back off
    // exponentially with full jitter — without jitter every client that failed
    // in one outage comes back in the same millisecond and knocks the
    // recovering server over again.
    if (outcome.retryAfterMs !== null) {
      this.pausedUntil = this.now() + outcome.retryAfterMs;
    } else {
      this.attempt += 1;
      const ceiling = Math.min(BACKOFF.maxMs, BACKOFF.baseMs * BACKOFF.factor ** (this.attempt - 1));
      this.pausedUntil = this.now() + this.random() * ceiling;
    }
    this.queue.requeue(batch);
  }

  private reportReceipt(receipt: IngestReceipt): void {
    if (receipt.rejected > 0) {
      const reasons = (receipt.outcomes ?? [])
        .filter((o) => !o.accepted && o.reason !== undefined)
        .map((o) => o.reason!);
      // v1 could not do this: its 202 had an empty body, so a rejected event
      // and an accepted one looked identical.
      this.report({ kind: "rejected", events: receipt.rejected, reasons });
    }
    if (receipt.quota !== undefined && receipt.quota.state !== "ok") {
      this.report({ kind: "quota", ...receipt.quota });
    }
  }

  private report(diagnostic: Diagnostic): void {
    if (this.options.onDiagnostic !== undefined) {
      this.options.onDiagnostic(diagnostic);
      return;
    }
    if (this.options.debug === true) console.warn("[counted]", diagnostic);
  }

  /** Warn once per status, except for the two that always mean "fix this". */
  private warnOnce(status: number, detail: string): void {
    const always = status === 401 || status === 403;
    if (!always && this.warned.has(status)) return;
    this.warned.add(status);
    console.warn(`[counted] ingestion refused (HTTP ${status}): ${detail}`);
  }

  private mintKey(): string {
    const random = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (typeof random?.randomUUID === "function") return random.randomUUID();
    // No crypto: a Node 16 runtime, or a locked-down browser. Good enough for
    // a dedup key, which needs to be unique rather than unguessable.
    return `${this.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  private startTimer(): void {
    if (this.options.flushIntervalMs <= 0) return;
    this.timer = setInterval(() => void this.flush(), this.options.flushIntervalMs);
    // So a Node process is not held open by analytics. v1 got this right and
    // it is easy to lose.
    const timer = this.timer as { unref?: () => void };
    if (typeof timer.unref === "function") timer.unref();
  }

  private readonly onHidden = (): void => {
    const visibility = (globalThis as { document?: { visibilityState?: string } }).document?.visibilityState;
    if (visibility !== "hidden") return;
    // A beacon, not a fetch: the page is going away and a normal request is
    // cancelled with it. This is the only way the last event of a session
    // arrives at all.
    const batch = this.queue.take(this.options.maxBatchSize);
    if (batch.length === 0) return;
    const sent = sendBeacon(batch, { endpoint: this.options.endpoint, key: this.options.key });
    if (!sent) this.queue.requeue(batch);
  };

  private readonly onExit = (): void => {
    void this.flush();
  };

  private watchLifecycle(): void {
    const target = globalThis as {
      addEventListener?: (type: string, handler: () => void) => void;
      process?: { on?: (event: string, handler: () => void) => void };
    };
    if (typeof target.addEventListener === "function") {
      target.addEventListener("visibilitychange", this.onHidden);
    }
    if (typeof target.process?.on === "function") {
      target.process.on("beforeExit", this.onExit);
    }
  }

  private unwatchLifecycle(): void {
    const target = globalThis as {
      removeEventListener?: (type: string, handler: () => void) => void;
    };
    if (typeof target.removeEventListener === "function") {
      target.removeEventListener("visibilitychange", this.onHidden);
    }
  }
}
