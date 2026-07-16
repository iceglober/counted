import type { AnalyticsOptions, EventProperties, RawEvent } from "./types";
import { Session } from "./session";
import { detectSystemProps } from "./system-props";
import { sendBeacon, sendFetch } from "./transport";
import { autoTrack } from "./auto-track";

const DEFAULT_HOST = "https://app.counted.dev";
const DEFAULT_FLUSH_INTERVAL = 30_000;
const DEFAULT_MAX_BATCH_SIZE = 50;
// Bound in-memory retention so a long outage in a short-lived process can't grow
// the buffer without limit. Oldest events are dropped first past this cap.
const MAX_BUFFER = 1000;

/** Drop keys whose value is `undefined` (props can't carry undefined on the wire). */
function stripUndefined(obj: EventProperties): EventProperties {
  const out: EventProperties = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

export class Analytics {
  private projectKey: string;
  private host: string;
  private flushInterval: number;
  private maxBatchSize: number;
  private appVersion?: string;
  private debug: boolean;
  private buffer: RawEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private enabled = true;
  private context: EventProperties;
  private session: Session;
  private pausedUntil = 0;
  private autoTrackCleanup: (() => void) | null = null;
  private onVisibilityChange: (() => void) | null = null;
  private onBeforeExit: (() => void) | null = null;

  constructor(options: AnalyticsOptions) {
    this.projectKey = options.projectKey;
    this.host = options.host ?? DEFAULT_HOST;
    this.flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    // The server rejects batches larger than 50, so cap here regardless of input.
    this.maxBatchSize = Math.min(
      options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
      DEFAULT_MAX_BATCH_SIZE,
    );
    this.appVersion = options.appVersion;
    this.debug = options.debug ?? false;
    this.context = stripUndefined({ ...(options.context ?? {}) });
    this.session = new Session({
      sessionId: options.sessionId,
      sessionTimeout: options.sessionTimeout,
    });

    this.validateKey();

    this.startTimer();
    this.registerUnloadHandler();

    if (options.autoTrack && typeof window !== "undefined") {
      this.autoTrackCleanup = autoTrack(this);
    }
  }

  /**
   * Register ("super") properties merged into every subsequent event. Useful
   * for stable context like an experiment/setup id, build, or environment.
   */
  register(props: EventProperties): void {
    this.context = stripUndefined({ ...this.context, ...props });
  }

  /**
   * Buffer an event. Flushes immediately once the buffer reaches maxBatchSize.
   * Never throws.
   */
  track(eventName: string, props?: EventProperties): void {
    if (!this.enabled) return;

    const event: RawEvent = {
      timestamp: new Date().toISOString(),
      sessionId: this.session.getSessionId(),
      eventName,
      systemProps: detectSystemProps(this.appVersion),
      // Registered context first; per-call props win on key collision.
      props: stripUndefined({ ...this.context, ...(props ?? {}) }),
    };

    this.buffer.push(event);
    if (this.debug) console.log(`[counted] track "${eventName}"`, event.props);

    if (this.buffer.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  /**
   * Drain the buffer in maxBatchSize chunks until it is empty or a send fails.
   * On failure the un-sent batch is re-queued (bounded by an internal cap) so
   * events survive a transient network error. Honors a 429 `Retry-After`.
   * Never throws.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    if (this.pausedUntil > Date.now()) return;

    while (this.buffer.length > 0) {
      const batch = this.buffer.splice(0, this.maxBatchSize);
      const url = `${this.host}/api/v0/event`;
      const result = await sendFetch(url, batch, this.projectKey, {
        debug: this.debug,
      });

      if (!result.ok) {
        // Re-prepend the un-sent batch to the buffer head, bounded by MAX_BUFFER
        // (drop oldest past the cap so memory stays bounded).
        this.buffer = batch.concat(this.buffer);
        if (this.buffer.length > MAX_BUFFER) {
          this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
        }
        if (result.status === 429 && result.retryAfter !== undefined) {
          this.pausedUntil = Date.now() + result.retryAfter * 1000;
        }
        return;
      }
    }
  }

  disable(): void {
    this.enabled = false;
    this.buffer = [];
    this.stopTimer();
  }

  enable(): void {
    this.enabled = true;
    this.startTimer();
  }

  /**
   * Stop timers, remove listeners, tear down auto-track, and await a final
   * flush. `await` it in short-lived processes to avoid dropping buffered
   * events on exit.
   */
  async destroy(): Promise<void> {
    this.stopTimer();
    this.removeUnloadHandlers();
    if (this.autoTrackCleanup) {
      this.autoTrackCleanup();
      this.autoTrackCleanup = null;
    }
    await this.flush();
  }

  private validateKey(): void {
    const key = this.projectKey;
    if (!key || (!key.startsWith("ck_") && !key.startsWith("A-US-"))) {
      console.warn(
        '[counted] projectKey looks invalid — expected a client key starting with "ck_" (or legacy "A-US-"). Events will likely be rejected.',
      );
    }
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushInterval);
    // Prevent the timer from keeping Node.js alive
    if (typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Beacon the buffer on page hide. sendBeacon can't set headers, so the key
   * rides in the query string. The buffer is chunked to maxBatchSize (the
   * server rejects larger batches) and any chunk sendBeacon refuses is retried
   * with a keepalive fetch rather than dropped.
   */
  private beaconFlush(): void {
    if (this.buffer.length === 0) return;

    const url = `${this.host}/api/v0/event?key=${encodeURIComponent(this.projectKey)}`;
    const pending = this.buffer;
    this.buffer = [];

    for (let i = 0; i < pending.length; i += this.maxBatchSize) {
      const chunk = pending.slice(i, i + this.maxBatchSize);
      const ok = sendBeacon(url, chunk);
      if (!ok) {
        // Fall back to a keepalive fetch instead of discarding the chunk.
        void fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk),
          keepalive: true,
        }).catch(() => {});
      }
    }
  }

  private registerUnloadHandler(): void {
    // Browser: flush on page hide
    if (typeof globalThis.document !== "undefined") {
      this.onVisibilityChange = () => {
        if (globalThis.document.visibilityState === "hidden") {
          this.beaconFlush();
        }
      };
      globalThis.addEventListener("visibilitychange", this.onVisibilityChange);
    }

    // Node.js: flush on process exit
    if (typeof globalThis.process !== "undefined" && globalThis.process.on) {
      this.onBeforeExit = () => {
        void this.flush();
      };
      globalThis.process.on("beforeExit", this.onBeforeExit);
    }
  }

  private removeUnloadHandlers(): void {
    if (this.onVisibilityChange && typeof globalThis.removeEventListener === "function") {
      globalThis.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.onVisibilityChange = null;
    }
    if (
      this.onBeforeExit &&
      typeof globalThis.process !== "undefined" &&
      globalThis.process.off
    ) {
      globalThis.process.off("beforeExit", this.onBeforeExit);
      this.onBeforeExit = null;
    }
  }
}
