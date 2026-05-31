import type { AnalyticsOptions, EventProperties, RawEvent } from "./types";
import { getSessionId } from "./session";
import { detectSystemProps } from "./system-props";
import { sendBeacon, sendFetch } from "./transport";

const DEFAULT_HOST = "https://counted.dev";
const DEFAULT_FLUSH_INTERVAL = 30_000;
const DEFAULT_MAX_BATCH_SIZE = 50;

export class Analytics {
  private projectKey: string;
  private host: string;
  private flushInterval: number;
  private maxBatchSize: number;
  private buffer: RawEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private enabled = true;

  constructor(options: AnalyticsOptions) {
    this.projectKey = options.projectKey;
    this.host = options.host ?? DEFAULT_HOST;
    this.flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    this.maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;

    this.startTimer();
    this.registerUnloadHandler();
  }

  track(eventName: string, props?: EventProperties): void {
    if (!this.enabled) return;

    const event: RawEvent = {
      timestamp: new Date().toISOString(),
      sessionId: getSessionId(),
      eventName,
      systemProps: detectSystemProps(),
      props: props ?? {},
    };

    this.buffer.push(event);

    if (this.buffer.length >= this.maxBatchSize) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, this.maxBatchSize);
    const url = `${this.host}/api/v0/event`;

    await sendFetch(url, batch, this.projectKey);
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

  destroy(): void {
    this.stopTimer();
    this.flush();
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.flushInterval);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private registerUnloadHandler(): void {
    if (typeof globalThis.addEventListener !== "function") return;

    globalThis.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && this.buffer.length > 0) {
        const url = `${this.host}/api/v0/event`;
        sendBeacon(url, this.buffer);
        this.buffer = [];
      }
    });
  }
}
